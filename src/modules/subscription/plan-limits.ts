/**
 * What each plan gives beyond the practice levels it opens (owner
 * 2026-11-11). Every number a plan decides lives here, so the comparison
 * table and the checks cannot drift apart:
 *
 *   aiGradingPerDay         Speaking and Writing answers graded by AI per day
 *   tutorPerDay             questions to the tutor per day
 *   writingRevisions        "Sửa và nộp lại" per first Writing answer
 *   toeicProductive         TOEIC Speaking & Writing and four-skill exams
 *   streakFreezesPer30Days  streak shields ("khiên giữ chuỗi") given with each 30 days bought
 *
 * A learner on a PLUS trial is on PLUS. An unknown or missing plan is FREE.
 * The practice-level policy (which CEFR levels a plan opens) stays in
 * practice-level.ts.
 *
 * Pure: no Prisma, no I/O.
 */
export type PlanLimits = {
  aiGradingPerDay: number;
  tutorPerDay: number;
  writingRevisions: number;
  toeicProductive: boolean;
  streakFreezesPer30Days: number;
};

export const PLAN_LIMITS: Record<'FREE' | 'PLUS' | 'PRO', PlanLimits> = {
  FREE: {
    aiGradingPerDay: 10,
    tutorPerDay: 10,
    writingRevisions: 0,
    toeicProductive: false,
    streakFreezesPer30Days: 0,
  },
  PLUS: {
    aiGradingPerDay: 30,
    tutorPerDay: 30,
    writingRevisions: 2,
    toeicProductive: false,
    streakFreezesPer30Days: 1,
  },
  PRO: {
    aiGradingPerDay: 60,
    tutorPerDay: 100,
    writingRevisions: 5,
    toeicProductive: true,
    streakFreezesPer30Days: 3,
  },
};

export type PlanCode = keyof typeof PLAN_LIMITS;

/** The plan code as the limits know it; anything else is FREE. */
export function planCodeOf(planCode?: string | null): PlanCode {
  const code = String(planCode ?? '')
    .trim()
    .toUpperCase();
  return code === 'PLUS' || code === 'PRO' ? code : 'FREE';
}

export function planLimits(planCode?: string | null): PlanLimits {
  return PLAN_LIMITS[planCodeOf(planCode)];
}

export const PLAN_LABEL: Record<PlanCode, string> = {
  FREE: 'Free',
  PLUS: 'Plus',
  PRO: 'Pro',
};

/**
 * Streak freezes given with a plan of `durationDays`: the plan's number for
 * each whole 30 days. A plan without a duration gives none.
 */
export function streakFreezesForPlan(
  planCode: string | null | undefined,
  durationDays: number | null | undefined,
): number {
  const days = Number(durationDays);
  if (!Number.isFinite(days) || days < 30) return 0;
  return Math.floor(days / 30) * planLimits(planCode).streakFreezesPer30Days;
}

/** What a learner is told when the day's AI gradings are used up. */
export function aiGradingLimitMessage(planCode?: string | null): string {
  const code = planCodeOf(planCode);
  const limit = PLAN_LIMITS[code].aiGradingPerDay;
  const base = `Bạn đã dùng hết ${limit} lượt AI chấm của hôm nay (gói ${PLAN_LABEL[code]}). Lượt chấm được làm mới vào ngày mai.`;
  if (code === 'PRO') return base;
  const next: PlanCode = code === 'FREE' ? 'PLUS' : 'PRO';
  return `${base} Gói ${PLAN_LABEL[next]} có ${PLAN_LIMITS[next].aiGradingPerDay} lượt mỗi ngày.`;
}

/** What a learner is told when the plan allows no (more) revisions. */
export function revisionLimitMessage(planCode?: string | null): string {
  const code = planCodeOf(planCode);
  const limit = PLAN_LIMITS[code].writingRevisions;
  if (limit === 0) return 'Sửa và nộp lại là quyền lợi của gói Plus và Pro.';
  const base = `Bạn đã dùng hết ${limit} lần sửa cho bài viết này.`;
  return code === 'PRO'
    ? base
    : `${base} Gói Pro được sửa ${PLAN_LIMITS.PRO.writingRevisions} lần mỗi bài.`;
}

/**
 * TOEIC Speaking & Writing and four-skill exams are graded by AI and belong
 * to Pro; Listening & Reading exams are open to every plan.
 */
export function toeicFamilyNeedsPro(productFamily: string): boolean {
  return productFamily === 'TOEIC_SW' || productFamily === 'TOEIC_4_SKILLS';
}

/** What an exam card needs to show a lock: the plan it asks for, and whether this learner has it. */
export function toeicExamLock(
  productFamily: string,
  planCode: string | null | undefined,
): { requiredPlan: 'FREE' | 'PRO'; isLocked: boolean } {
  if (!toeicFamilyNeedsPro(productFamily))
    return { requiredPlan: 'FREE', isLocked: false };
  return {
    requiredPlan: 'PRO',
    isLocked: !planLimits(planCode).toeicProductive,
  };
}

export const TOEIC_PRODUCTIVE_PLAN_MESSAGE =
  'Đề TOEIC Speaking & Writing và đề 4 kỹ năng là quyền lợi của gói Pro.';
