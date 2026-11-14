/**
 * What a learner has used of today's allowances (owner 2026-11-13: "Gói của
 * tôi" shows them so a learner knows before running out). Pure: the Redis
 * counters come in as raw strings.
 *
 * The counters are the ones the limits themselves keep: AiRateLimitGuard's
 * ai_quota (Speaking and Writing gradings) and the tutor's tutor_quota, per
 * Vietnam day. The guard counts a refused request too, so "used" is capped at
 * the limit.
 */
import {
  getBusinessDayKey,
  getBusinessDayStart,
} from '../../common/time/business-time.util';
import { planLimits, type PlanCode } from './plan-limits';

export type DailyAllowance = { limit: number; used: number; remaining: number };

export type DailyUsage = {
  planCode: PlanCode;
  /** When the counters start again: 00:00 tomorrow, Vietnam time. */
  resetsAt: string;
  aiGrading: DailyAllowance;
  tutor: DailyAllowance;
};

export function allowance(
  limit: number,
  raw: string | null | undefined,
): DailyAllowance {
  const counted = Math.trunc(Number(raw ?? 0));
  const used = Math.min(
    limit,
    Math.max(0, Number.isFinite(counted) ? counted : 0),
  );
  return { limit, used, remaining: limit - used };
}

/** 00:00 of the Vietnam day after `now`. */
export function nextBusinessDayStart(now: Date): Date {
  const tomorrow = getBusinessDayKey(
    new Date(now.getTime() + 24 * 3600 * 1000),
  );
  return getBusinessDayStart(tomorrow);
}

export function buildDailyUsage(
  planCode: PlanCode,
  aiRaw: string | null | undefined,
  tutorRaw: string | null | undefined,
  now: Date,
): DailyUsage {
  const limits = planLimits(planCode);
  return {
    planCode,
    resetsAt: nextBusinessDayStart(now).toISOString(),
    aiGrading: allowance(limits.aiGradingPerDay, aiRaw),
    tutor: allowance(limits.tutorPerDay, tutorRaw),
  };
}
