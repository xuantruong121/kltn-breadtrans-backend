/** What the CMS may read from an uploaded document. No I/O. */
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_MAX_CHARS = 20_000;
export const DOCUMENT_MAX_DECKS = 6;
export const DOCUMENT_MAX_WORDS_PER_DECK = 30;

const READABLE = ['.pdf', '.docx', '.txt'];

export const isReadableDocument = (filename: string) =>
  READABLE.some((extension) => filename.toLowerCase().endsWith(extension));

/** Long documents are cut, and the admin is told how much the AI will read. */
export function limitDocumentText(raw: string, limit = DOCUMENT_MAX_CHARS) {
  // The PDF reader adds a "-- 1 of 3 --" line per page; it is not document text.
  const text = raw
    .replace(/\r\n/g, '\n')
    .replace(/^-- \d+ of \d+ --$/gm, '')
    .trim();
  return {
    text: text.slice(0, limit),
    totalChars: text.length,
    truncated: text.length > limit,
  };
}

export type VocabDeckCandidate = {
  title?: string;
  description?: string;
  level?: string;
  words?: Array<{
    word?: string;
    pos?: string;
    meaning?: string;
    exampleEn?: string;
    exampleVi?: string;
  }>;
};

const key = (word: string) => word.trim().toLowerCase();

/**
 * Clean decks for the review screen: each word appears once across all decks,
 * a word without a meaning is dropped, and a deck left empty disappears.
 */
export function normalizeVocabDecks(
  decks: VocabDeckCandidate[],
  known: ReadonlySet<string> = new Set(),
) {
  const seen = new Set<string>();
  return decks
    .slice(0, DOCUMENT_MAX_DECKS)
    .map((deck) => ({
      title: (deck.title ?? '').trim(),
      description: (deck.description ?? '').trim(),
      level: (deck.level ?? '').trim(),
      words: (deck.words ?? [])
        .filter((row) => row.word?.trim() && row.meaning?.trim())
        .filter((row) => {
          const id = key(row.word!);
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        })
        .slice(0, DOCUMENT_MAX_WORDS_PER_DECK)
        .map((row) => ({
          word: row.word!.trim(),
          pos: (row.pos ?? '').trim(),
          meaning: row.meaning!.trim(),
          exampleEn: (row.exampleEn ?? '').trim(),
          exampleVi: (row.exampleVi ?? '').trim(),
          known: known.has(key(row.word!)),
        })),
    }))
    .filter((deck) => deck.title && deck.words.length > 0);
}

/** Headwords to look up in the dictionary before showing the review screen. */
export const deckHeadwords = (decks: VocabDeckCandidate[]) => [
  ...new Set(
    decks.flatMap((deck) =>
      (deck.words ?? []).map((row) => key(row.word ?? '')).filter(Boolean),
    ),
  ),
];

/** One sentence per line, without numbering, repeats or fragments. */
export function normalizeDictationSentences(sentences: string[]) {
  const seen = new Set<string>();
  return sentences
    .map((line) => line.replace(/^\s*\d+[.)]\s*/, '').trim())
    .filter((line) => line.split(/\s+/).length >= 3)
    .filter((line) => {
      const id = key(line);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}
