import {
  TRIAL_GRADING_LIMITS,
  canGrantTrial,
  trialGradingsLeft,
  trialLimitMessage,
  trialWindow,
} from './trial.logic';
import {
  decideClaim,
  newReferralCode,
  normalizeReferralCode,
  rewardPlacement,
} from './referral.logic';

const DAY = 86_400_000;
const now = new Date('2026-11-04T10:00:00Z');

describe('trial.logic', () => {
  it('is given once, to an account that never had a plan', () => {
    expect(canGrantTrial({ earlierPlans: 0 })).toBe(true);
    expect(canGrantTrial({ earlierPlans: 1 })).toBe(false);
  });

  it('lasts three days', () => {
    const w = trialWindow(now);
    expect(w.endsAt.getTime() - w.startsAt.getTime()).toBe(3 * DAY);
  });

  it('allows 5 Speaking and 3 Writing gradings', () => {
    expect(TRIAL_GRADING_LIMITS).toEqual({ SPEAKING: 5, WRITING: 3 });
    expect(trialGradingsLeft('SPEAKING', 2)).toBe(3);
    expect(trialGradingsLeft('WRITING', 7)).toBe(0);
    expect(trialLimitMessage('SPEAKING', 4)).toBeNull();
    expect(trialLimitMessage('SPEAKING', 5)).toContain('5/5 lượt chấm Nói');
    expect(trialLimitMessage('WRITING', 3)).toContain(
      'mức Cơ bản vẫn chấm miễn phí',
    );
  });
});

describe('referral.logic', () => {
  const claim = (over: Partial<Parameters<typeof decideClaim>[0]> = {}) =>
    decideClaim({
      referrerId: 1,
      inviteeId: 2,
      inviteeCreatedAt: new Date(now.getTime() - DAY),
      now,
      alreadyReferred: false,
      inviteePaidPurchases: 0,
      ...over,
    });

  it('accepts a new learner entering someone else’s code', () => {
    expect(claim()).toEqual({ ok: true });
  });

  it.each([
    ['UNKNOWN_CODE', { referrerId: null }],
    ['OWN_CODE', { referrerId: 2 }],
    ['ALREADY_REFERRED', { alreadyReferred: true }],
    ['TOO_LATE', { inviteeCreatedAt: new Date(now.getTime() - 8 * DAY) }],
    ['ALREADY_PAID', { inviteePaidPurchases: 1 }],
  ] as const)('refuses %s', (reason, over) => {
    expect(claim(over)).toEqual(expect.objectContaining({ ok: false, reason }));
  });

  it('extends the paid plan that ends last by 7 days', () => {
    const r = rewardPlacement({
      now,
      paidTerms: [
        {
          id: 1,
          endsAt: new Date(now.getTime() + 5 * DAY),
          source: 'PURCHASE',
        },
        {
          id: 2,
          endsAt: new Date(now.getTime() + 35 * DAY),
          source: 'PURCHASE',
        },
      ],
    });
    expect(r).toEqual({
      kind: 'EXTEND',
      subscriptionId: 2,
      newEndsAt: new Date(now.getTime() + 42 * DAY),
    });
  });

  it('takes another number of days (two 7-day Plus cards: 14)', () => {
    const r = rewardPlacement({
      now,
      days: 14,
      paidTerms: [
        { id: 4, endsAt: new Date(now.getTime() + 10 * DAY), source: 'MARKET' },
      ],
    });
    expect(r).toEqual({
      kind: 'EXTEND',
      subscriptionId: 4,
      newEndsAt: new Date(now.getTime() + 24 * DAY),
    });
  });

  it('grants 7 days of PLUS now when there is no paid plan (a trial does not count)', () => {
    const r = rewardPlacement({
      now,
      paidTerms: [
        { id: 3, endsAt: new Date(now.getTime() + 2 * DAY), source: 'TRIAL' },
      ],
    });
    expect(r).toEqual({
      kind: 'GRANT',
      startsAt: now,
      endsAt: new Date(now.getTime() + 7 * DAY),
    });
  });

  it('makes readable codes', () => {
    expect(newReferralCode(() => 0)).toBe('BT-AAAAAA');
    expect(newReferralCode()).toMatch(/^BT-[A-HJ-KM-NP-Z2-9]{6}$/);
    expect(normalizeReferralCode(' bt-7kq 4m2 ')).toBe('BT-7KQ4M2');
  });
});
