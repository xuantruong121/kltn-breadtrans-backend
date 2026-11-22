/**
 * When a vocab deck may be published: the deck editor's checklist ("Trước
 * khi xuất bản"), item for item. The editor, the list's publish icon and the
 * server read this one rule (QA 2026-11-22: the editor's "Kiểm tra & xuất
 * bản" checked nothing and the server only refused a deck with no word).
 * No I/O.
 */

export type DeckStats = {
  total: number;
  withIpa: number;
  withExample: number;
  distinctMeanings: number;
};

/** The quiz step needs this many different meanings for its four options. */
export const QUIZ_MEANINGS = 4;

/** Counted as getVocabTopicSummary counts in the database: not null, not ''. */
const filled = (value?: string | null) => value != null && value !== '';

export type DeckWordEntry = {
  ipaUs?: string | null;
  exampleEn?: string | null;
  meaningVi: string;
};

/** The summary's counts, from words already loaded. */
export function deckStatsFromEntries(entries: DeckWordEntry[]): DeckStats {
  return {
    total: entries.length,
    withIpa: entries.filter((entry) => filled(entry.ipaUs)).length,
    withExample: entries.filter((entry) => filled(entry.exampleEn)).length,
    distinctMeanings: new Set(entries.map((entry) => entry.meaningVi.trim()))
      .size,
  };
}

/**
 * What still blocks publishing, lower case, as the checklist labels it.
 * Empty = ready.
 */
export function vocabDeckProblems(deck: {
  title?: string | null;
  stats: DeckStats;
}): string[] {
  const { total, withIpa, withExample, distinctMeanings } = deck.stats;
  const missing: string[] = [];
  if (!String(deck.title ?? '').trim()) missing.push('có tên bộ từ');
  if (!total) {
    missing.push('có ít nhất 1 từ');
    return missing;
  }
  if (withIpa < total) missing.push(`phiên âm ${withIpa}/${total} từ`);
  if (withExample < total) missing.push(`câu ví dụ ${withExample}/${total} từ`);
  if (distinctMeanings < QUIZ_MEANINGS)
    missing.push(
      `ít nhất ${QUIZ_MEANINGS} nghĩa khác nhau cho bước Trắc nghiệm`,
    );
  return missing;
}
