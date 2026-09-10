import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import {
  DictionaryApiDevProvider,
  DictionaryProvider,
  ProviderDictionaryEntry,
} from './dictionary-provider';

export type DictionarySource = 'LOCAL' | 'CACHE' | 'EXTERNAL';
export type DictionaryMatch = {
  id?: number;
  word: string;
  pos?: string | null;
  meaning?: string | null;
  ipaUs?: string | null;
  ipaUk?: string | null;
  exampleEn?: string | null;
  exampleVi?: string | null;
  audioUs?: string | null;
  audioUk?: string | null;
  collocations?: unknown;
};

export interface DictionaryLookupResponse {
  query: string;
  canonicalWord: string | null;
  isInflectionMatch: boolean;
  source: DictionarySource;
  providerUnavailable?: boolean;
  saved?: boolean;
  savedId?: number | null;
  meaningViStatus?: 'ENRICHED' | 'UNAVAILABLE' | 'NOT_APPLICABLE';
  entries: Array<{
    word: string;
    partOfSpeech: string | null;
    ipaUs: string | null;
    ipaUk: string | null;
    meaningVi: string | null;
    definitions: Array<{
      definition: string;
      meaningVi: string | null;
      example: string | null;
    }>;
    examples: string[];
    collocations: unknown[];
    synonyms: string[];
    antonyms: string[];
    audio: { us: string | null; uk: string | null };
    exampleVi?: string | null;
  }>;
  /** Backward-compatible alias consumed by the current popup. */
  matches: DictionaryMatch[];
}

@Injectable()
export class DictionaryLookupService {
  private readonly logger = new Logger(DictionaryLookupService.name);
  private readonly provider: DictionaryProvider =
    new DictionaryApiDevProvider();
  private readonly positiveTtl = 30 * 24 * 60 * 60;
  private readonly negativeTtl = 60 * 60;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @InjectRedis() private readonly redis?: Redis,
    @Optional() private readonly aiService?: AiService,
  ) {}

  async lookup(
    rawWord: string,
    userId?: number,
  ): Promise<DictionaryLookupResponse> {
    const query = this.normalize(rawWord);
    const candidates = this.generateInflectionCandidates(query);
    // v2 invalidates negative entries written before the curated vocabulary
    // seed was populated. Keeping the namespace versioned prevents a stale
    // "not found" response from masking a word that now exists locally.
    const cacheKey = `dictionary:v2:en:${query}`;
    // Curated vocabulary always wins over a stale external cache entry.
    const local = await this.lookupLocal(query, candidates);
    if (local) {
      await this.writeCache(cacheKey, local, this.positiveTtl);
      return this.attachSaved(local, userId);
    }
    const cached = await this.readCache(cacheKey);
    if (cached) {
      let cachedResponse = { ...cached, source: 'CACHE' as const };
      if (
        cachedResponse.entries.length > 0 &&
        cachedResponse.meaningViStatus !== 'ENRICHED' &&
        cachedResponse.meaningViStatus !== 'NOT_APPLICABLE'
      ) {
        cachedResponse = {
          ...(await this.enrichExternal(cachedResponse)),
          source: 'CACHE' as const,
        };
        await this.writeCache(
          cacheKey,
          cachedResponse,
          cachedResponse.meaningViStatus === 'UNAVAILABLE'
            ? 5 * 60
            : this.positiveTtl,
        );
      }
      return this.attachSaved(cachedResponse, userId);
    }

    let providerEntries: ProviderDictionaryEntry[];
    try {
      providerEntries = await this.provider.lookup(query);
    } catch {
      const unavailable = this.emptyResponse(query, candidates.length > 0);
      unavailable.providerUnavailable = true;
      await this.writeCache(cacheKey, unavailable, 5 * 60);
      return unavailable;
    }
    if (providerEntries.length === 0) {
      const empty = this.emptyResponse(query, candidates.length > 0);
      await this.writeCache(cacheKey, empty, this.negativeTtl);
      return empty;
    }
    const external = await this.enrichExternal(
      this.normalizeProviderResult(query, providerEntries),
    );
    await this.writeCache(
      cacheKey,
      external,
      external.meaningViStatus === 'UNAVAILABLE' ? 5 * 60 : this.positiveTtl,
    );
    return this.attachSaved(external, userId);
  }

  async getSavedStatus(userId: number, canonicalWord: string) {
    try {
      return await this.prisma.userSavedWord.findFirst({
        where: { userId, canonicalWord: canonicalWord.toLowerCase() },
        select: { id: true },
      });
    } catch {
      return null;
    }
  }

  private async attachSaved(
    response: DictionaryLookupResponse,
    userId?: number,
  ): Promise<DictionaryLookupResponse> {
    if (!userId || !response.canonicalWord) return response;
    const saved = await this.getSavedStatus(userId, response.canonicalWord);
    return { ...response, saved: Boolean(saved), savedId: saved?.id ?? null };
  }

  private normalize(rawWord: string): string {
    if (!rawWord || rawWord.trim().length === 0) {
      throw new BadRequestException('Word is required for dictionary lookup');
    }
    const normalized = rawWord
      .trim()
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (
      !normalized ||
      normalized.length > 80 ||
      !/^[\p{L}\p{N}'-]+$/u.test(normalized)
    ) {
      throw new BadRequestException(
        'A valid word is required for dictionary lookup',
      );
    }
    return normalized;
  }

  private async lookupLocal(query: string, candidates: string[]) {
    const words = [query, ...candidates];
    const rows = await this.prisma.vocabWord.findMany({
      where: { word: { in: words, mode: 'insensitive' } },
      take: 10,
      select: {
        id: true,
        word: true,
        pos: true,
        ipaUs: true,
        ipaUk: true,
        meaning: true,
        exampleEn: true,
        exampleVi: true,
        audioUs: true,
        audioUk: true,
        collocations: true,
      },
    });
    return this.toLocalResponse(query, rows);
  }

  private toLocalResponse(query: string, rows: Array<Record<string, unknown>>) {
    if (rows.length === 0) return null;
    const canonical = String(rows[0].word);
    const inflection = canonical.toLowerCase() !== query;
    const entries = rows.map((row) => ({
      word: String(row.word),
      partOfSpeech: (row.pos as string | null) || null,
      ipaUs: (row.ipaUs as string | null) || null,
      ipaUk: (row.ipaUk as string | null) || null,
      meaningVi: (row.meaning as string | null) || null,
      definitions: [
        {
          definition: (row.exampleEn as string | null) || '',
          meaningVi: (row.exampleVi as string | null) || null,
          example: (row.exampleEn as string | null) || null,
        },
      ],
      examples: row.exampleEn ? [String(row.exampleEn)] : [],
      collocations: Array.isArray(row.collocations) ? row.collocations : [],
      synonyms: [],
      antonyms: [],
      audio: {
        us: (row.audioUs as string | null) || null,
        uk: (row.audioUk as string | null) || null,
      },
    }));
    return {
      query,
      canonicalWord: canonical,
      isInflectionMatch: inflection,
      source: 'LOCAL' as const,
      entries,
      matches: rows as DictionaryMatch[],
    };
  }

  private normalizeProviderResult(
    query: string,
    items: ProviderDictionaryEntry[],
  ) {
    const canonical = items[0]?.word || query;
    const entries = items.map((item) => ({
      word: item.word,
      partOfSpeech: item.partOfSpeech,
      ipaUs: item.ipaUs,
      ipaUk: item.ipaUk,
      meaningVi: null,
      definitions: item.definitions.map((definition) => ({
        definition: definition.definition,
        meaningVi: null,
        example: definition.example,
      })),
      examples: item.definitions.flatMap((definition) =>
        definition.example ? [definition.example] : [],
      ),
      collocations: [],
      synonyms: [
        ...new Set(
          item.definitions.flatMap((definition) => definition.synonyms),
        ),
      ],
      antonyms: [
        ...new Set(
          item.definitions.flatMap((definition) => definition.antonyms),
        ),
      ],
      audio: { us: item.audioUs, uk: item.audioUk },
      exampleVi: null,
    }));
    return {
      query,
      canonicalWord: canonical,
      isInflectionMatch: canonical.toLowerCase() !== query,
      source: 'EXTERNAL' as const,
      meaningViStatus: 'UNAVAILABLE' as const,
      entries,
      matches: [],
    };
  }

  private async enrichExternal(
    response: DictionaryLookupResponse,
  ): Promise<DictionaryLookupResponse> {
    if (!this.aiService || response.source !== 'EXTERNAL') return response;
    const first = response.entries[0];
    const definition = first?.definitions[0];
    if (!first || !definition) return response;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<null>((resolve) => {
        timeoutId = setTimeout(() => resolve(null), 3500);
      });
      const enrichment = await Promise.race([
        this.aiService.enrichDictionaryEntry({
          word: first.word,
          partOfSpeech: first.partOfSpeech,
          definitionEn: definition.definition,
          exampleEn: definition.example,
        }),
        timeout,
      ]);
      if (timeoutId) clearTimeout(timeoutId);
      if (!enrichment) {
        return { ...response, meaningViStatus: 'UNAVAILABLE' };
      }
      const entries = response.entries.map((entry, index) =>
        index === 0
          ? {
              ...entry,
              meaningVi: enrichment.meaningVi,
              exampleVi: enrichment.exampleVi || null,
              definitions: entry.definitions.map((item, itemIndex) =>
                itemIndex === 0
                  ? {
                      ...item,
                      meaningVi: enrichment.meaningVi,
                    }
                  : item,
              ),
              collocations: enrichment.collocations || entry.collocations,
            }
          : entry,
      );
      return { ...response, entries, meaningViStatus: 'ENRICHED' };
    } catch {
      if (timeoutId) clearTimeout(timeoutId);
      return { ...response, meaningViStatus: 'UNAVAILABLE' };
    }
  }

  private emptyResponse(query: string, isInflectionMatch: boolean) {
    return {
      query,
      canonicalWord: null,
      isInflectionMatch,
      source: 'EXTERNAL' as const,
      providerUnavailable: false,
      entries: [],
      matches: [],
    };
  }

  private async readCache(
    key: string,
  ): Promise<DictionaryLookupResponse | null> {
    if (!this.redis) return null;
    try {
      const raw = await this.redis.get(key);
      return raw ? (JSON.parse(raw) as DictionaryLookupResponse) : null;
    } catch {
      return null;
    }
  }

  private async writeCache(
    key: string,
    value: DictionaryLookupResponse,
    ttl: number,
  ): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttl);
    } catch {
      // Cache failure must never make a dictionary lookup fail.
    }
  }

  private generateInflectionCandidates(word: string): string[] {
    const candidates = new Set<string>();
    const irregular: Record<string, string> = {
      went: 'go',
      gone: 'go',
      was: 'be',
      were: 'be',
      had: 'have',
      did: 'do',
      saw: 'see',
      took: 'take',
      made: 'make',
    };
    if (irregular[word]) candidates.add(irregular[word]);
    if (word.endsWith('ies') && word.length > 4)
      candidates.add(`${word.slice(0, -3)}y`);
    if (word.endsWith('ied') && word.length > 4)
      candidates.add(`${word.slice(0, -3)}y`);
    if (word.endsWith('es') && word.length > 3) {
      candidates.add(word.slice(0, -2));
      candidates.add(word.slice(0, -1));
      candidates.add(`${word.slice(0, -2)}e`);
    }
    if (word.endsWith('s') && !word.endsWith('ss') && word.length > 2)
      candidates.add(word.slice(0, -1));
    if (word.endsWith('ing') && word.length > 4) {
      const base = word.slice(0, -3);
      candidates.add(base);
      candidates.add(`${base}e`);
      if (base.endsWith('i')) candidates.add(`${base.slice(0, -1)}y`);
      if (base.length > 2 && base.at(-1) === base.at(-2))
        candidates.add(base.slice(0, -1));
    }
    if (word.endsWith('ed') && word.length > 3) {
      const base = word.slice(0, -2);
      candidates.add(base);
      candidates.add(word.slice(0, -1));
      candidates.add(`${base}e`);
      if (base.length > 2 && base.at(-1) === base.at(-2))
        candidates.add(base.slice(0, -1));
    }
    candidates.delete(word);
    return [...candidates];
  }
}
