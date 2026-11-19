/**
 * Bánh mì for the first submission of a rewarded practice: 10 to 40 by the
 * percent of the answer (owner 2026-11-18). Listening and Reading sent the
 * number of right answers as `score`, at most 20, so the 0.4 factor never got
 * past the floor and every practice paid 10; they now use `scorePercent`,
 * as Writing (whose score is already a percent) always did.
 */
export const QUIZ_BANH_MIN = 10;
export const QUIZ_BANH_MAX = 40;

export function quizBanhReward(scorePercent: number): number {
  return Math.min(
    QUIZ_BANH_MAX,
    Math.max(QUIZ_BANH_MIN, Math.round(scorePercent * 0.4)),
  );
}

/** The percent of the answer; an event without one keeps using its score. */
export function rewardPercent(payload: {
  score: number;
  scorePercent?: number | null;
}): number {
  const percent = payload.scorePercent;
  return typeof percent === 'number' && Number.isFinite(percent)
    ? percent
    : payload.score;
}
