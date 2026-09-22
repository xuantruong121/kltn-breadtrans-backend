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
  AiDictionaryProvider,
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
  private primaryProvider: DictionaryProvider = new DictionaryApiDevProvider();
  private aiProvider: DictionaryProvider = new AiDictionaryProvider();
  private readonly positiveTtl = 30 * 24 * 60 * 60;
  private readonly negativeTtl = 30 * 60;

  get provider(): DictionaryProvider {
    return this.primaryProvider;
  }

  set provider(value: DictionaryProvider) {
    this.primaryProvider = value;
  }

  get fallbackProvider(): DictionaryProvider {
    return this.aiProvider;
  }

  set fallbackProvider(value: DictionaryProvider) {
    this.aiProvider = value;
  }

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @InjectRedis() private readonly redis?: Redis,
    @Optional() private readonly aiService?: AiService,
  ) {}

  private async fetchFromProviders(
    query: string,
  ): Promise<ProviderDictionaryEntry[]> {
    try {
      return await this.primaryProvider.lookup(query);
    } catch (primaryErr) {
      this.logger.warn(
        `Primary dictionary provider failed for "${query}" (${String(
          primaryErr,
        )}), falling back to AI provider`,
      );
      return await this.aiProvider.lookup(query);
    }
  }

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
      providerEntries = await this.fetchFromProviders(query);
    } catch (err) {
      this.logger.error(
        `All dictionary providers failed for "${query}": ${String(err)}`,
      );
      const unavailable = this.emptyResponse(query, candidates.length > 0);
      unavailable.providerUnavailable = true;
      // Do not cache transport/provider failures as a negative dictionary result.
      // A later request must be allowed to retry the provider.
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

  /**
   * Fetch richer provider data without delaying the curated/local lookup.
   * The client calls this after it has already rendered the local result.
   */
  async lookupExtended(
    rawWord: string,
    userId?: number,
  ): Promise<DictionaryLookupResponse> {
    const query = this.normalize(rawWord);
    const cacheKey = `dictionary:extended:v1:en:${query}`;
    const cached = await this.readCache(cacheKey);
    if (cached) {
      return this.attachSaved({ ...cached, source: 'CACHE' }, userId);
    }

    let providerEntries: ProviderDictionaryEntry[];
    try {
      providerEntries = await this.fetchFromProviders(query);
    } catch (err) {
      this.logger.error(
        `All dictionary providers failed for "${query}" (extended): ${String(
          err,
        )}`,
      );
      const unavailable = this.emptyResponse(query, false);
      unavailable.providerUnavailable = true;
      // Do not cache transport/provider failures as a negative dictionary result.
      return unavailable;
    }

    if (providerEntries.length === 0) {
      const empty = this.emptyResponse(query, false);
      await this.writeCache(cacheKey, empty, this.negativeTtl);
      return empty;
    }

    const response = await this.enrichExternal(
      this.normalizeProviderResult(query, providerEntries),
    );
    await this.writeCache(
      cacheKey,
      response,
      response.meaningViStatus === 'UNAVAILABLE' ? 5 * 60 : this.positiveTtl,
    );
    return this.attachSaved(response, userId);
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
    const canonicalRow =
      rows.find((row) => candidates.includes(String(row.word).toLowerCase())) ??
      rows.find((row) => String(row.word).toLowerCase() === query);
    const orderedRows = canonicalRow
      ? [canonicalRow, ...rows.filter((row) => row.id !== canonicalRow.id)]
      : rows;
    return this.toLocalResponse(query, orderedRows);
  }

  private toLocalResponse(query: string, rows: Array<Record<string, unknown>>) {
    if (rows.length === 0) return null;
    const canonical = String(rows[0].word);
    const inflection = canonical.toLowerCase() !== query;
    const uniqueRows = rows.filter((row, index) => {
      const partOfSpeech = String(row.pos || '').toLowerCase();
      return (
        rows.findIndex(
          (candidate) =>
            String(candidate.pos || '').toLowerCase() === partOfSpeech,
        ) === index
      );
    });
    const entries = uniqueRows.map((row) => ({
      word: String(row.word),
      partOfSpeech: (row.pos as string | null) || null,
      ipaUs: (row.ipaUs as string | null) || null,
      ipaUk: (row.ipaUk as string | null) || null,
      meaningVi: (row.meaning as string | null) || null,
      definitions: [
        {
          definition: (row.meaning as string | null) || '',
          meaningVi: (row.meaning as string | null) || null,
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
    const groupedItems = new Map<string, ProviderDictionaryEntry>();
    for (const item of items) {
      const key = item.partOfSpeech?.toLowerCase() || 'unknown';
      const existing = groupedItems.get(key);
      if (!existing) {
        groupedItems.set(key, { ...item, definitions: [...item.definitions] });
        continue;
      }
      existing.ipaUs ||= item.ipaUs;
      existing.ipaUk ||= item.ipaUk;
      existing.audioUs ||= item.audioUs;
      existing.audioUk ||= item.audioUk;
      existing.definitions.push(...item.definitions);
    }
    const entries = [...groupedItems.values()].map((item) => ({
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
    if (!this.aiService || response.source === 'LOCAL') return response;

    let enrichedCount = 0;
    const entries = await Promise.all(
      response.entries.map(async (entry, index) => {
        const definition = entry.definitions[0];
        if (!definition || index >= 5) return entry;

        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        try {
          const timeout = new Promise<null>((resolve) => {
            timeoutId = setTimeout(() => resolve(null), 3500);
          });
          const enrichment = await Promise.race([
            this.aiService!.enrichDictionaryEntry({
              word: entry.word,
              partOfSpeech: entry.partOfSpeech,
              definitionEn: definition.definition,
              exampleEn: definition.example,
            }),
            timeout,
          ]);
          if (!enrichment) return entry;
          enrichedCount += 1;
          return {
            ...entry,
            meaningVi: enrichment.meaningVi,
            exampleVi: enrichment.exampleVi || null,
            definitions: entry.definitions.map((item, itemIndex) =>
              itemIndex === 0
                ? { ...item, meaningVi: enrichment.meaningVi }
                : item,
            ),
            collocations: enrichment.collocations || entry.collocations,
          };
        } catch {
          return entry;
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
        }
      }),
    );

    return {
      ...response,
      entries,
      meaningViStatus: enrichedCount > 0 ? 'ENRICHED' : 'UNAVAILABLE',
    };
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
