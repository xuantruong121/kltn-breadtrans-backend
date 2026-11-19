/**
 * Flashcard XP (owner 2026-11-18): the first time a learner knows a word it
 * pays 2 XP, at most 150 a day (Vietnam day), kept apart from the Arena's
 * own 150. Flashcards still pay no Bánh mì and move no daily quest.
 * The live catalog has 344 words, so 688 XP is the most a learner can earn
 * here, over at least five days.
 */
export const VOCAB_XP_PER_WORD = 2;
export const VOCAB_XP_DAILY_CAP = 150;
export const VOCAB_XP_REASON = 'Thuộc từ vựng';

/** One award per word: its reason names the word. */
export const vocabWordXpReason = (wordId: number) =>
  `${VOCAB_XP_REASON} #${wordId}`;

/** XP for one newly known word, given the flashcard XP earned today. */
export function vocabWordXp(earnedToday: number): number {
  return Math.max(
    0,
    Math.min(VOCAB_XP_PER_WORD, VOCAB_XP_DAILY_CAP - earnedToday),
  );
}
