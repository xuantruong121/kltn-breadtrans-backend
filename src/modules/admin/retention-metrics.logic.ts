/**
 * Retention and renewal figures for the admin page. No Prisma, no I/O: the
 * service loads the rows and these functions do the counting, so every
 * definition below is pinned by a spec.
 *
 * Days and weeks follow Vietnam time (UTC+7, no daylight saving), the same
 * calendar the streak uses. A week starts on Monday.
 */
const DAY_MS = 86_400_000;
const VN_OFFSET_MS = 7 * 3_600_000;

export type Rate = {
  /** Rows old enough for the figure to be final. */
  eligible: number;
  hits: number;
  /** hits / eligible, or null when nothing is eligible yet. */
  rate: number | null;
};

export function rate(hits: number, eligible: number): Rate {
  return { eligible, hits, rate: eligible > 0 ? hits / eligible : null };
}

/** Days since 1970-01-01 on the Vietnam calendar. */
export function vnDayIndex(date: Date): number {
  return Math.floor((date.getTime() + VN_OFFSET_MS) / DAY_MS);
}

/** The Monday (yyyy-mm-dd, Vietnam calendar) of the week holding `date`. */
export function vnWeekStart(date: Date): string {
  const day = vnDayIndex(date);
  // Day 0 (1970-01-01) was a Thursday, so (day + 3) % 7 is 0 on Mondays.
  const monday = day - ((day + 3) % 7);
  return new Date(monday * DAY_MS).toISOString().slice(0, 10);
}

export type CohortRow = {
  weekStart: string;
  signups: number;
  d1: Rate;
  d7: Rate;
  d30: Rate;
};

/**
 * Weekly signup cohorts with unbounded Day-N retention: a learner counts as
 * retained at day N when they did any learning on day N after signing up or
 * later. Only the last learning day of each learner is needed for that.
 * A learner is eligible at day N once day N has arrived.
 */
export function cohortRetention(input: {
  learners: Array<{ id: number; createdAt: Date }>;
  lastActiveAt: Map<number, Date>;
  now: Date;
}): CohortRow[] {
  const today = vnDayIndex(input.now);
  const weeks = new Map<string, CohortRow>();
  for (const learner of input.learners) {
    const week = vnWeekStart(learner.createdAt);
    const row = weeks.get(week) ?? {
      weekStart: week,
      signups: 0,
      d1: rate(0, 0),
      d7: rate(0, 0),
      d30: rate(0, 0),
    };
    row.signups += 1;
    const signupDay = vnDayIndex(learner.createdAt);
    const last = input.lastActiveAt.get(learner.id);
    const lastDay = last ? vnDayIndex(last) : -Infinity;
    for (const [key, n] of [
      ['d1', 1],
      ['d7', 7],
      ['d30', 30],
    ] as const) {
      if (signupDay + n > today) continue;
      const hit = lastDay >= signupDay + n ? 1 : 0;
      row[key] = rate(row[key].hits + hit, row[key].eligible + 1);
    }
    weeks.set(week, row);
  }
  return [...weeks.values()].sort((a, b) =>
    b.weekStart.localeCompare(a.weekStart),
  );
}

export type RenewalRow = {
  weekStart: string;
  /** Paid subscriptions that ended this week. */
  ended: number;
  /** Bought the next plan before day +7 after the end (early included). */
  renewed: Rate;
  /** Bought the next plan on or before the end day. */
  early: Rate;
  /** Did not renew by day +7, then came back by day +30. */
  wonBack: Rate;
  /** Of those won back, how many paid with a promo code (win-back or admin). */
  wonBackWithCode: number;
};

const RENEW_GRACE_DAYS = 7;
const WIN_BACK_DAYS = 30;

/**
 * For every paid subscription that has ended, the next plan the same learner
 * paid for decides the outcome. "Next" is the earliest completed purchase
 * after the one that created this subscription, so a renewal bought 20 days
 * early counts, and the subscription's own purchase never does.
 *
 * An upgrade from Plus to Pro ends the Plus subscription at the moment the
 * Pro purchase completes, so it counts as an early renewal.
 */
export function renewalByWeek(input: {
  ended: Array<{
    userId: number;
    endsAt: Date;
    purchaseId: number;
    purchasedAt: Date;
  }>;
  purchases: Array<{
    id: number;
    userId: number;
    completedAt: Date;
    withCode?: boolean;
  }>;
  now: Date;
}): RenewalRow[] {
  type Paid = { id: number; at: number; withCode: boolean };
  const byUser = new Map<number, Paid[]>();
  for (const purchase of input.purchases) {
    const list = byUser.get(purchase.userId) ?? [];
    list.push({
      id: purchase.id,
      at: purchase.completedAt.getTime(),
      withCode: purchase.withCode ?? false,
    });
    byUser.set(purchase.userId, list);
  }
  const now = input.now.getTime();
  const weeks = new Map<string, RenewalRow>();
  for (const sub of input.ended) {
    const endsAt = sub.endsAt.getTime();
    if (endsAt > now) continue;
    const week = vnWeekStart(sub.endsAt);
    const row = weeks.get(week) ?? {
      weekStart: week,
      ended: 0,
      renewed: rate(0, 0),
      early: rate(0, 0),
      wonBack: rate(0, 0),
      wonBackWithCode: 0,
    };
    row.ended += 1;

    const ownAt = sub.purchasedAt.getTime();
    const nextPaid = (byUser.get(sub.userId) ?? [])
      .filter((p) => p.id !== sub.purchaseId && p.at > ownAt)
      .reduce<Paid | null>(
        (min, p) => (min === null || p.at < min.at ? p : min),
        null,
      );
    const next = nextPaid?.at ?? null;
    const graceEnd = endsAt + RENEW_GRACE_DAYS * DAY_MS;
    const winBackEnd = endsAt + WIN_BACK_DAYS * DAY_MS;
    const renewed = next !== null && next <= graceEnd;

    // The early share is final at the end day; the others need their window
    // to close first.
    row.early = rate(
      row.early.hits + (next !== null && next <= endsAt ? 1 : 0),
      row.early.eligible + 1,
    );
    if (graceEnd <= now) {
      row.renewed = rate(
        row.renewed.hits + (renewed ? 1 : 0),
        row.renewed.eligible + 1,
      );
    }
    // Win-back is measured among those who had not renewed by day +7.
    if (winBackEnd <= now && !renewed) {
      const back = next !== null && next <= winBackEnd;
      row.wonBack = rate(
        row.wonBack.hits + (back ? 1 : 0),
        row.wonBack.eligible + 1,
      );
      if (back && nextPaid?.withCode) row.wonBackWithCode += 1;
    }
    weeks.set(week, row);
  }
  return [...weeks.values()].sort((a, b) =>
    b.weekStart.localeCompare(a.weekStart),
  );
}

/** The latest of several optional dates, or null. */
export function latest(...dates: Array<Date | null | undefined>): Date | null {
  return dates.reduce<Date | null>(
    (max, d) => (d && (!max || d > max) ? d : max),
    null,
  );
}
