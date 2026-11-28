import { GeminiCredentialManager } from '../ai/gemini/gemini-credential-manager.service';
import {
  AiTaskType,
  GeminiModelRouter,
} from '../ai/gemini/gemini-model-router';

export interface ProviderDictionaryEntry {
  word: string;
  partOfSpeech: string | null;
  ipaUs: string | null;
  ipaUk: string | null;
  definitions: Array<{
    definition: string;
    example: string | null;
    synonyms: string[];
    antonyms: string[];
  }>;
  audioUs: string | null;
  audioUk: string | null;
}

export interface DictionaryProvider {
  lookup(word: string): Promise<ProviderDictionaryEntry[]>;
}

/**
 * Fallback provider using Gemini AI to generate dictionary entries.
 * Activates when the HTTP provider is unavailable (network timeout / blocked).
 */
export class AiDictionaryProvider implements DictionaryProvider {
  private readonly credentials: GeminiCredentialManager;

  constructor(credentials?: GeminiCredentialManager) {
    this.credentials =
      credentials || new GeminiCredentialManager(new GeminiModelRouter());
  }

  hasKeys(): boolean {
    return this.credentials.hasCredentials();
  }

  async lookup(word: string): Promise<ProviderDictionaryEntry[]> {
    if (!this.hasKeys()) {
      throw new Error('AiDictionaryProvider: no Gemini API keys configured');
    }

    const prompt =
      `You are a professional English dictionary. Return a JSON array of dictionary entries for the word "${word}".\n` +
      `Each entry represents one part of speech. Required schema per entry:\n` +
      `{ "word": string, "partOfSpeech": string, "ipaUs": string|null, "ipaUk": string|null,` +
      `  "definitions": [{ "definition": string, "example": string|null, "synonyms": string[], "antonyms": string[] }] }\n` +
      `Rules:\n` +
      `- Return 1-4 entries covering all major parts of speech for the word.\n` +
      `- ipaUs/ipaUk: use standard IPA notation (e.g. "mjuːˈzɪəm"), or null if unknown.\n` +
      `- Each entry must have 1-3 definitions.\n` +
      `- synonyms and antonyms: 0-5 items per definition, empty array if none.\n` +
      `- If the word doesn't exist in English, return an empty array [].\n` +
      `Return raw JSON only, no markdown fences.`;

    try {
      const result = await this.credentials.execute({
        taskType: AiTaskType.TEXT_AUTHORING,
        operation: (model) => model.generateContent(prompt),
      });
      const raw = result.response
        .text()
        .trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```$/i, '')
        .trim();
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(
          (item): item is Record<string, unknown> =>
            !!item && typeof item === 'object',
        )
        .map((item) => ({
          word: typeof item.word === 'string' ? item.word : word,
          partOfSpeech:
            typeof item.partOfSpeech === 'string' ? item.partOfSpeech : null,
          ipaUs: typeof item.ipaUs === 'string' ? item.ipaUs : null,
          ipaUk: typeof item.ipaUk === 'string' ? item.ipaUk : null,
          definitions: Array.isArray(item.definitions)
            ? (item.definitions as Record<string, unknown>[]).map((def) => ({
                definition:
                  typeof def.definition === 'string' ? def.definition : '',
                example: typeof def.example === 'string' ? def.example : null,
                synonyms: Array.isArray(def.synonyms)
                  ? (def.synonyms as unknown[]).filter(
                      (s): s is string => typeof s === 'string',
                    )
                  : [],
                antonyms: Array.isArray(def.antonyms)
                  ? (def.antonyms as unknown[]).filter(
                      (a): a is string => typeof a === 'string',
                    )
                  : [],
              }))
            : [],
          audioUs: null,
          audioUk: null,
        }))
        .filter((entry) => entry.definitions.length > 0);
    } catch (error) {
      throw error instanceof Error
        ? error
        : new Error(`AiDictionaryProvider error: ${String(error)}`);
    }
  }
}

/**
 * A pronunciation address the browser can open: protocol-relative ("//host/x")
 * becomes https, anything that is not http(s) is dropped.
 */
export function normalizeAudioUrl(
  raw: string | null | undefined,
): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  const url = value.startsWith('//') ? `https:${value}` : value;
  return /^https?:\/\//i.test(url) ? url : null;
}

const AUDIO_CHECK_TIMEOUT_MS = 1500;
const AUDIO_VERDICT_TTL_MS = 60 * 60 * 1000;
const audioVerdicts = new Map<string, { playable: boolean; at: number }>();

/** For tests: forget what was learned about audio addresses. */
export const forgetAudioVerdicts = () => audioVerdicts.clear();

/**
 * The address when it really serves audio, otherwise null (owner 2026-11-28:
 * the public dictionary hands out pronunciation addresses that answer 404, and
 * the admin form showed a dead 00:00 player). An answer, even a 404, is
 * remembered for an hour; no answer in time is not, so the next lookup asks
 * again.
 */
export async function playableAudioUrl(
  raw: string | null | undefined,
  options: { fetchImpl?: typeof fetch; now?: () => number } = {},
): Promise<string | null> {
  const url = normalizeAudioUrl(raw);
  if (!url) return null;
  const now = options.now ?? Date.now;
  const known = audioVerdicts.get(url);
  if (known && now() - known.at < AUDIO_VERDICT_TTL_MS)
    return known.playable ? url : null;
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AUDIO_CHECK_TIMEOUT_MS);
  try {
    let response = await fetchImpl(url, {
      method: 'HEAD',
      signal: controller.signal,
    });
    // A host that refuses HEAD is asked for the first byte instead.
    if (response.status === 405 || response.status === 501)
      response = await fetchImpl(url, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
        signal: controller.signal,
      });
    const type = response.headers.get('content-type') ?? '';
    const playable = response.ok && /^audio\//i.test(type);
    audioVerdicts.set(url, { playable, at: now() });
    return playable ? url : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Adapter for the public Free Dictionary API. Provider JSON never crosses the domain boundary. */
export class DictionaryApiDevProvider implements DictionaryProvider {
  private readonly baseUrl =
    process.env.DICTIONARY_API_BASE_URL ||
    'https://api.dictionaryapi.dev/api/v2/entries/en';

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async lookup(word: string): Promise<ProviderDictionaryEntry[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    try {
      const response = await this.fetchImpl(
        `${this.baseUrl.replace(/\/$/, '')}/${encodeURIComponent(word)}`,
        { signal: controller.signal },
      );
      if (response.status === 404) return [];
      if (!response.ok)
        throw new Error(`Dictionary provider HTTP ${response.status}`);
      const payload: unknown = await response.json();
      if (!Array.isArray(payload)) return [];
      const entries = payload.flatMap((entry: unknown) =>
        this.normalizeEntry(entry),
      );
      await this.keepPlayableAudio(entries);
      return entries;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Dictionary provider timeout');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Audio addresses the provider gave that do not serve audio are dropped; the
   * phonetics stay. Every address is asked once, all at the same time.
   */
  private async keepPlayableAudio(entries: ProviderDictionaryEntry[]) {
    const urls = new Set<string>();
    for (const entry of entries)
      for (const raw of [entry.audioUs, entry.audioUk]) {
        const url = normalizeAudioUrl(raw);
        if (url) urls.add(url);
      }
    const verdicts = new Map<string, string | null>(
      await Promise.all(
        [...urls].map(
          async (url) =>
            [
              url,
              await playableAudioUrl(url, { fetchImpl: this.fetchImpl }),
            ] as const,
        ),
      ),
    );
    for (const entry of entries) {
      entry.audioUs =
        verdicts.get(normalizeAudioUrl(entry.audioUs) ?? '') ?? null;
      entry.audioUk =
        verdicts.get(normalizeAudioUrl(entry.audioUk) ?? '') ?? null;
    }
  }

  private normalizeEntry(entry: unknown): ProviderDictionaryEntry[] {
    if (!entry || typeof entry !== 'object') return [];
    const value = entry as {
      word?: unknown;
      phonetic?: unknown;
      phonetics?: unknown;
      meanings?: unknown;
    };
    const word = typeof value.word === 'string' ? value.word : null;
    if (!word) return [];
    const phonetics = (Array.isArray(value.phonetics) ? value.phonetics : [])
      .filter((item): item is Record<string, unknown> => {
        return !!item && typeof item === 'object';
      })
      .map((item) => ({
        text: typeof item.text === 'string' ? item.text : null,
        audio: typeof item.audio === 'string' ? item.audio : null,
      }));
    const genericIpa =
      typeof value.phonetic === 'string' ? value.phonetic : null;
    const usPhonetic = phonetics.find((item) =>
      /(?:_|-|\b)(?:us|american)(?:_|-|\b)/i.test(item.audio || ''),
    );
    const ukPhonetic = phonetics.find((item) =>
      /(?:_|-|\b)(?:gb|uk|british)(?:_|-|\b)/i.test(item.audio || ''),
    );
    const firstWithText = phonetics.find((item) => item.text);
    const firstWithAudio = phonetics.find((item) => item.audio);
    const meanings = Array.isArray(value.meanings) ? value.meanings : [];
    return meanings.map((meaning: unknown) => {
      const item = meaning as {
        partOfSpeech?: unknown;
        definitions?: unknown;
      };
      const definitions = Array.isArray(item.definitions)
        ? item.definitions
        : [];
      return {
        word,
        partOfSpeech:
          typeof item.partOfSpeech === 'string' ? item.partOfSpeech : null,
        ipaUs: usPhonetic?.text || genericIpa || firstWithText?.text || null,
        ipaUk: ukPhonetic?.text || genericIpa || firstWithText?.text || null,
        audioUs: usPhonetic?.audio || firstWithAudio?.audio || null,
        audioUk: ukPhonetic?.audio || firstWithAudio?.audio || null,
        definitions: definitions.map((definition: unknown) => {
          const detail = definition as {
            definition?: unknown;
            example?: unknown;
            synonyms?: unknown;
            antonyms?: unknown;
          };
          return {
            definition:
              typeof detail.definition === 'string' ? detail.definition : '',
            example: typeof detail.example === 'string' ? detail.example : null,
            synonyms: Array.isArray(detail.synonyms)
              ? detail.synonyms.filter(
                  (item): item is string => typeof item === 'string',
                )
              : [],
            antonyms: Array.isArray(detail.antonyms)
              ? detail.antonyms.filter(
                  (item): item is string => typeof item === 'string',
                )
              : [],
          };
        }),
      };
    });
  }
}
