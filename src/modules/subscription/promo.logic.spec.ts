import {
  evaluatePromo,
  frozenPriceHolds,
  normalizePromoCode,
  promoDiscountVnd,
  winbackCode,
  type PromoCodeRow,
} from './promo.logic';

const now = new Date('2026-11-04T10:00:00Z');
const promo = (over: Partial<PromoCodeRow> = {}): PromoCodeRow => ({
  id: 5,
  code: 'TET20',
  percentOff: 20,
  validFrom: null,
  validTo: null,
  planCodes: [],
  maxRedemptions: null,
  perUserOnce: true,
  userId: null,
  active: true,
  ...over,
});
const ask = (over: Partial<Parameters<typeof evaluatePromo>[0]> = {}) =>
  evaluatePromo({
    promo: promo(),
    now,
    planCode: 'PLUS',
    userId: 7,
    listPriceVnd: 69_000,
    usedByUser: 0,
    usedTotal: 0,
    ...over,
  });

describe('promoDiscountVnd', () => {
  it('rounds the discount down to a thousand', () => {
    expect(promoDiscountVnd(69_000, 20)).toBe(13_000);
    expect(promoDiscountVnd(149_000, 20)).toBe(29_000);
    expect(promoDiscountVnd(715_000, 10)).toBe(71_000);
  });

  it('never discounts more than 90% or below zero', () => {
    expect(promoDiscountVnd(100_000, 100)).toBe(90_000);
    expect(promoDiscountVnd(100_000, 0)).toBe(0);
    expect(promoDiscountVnd(0, 20)).toBe(0);
  });
});

describe('evaluatePromo', () => {
  it('prices a valid code', () => {
    expect(ask()).toEqual({
      ok: true,
      promoCodeId: 5,
      percentOff: 20,
      listPriceVnd: 69_000,
      discountVnd: 13_000,
      amountVnd: 56_000,
    });
  });

  it.each([
    ['NOT_FOUND', { promo: null }],
    ['INACTIVE', { promo: promo({ active: false }) }],
    [
      'NOT_STARTED',
      { promo: promo({ validFrom: new Date('2026-11-05T00:00:00Z') }) },
    ],
    ['EXPIRED', { promo: promo({ validTo: now }) }],
    ['WRONG_PLAN', { promo: promo({ planCodes: ['PRO'] }) }],
    ['NOT_YOURS', { promo: promo({ userId: 8 }) }],
    ['ALREADY_USED', { usedByUser: 1 }],
    [
      'USED_UP',
      { promo: promo({ maxRedemptions: 3, perUserOnce: false }), usedTotal: 3 },
    ],
  ] as const)('refuses %s', (reason, over) => {
    const decision = ask(over);
    expect(decision).toEqual(expect.objectContaining({ ok: false, reason }));
    expect(decision.ok ? '' : decision.message).toMatch(/\S/);
  });

  it('lets the owner of a personal code use it', () => {
    expect(ask({ promo: promo({ userId: 7 }) }).ok).toBe(true);
  });

  it('lets a reusable code be used again by the same learner', () => {
    expect(
      ask({ promo: promo({ perUserOnce: false }), usedByUser: 2 }).ok,
    ).toBe(true);
  });
});

describe('frozenPriceHolds', () => {
  const base = {
    versionPriceVnd: 69_000,
    listPriceVnd: 69_000,
    discountVnd: 13_000,
    amountVnd: 56_000,
    promoCodeId: 5,
  };

  it('accepts a discounted purchase and a full-price one', () => {
    expect(frozenPriceHolds(base)).toBe(true);
    expect(
      frozenPriceHolds({
        ...base,
        discountVnd: 0,
        amountVnd: 69_000,
        promoCodeId: null,
      }),
    ).toBe(true);
  });

  it('refuses a changed version price, a wrong sum or a discount without a code', () => {
    expect(frozenPriceHolds({ ...base, versionPriceVnd: 79_000 })).toBe(false);
    expect(frozenPriceHolds({ ...base, amountVnd: 50_000 })).toBe(false);
    expect(frozenPriceHolds({ ...base, promoCodeId: null })).toBe(false);
    expect(
      frozenPriceHolds({ ...base, discountVnd: -1, amountVnd: 69_001 }),
    ).toBe(false);
  });
});

describe('codes', () => {
  it('normalizes what the learner typed', () => {
    expect(normalizePromoCode('  tet 20 ')).toBe('TET20');
  });

  it('makes readable win-back codes', () => {
    expect(winbackCode(() => 0)).toBe('QUAYLAI-AAAAAA');
    expect(winbackCode()).toMatch(/^QUAYLAI-[A-HJ-KM-NP-Z2-9]{6}$/);
  });
});
