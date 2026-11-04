/**
 * The free PLUS trial (owner, 2026-11-04): 3 days after the entry
 * diagnostic, once per account, with at most 5 Speaking and 3 Writing
 * gradings on paid-level items. Free-level items stay unlimited, as for any
 * free learner. Pure: no Prisma, no I/O.
 */
export const TRIAL_DAYS = 3;
export const TRIAL_GRADING_LIMITS = { SPEAKING: 5, WRITING: 3 } as const;
export type TrialSkill = keyof typeof TRIAL_GRADING_LIMITS;

const SKILL_NAME: Record<TrialSkill, string> = {
  SPEAKING: 'Nói',
  WRITING: 'Viết',
};

/** A trial is given only to an account that never had a paid plan or a trial. */
export function canGrantTrial(input: { earlierPlans: number }): boolean {
  return input.earlierPlans === 0;
}

export function trialWindow(now: Date): { startsAt: Date; endsAt: Date } {
  return {
    startsAt: now,
    endsAt: new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
  };
}

export function trialGradingsLeft(skill: TrialSkill, used: number): number {
  return Math.max(0, TRIAL_GRADING_LIMITS[skill] - used);
}

/** Why a trial learner cannot have one more grading, or null when allowed. */
export function trialLimitMessage(
  skill: TrialSkill,
  used: number,
): string | null {
  const limit = TRIAL_GRADING_LIMITS[skill];
  if (used < limit) return null;
  return `Bản dùng thử Plus đã dùng hết ${limit}/${limit} lượt chấm ${SKILL_NAME[skill]} ở mức trả phí. Mua gói Plus để chấm tiếp; bài ở mức Cơ bản vẫn chấm miễn phí.`;
}
