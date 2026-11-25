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
    ipaUs?: string;
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
          // A deck is published only when every word has its phonetics.
          ipaUs: (row.ipaUs ?? '').trim().slice(0, 80),
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

/**
 * A dictation sentence is English: plain ASCII text plus curly quotes,
 * dashes and a few currency signs. A letter with a diacritic (Vietnamese
 * "đặt lịch", or "café") or another script means it is not (QA 2026-11-22:
 * a Vietnamese topic came back as Vietnamese sentences).
 */
const ENGLISH_SENTENCE = /^[\x20-\x7E‘’“”–—…£€]+$/;

export const isEnglishSentence = (line: string) =>
  ENGLISH_SENTENCE.test(line) && /[A-Za-z]/.test(line);

/** One English sentence per line, without numbering, repeats or fragments. */
export function normalizeDictationSentences(sentences: unknown) {
  const seen = new Set<string>();
  return (Array.isArray(sentences) ? sentences : [])
    .filter((line): line is string => typeof line === 'string')
    .map((line) => line.replace(/^\s*\d+[.)]\s*/, '').trim())
    .filter((line) => line.split(/\s+/).length >= 3)
    .filter(isEnglishSentence)
    .filter((line) => {
      const id = key(line);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

/**
 * "Nghe chép" holds at least 10 sentences to publish; a draft asks for 10 to 30
 * (owner 2026-11-25, was 20 since the first quiz module of 2026-09-20).
 */
export const DICTATION_MIN_SENTENCES = 10;
export const DICTATION_MAX_SENTENCES = 30;

export const dictationDraftCount = (count?: number) =>
  Math.min(
    DICTATION_MAX_SENTENCES,
    Math.max(DICTATION_MIN_SENTENCES, Math.round(Number(count) || 0)),
  );

/**
 * A "Nghe chép" full draft from the dictation-lines answer: the cleaned
 * sentences, no shared paragraph and no MCQs. Throws when none survive, so
 * the controller answers 502 instead of an empty draft.
 */
export function dictationFullDraft(
  draft: { title?: unknown; description?: unknown; sentences?: unknown },
  input: { topic: string; level?: string; count?: number },
) {
  const sentences = normalizeDictationSentences(draft?.sentences).slice(
    0,
    dictationDraftCount(input.count),
  );
  if (!sentences.length)
    throw new Error('AI không trả về câu nghe chép tiếng Anh hợp lệ');
  const text = (value: unknown, fallback: string) =>
    typeof value === 'string' && value.trim()
      ? value.trim().slice(0, 1200)
      : fallback;
  return {
    title: text(draft?.title, input.topic).slice(0, 200),
    description: text(draft?.description, ''),
    level: input.level,
    mode: 'DICTATION' as const,
    sentences,
    questions: [],
  };
}

/**
 * The sentences a dictation request must not repeat (owner 2026-11-25: a
 * sentence dropped in the draft review gets a replacement, and a short draft
 * is topped up, without repeating what the lesson already has): one line
 * each, at most 40 lines of 200 characters, no blanks or repeats.
 */
export function dictationAvoidList(avoid: unknown): string[] {
  const seen = new Set<string>();
  return (Array.isArray(avoid) ? avoid : [])
    .filter((line): line is string => typeof line === 'string')
    .map((line) => line.replace(/\s+/g, ' ').trim().slice(0, 200))
    .filter((line) => {
      if (!line || seen.has(sentenceKey(line))) return false;
      seen.add(sentenceKey(line));
      return true;
    })
    .slice(0, 40);
}

/** The new sentences minus any that repeat one the lesson already has. */
export function withoutAvoided(sentences: string[], avoid: string[]): string[] {
  const taken = new Set(avoid.map(sentenceKey));
  return sentences.filter((line) => !taken.has(sentenceKey(line)));
}

/** Two sentences are the same when they differ only in case, spacing or end punctuation. */
const sentenceKey = (line: string) =>
  line
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
