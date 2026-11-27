import { isDuelWord, shuffle, type ArenaWord } from './arena-questions.logic';

/**
 * The learner's own hard words in the single-player Arena games (thesis
 * supervisor 2026-11-26: words a learner finds hard or has to relearn in the
 * flashcards are practised again in Pháo Bánh Mì and the free Hầm Bánh Mì).
 * A hard word is one the flashcard room graded "Học lại" (a lapse) or "Khó"
 * (a lower ease) and has not yet been recalled across a week (owner 2026-11-27,
 * rule A). Each one goes into the games once a learner day (rule B). Pure: the
 * caller reads the rows and the day's record, and owns the randomness.
 */

/** At most this many of a game's words are the learner's hard words (owner: 6 of 20). */
export const HARD_WORDS_MAX = 6;
/** In Hầm Bánh Mì they come within the first questions of the bank. */
export const HARD_WORDS_SPAN = 20;
/** The SM-2 starting ease: below it, the learner rated the word "Khó" at least once. */
const START_EASE = 2.5;
/**
 * A word stops being hard once its review interval reaches a week: the learner
 * has since recalled it across a week. A lapse is counted for good and the ease
 * only climbs back with "Dễ", so without this a word forgotten once, or once
 * graded "Khó", stayed "hay quên" for ever (owner 2026-11-27).
 */
export const HARD_UNTIL_DAYS = 7;
/** How long a learner day's record of the hard words put into a game is kept. */
export const HARD_SHOWN_TTL_S = 2 * 86_400;
/** The Redis set of the hard words put into a game on a learner day. */
export const hardShownKey = (userId: number, dayKey: string) =>
  `arena:hard-shown:${userId}:${dayKey}`;

export type HardWordRow = {
  /** The dictionary entry the deck word stands for (ArenaWord.id). */
  entryId: number;
  lapses: number;
  easeFactor: number;
  /** The current review interval in days. */
  intervalDays: number;
  nextReviewAt: Date | null;
};

export const isHardWord = (
  row: Pick<HardWordRow, 'lapses' | 'easeFactor' | 'intervalDays'>,
) =>
  (row.lapses > 0 || row.easeFactor < START_EASE) &&
  row.intervalDays < HARD_UNTIL_DAYS;

/**
 * Entry ids of the hard words, each once: words due for review first, then
 * the others, shuffled within each group so the games do not always ask the
 * same few. `shownToday`: the ones already put into a game this learner day;
 * they wait for tomorrow (three games in a row asked the same few words within
 * minutes, owner 2026-11-27).
 */
export function hardWordOrder(
  rows: HardWordRow[],
  now: Date,
  rng: () => number,
  shownToday: ReadonlySet<number> = new Set(),
): number[] {
  const due = new Set<number>();
  const other = new Set<number>();
  for (const row of rows) {
    if (!isHardWord(row) || shownToday.has(row.entryId)) continue;
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
