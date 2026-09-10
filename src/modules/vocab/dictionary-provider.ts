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

/** Adapter for the public Free Dictionary API. Provider JSON never crosses the domain boundary. */
export class DictionaryApiDevProvider implements DictionaryProvider {
  private readonly baseUrl =
    process.env.DICTIONARY_API_BASE_URL ||
    'https://api.dictionaryapi.dev/api/v2/entries/en';

  async lookup(word: string): Promise<ProviderDictionaryEntry[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
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
    const phonetics = Array.isArray(value.phonetics) ? value.phonetics : [];
    const ipa = typeof value.phonetic === 'string' ? value.phonetic : null;
    const audio = phonetics.find(
      (item) =>
        item &&
        typeof item === 'object' &&
        typeof (item as { audio?: unknown }).audio === 'string',
    ) as { audio?: string } | undefined;
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
        ipaUs: ipa,
        ipaUk: ipa,
        audioUs: audio?.audio || null,
        audioUk: audio?.audio || null,
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
