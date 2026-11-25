/**
 * Each picture of "Viết câu theo tranh" is its own exercise (owner 2026-11-24):
 * the catalog lists every picture as a card, so a picture is rewarded on its
 * own first grade with a fifth of what a five-picture set paid (at most 20 XP
 * and 2 to 8 Bánh Mì); five pictures together pay what the set paid.
 *
 * Pure: no Prisma, no I/O.
 */
import { quizBanhReward } from '../gamification/quiz-reward.logic';
import { PICTURE_SENTENCE } from './practice-writing-grading';
import { writingCompletionXp } from './writing-exercise-progress';

/** How many pictures a set held: one picture pays this share of a set. */
export const PICTURES_PER_SET = 5;

export function isPictureTask(content: unknown): boolean {
  return (
    !!content &&
    typeof content === 'object' &&
    (content as { taskType?: unknown }).taskType === PICTURE_SENTENCE
  );
}

/** XP for one picture graded at `percent`: 0 to 20. */
export function pictureTaskXp(percent: number): number {
  return Math.round(writingCompletionXp(percent) / PICTURES_PER_SET);
}

/** Bánh Mì for one picture graded at `percent`: 2 to 8. */
export function pictureTaskBanh(percent: number): number {
  const p = Number.isFinite(percent) ? percent : 0;
  return Math.round(quizBanhReward(p) / PICTURES_PER_SET);
}

/** The reference of a picture's Bánh Mì in the ledger: one per learner and picture. */
export function pictureRewardRef(quizId: number, questionId: number): string {
  return `quiz:${quizId}:q:${questionId}`;
}

/** The learning-history title of a graded picture: its cue words. */
export function pictureActivityTitle(keywords: unknown): string {
  const words = Array.isArray(keywords)
    ? keywords.filter((k): k is string => typeof k === 'string' && !!k.trim())
    : [];
  return words.length
    ? `Viết câu theo tranh: ${words.join(', ')}`
    : 'Viết câu theo tranh';
}

/**
 * Writing items a learner has done, for the progress figure: a picture set
 * counts each graded picture, every other exercise counts once.
 */
export function writingItemsDone(
  submissions: Array<{
    quizId: number;
    firstTaskContent: unknown;
    results: Array<{ questionId: number; score: number | null }>;
  }>,
): number {
  const exercises = new Set<number>();
  const pictures = new Set<number>();
  for (const s of submissions) {
    if (isPictureTask(s.firstTaskContent)) {
      for (const r of s.results)
        if (r.score !== null) pictures.add(r.questionId);
    } else exercises.add(s.quizId);
  }
  return exercises.size + pictures.size;
}
