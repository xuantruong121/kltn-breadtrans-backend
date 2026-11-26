import { isDuelWord, shuffle, type ArenaWord } from './arena-questions.logic';

/**
 * The learner's own hard words in the single-player Arena games (thesis
 * supervisor 2026-11-26: words a learner finds hard or has to relearn in the
 * flashcards are practised again in Pháo Bánh Mì and the free Hầm Bánh Mì).
 * A hard word is one the flashcard room graded "Học lại" (a lapse) or "Khó"
 * (a lower ease). Pure: the caller reads the rows and owns the randomness.
 */

/** At most this many of a game's words are the learner's hard words (owner: 6 of 20). */
export const HARD_WORDS_MAX = 6;
/** In Hầm Bánh Mì they come within the first questions of the bank. */
export const HARD_WORDS_SPAN = 20;
/** The SM-2 starting ease: below it, the learner rated the word "Khó" at least once. */
const START_EASE = 2.5;

export type HardWordRow = {
  /** The dictionary entry the deck word stands for (ArenaWord.id). */
  entryId: number;
  lapses: number;
  easeFactor: number;
  nextReviewAt: Date | null;
};

export const isHardWord = (row: Pick<HardWordRow, 'lapses' | 'easeFactor'>) =>
  row.lapses > 0 || row.easeFactor < START_EASE;

/**
 * Entry ids of the hard words, each once: words due for review first, then
 * the others, shuffled within each group so the games do not always ask the
 * same few.
 */
export function hardWordOrder(
  rows: HardWordRow[],
  now: Date,
  rng: () => number,
): number[] {
  const due = new Set<number>();
  const other = new Set<number>();
  for (const row of rows) {
    if (!isHardWord(row)) continue;
    if (row.nextReviewAt !== null && row.nextReviewAt <= now) {
      due.add(row.entryId);
      other.delete(row.entryId);
    } else if (!due.has(row.entryId)) {
      other.add(row.entryId);
    }
  }
  return [...shuffle([...due], rng), ...shuffle([...other], rng)];
}

/**
 * The hard words a game can use: in the pool (reviewed, in a published deck),
 * fit for the game (`fits`), distinct headwords, in order, at most `max`.
 */
export function pickHardWords(
  pool: readonly ArenaWord[],
  hardIds: readonly number[],
  fits: (w: ArenaWord) => boolean = () => true,
  max = HARD_WORDS_MAX,
): ArenaWord[] {
  const byId = new Map(pool.map((w) => [w.id, w]));
  const heads = new Set<string>();
  const out: ArenaWord[] = [];
  for (const id of hardIds) {
    if (out.length >= max) break;
    const w = byId.get(id);
    if (!w || !isDuelWord(w) || !fits(w)) continue;
    const head = w.headword.toLowerCase();
    if (heads.has(head)) continue;
    heads.add(head);
    out.push(w);
  }
  return out;
}

/** `n` places spread over `span`: floor((k + 0.5) · span / n). */
export function spreadIndexes(n: number, span: number): number[] {
  if (n <= 0 || span <= 0) return [];
  const count = Math.min(n, span);
  return Array.from({ length: count }, (_, k) =>
    Math.floor(((k + 0.5) * span) / count),
  );
}

/** "Trúng 3/4": hard words answered right out of those asked. */
export type HardTally = { hit: number; total: number };
