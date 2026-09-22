import { GoogleGenerativeAI } from '@google/generative-ai';

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
  private readonly apiKeys: string[];
  private currentKeyIndex = 0;
  private readonly modelName: string;

  constructor() {
    const keysStr =
      process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '';
    this.apiKeys = keysStr
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
    this.modelName = process.env.GEMINI_MODEL_NAME || 'gemini-2.0-flash-lite';
  }

  hasKeys(): boolean {
    return this.apiKeys.length > 0;
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

    let lastError: unknown;
    for (
      let attempt = 0;
      attempt < Math.max(this.apiKeys.length, 1);
      attempt++
    ) {
      const key = this.apiKeys[this.currentKeyIndex];
      try {
        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: this.modelName });
        const result = await model.generateContent(prompt);
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
      } catch (e) {
        lastError = e;
        this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
      }
    }

    if (lastError instanceof Error) {
      throw lastError;
    }
    throw new Error(
      lastError
        ? `AiDictionaryProvider error: ${String(lastError)}`
        : 'AiDictionaryProvider: all API keys failed',
    );
  }
}

/** Adapter for the public Free Dictionary API. Provider JSON never crosses the domain boundary. */
export class DictionaryApiDevProvider implements DictionaryProvider {
  private readonly baseUrl =
    process.env.DICTIONARY_API_BASE_URL ||
    'https://api.dictionaryapi.dev/api/v2/entries/en';

  async lookup(word: string): Promise<ProviderDictionaryEntry[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    try {
      const response = await fetch(
        `${this.baseUrl.replace(/\/$/, '')}/${encodeURIComponent(word)}`,
        { signal: controller.signal },
      );
      if (response.status === 404) return [];
      if (!response.ok)
        throw new Error(`Dictionary provider HTTP ${response.status}`);
      const payload: unknown = await response.json();
      if (!Array.isArray(payload)) return [];
      return payload.flatMap((entry: unknown) => this.normalizeEntry(entry));
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Dictionary provider timeout');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
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
