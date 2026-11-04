/**
 * An AI exam job that stops because every provider is out (quota spent,
 * provider down) waits and resumes from its checkpoint, instead of being
 * marked FAILED after three retries five and ten seconds apart.
 *
 * It resumes 5 minutes after the earliest recorded quota reset; with no reset
 * recorded (an outage without a known end) it tries again in 30 minutes. After
 * MAX_QUOTA_WAITS waits it fails as before, so a job never waits forever.
 */
export const MAX_QUOTA_WAITS = 3;
const AFTER_RESET_MS = 5 * 60 * 1000;
const UNKNOWN_END_MS = 30 * 60 * 1000;

export function quotaWaitResumeAt(input: {
  isOutage: boolean;
  /** When each spent provider resets (Redis ai:provider-exhausted:*). */
  spentUntil: Array<Date | null>;
  waitsSoFar: number;
  now: Date;
}): Date | null {
  if (!input.isOutage || input.waitsSoFar >= MAX_QUOTA_WAITS) return null;
  const resets = input.spentUntil
    .filter(
      (date): date is Date => !!date && date.getTime() > input.now.getTime(),
    )
    .map((date) => date.getTime());
  return resets.length
    ? new Date(Math.min(...resets) + AFTER_RESET_MS)
    : new Date(input.now.getTime() + UNKNOWN_END_MS);
}
