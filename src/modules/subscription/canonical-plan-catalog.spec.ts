import { CANONICAL_PLAN_CATALOG } from './canonical-plan-catalog';

describe('CANONICAL_PLAN_CATALOG', () => {
  const paid = CANONICAL_PLAN_CATALOG.filter((p) => p.code !== 'FREE');

  it('sells PLUS and PRO for 30, 90 and 180 days, one version per term', () => {
    for (const code of ['PLUS', 'PRO']) {
      const terms = paid
        .filter((p) => p.code === code)
        .map((p) => p.durationDays);
      expect(terms).toEqual([30, 90, 180]);
    }
  });

  it('uses the prices the owner set on 2026-11-04', () => {
    const price = (code: string, days: number) =>
      paid.find((p) => p.code === code && p.durationDays === days)?.priceVnd;
    expect([price('PLUS', 30), price('PLUS', 90), price('PLUS', 180)]).toEqual([
      69_000, 186_000, 331_000,
    ]);
    expect([price('PRO', 30), price('PRO', 90), price('PRO', 180)]).toEqual([
      149_000, 402_000, 715_000,
    ]);
  });

  it('makes a longer term cheaper per day, within the promised discount', () => {
    for (const code of ['PLUS', 'PRO']) {
      const base = paid.find((p) => p.code === code && p.durationDays === 30)!;
      const monthly = base.priceVnd;
      for (const [days, discount] of [
        [90, 0.1],
        [180, 0.2],
      ] as const) {
        const plan = paid.find(
          (p) => p.code === code && p.durationDays === days,
        )!;
        const full = (monthly * days) / 30;
        const saved = 1 - plan.priceVnd / full;
        expect(saved).toBeGreaterThanOrEqual(discount);
        expect(saved).toBeLessThan(discount + 0.01);
      }
    }
  });

  it('gives every term of a plan the same features and the plan the same name', () => {
    for (const code of ['PLUS', 'PRO']) {
      const terms = paid.filter((p) => p.code === code);
      expect(new Set(terms.map((t) => t.displayName)).size).toBe(1);
      expect(
        new Set(terms.map((t) => [...t.features].sort().join())).size,
      ).toBe(1);
    }
  });
});
