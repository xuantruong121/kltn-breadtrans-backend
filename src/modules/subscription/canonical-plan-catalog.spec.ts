import {
  CANONICAL_PLAN_CATALOG,
  ensureCanonicalPlanCatalog,
} from './canonical-plan-catalog';

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

describe('plan descriptions', () => {
  it('state the numbers the checks use (plan-limits.ts)', () => {
    const text = (code: string) =>
      CANONICAL_PLAN_CATALOG.find(
        (p) => p.code === code && p.durationDays === 30,
      )!.description;
    expect(text('PLUS')).toBe(
      'Mở Nói, Viết Trung cấp và Nghe chép mọi mức; AI chấm 30 bài mỗi ngày, sửa và nộp lại bài viết 2 lần mỗi bài, tặng 1 khiên giữ chuỗi mỗi 30 ngày. Thời hạn 30 ngày.',
    );
    expect(text('PRO')).toContain('đề TOEIC Speaking & Writing, 4 kỹ năng');
    expect(text('PRO')).toContain('AI chấm 60 bài mỗi ngày');
    expect(text('PRO')).toContain('5 lần mỗi bài');
    expect(text('PRO')).toContain('3 khiên giữ chuỗi');
  });
});

describe('ensureCanonicalPlanCatalog', () => {
  it('updates the text of a current version in place, without a new version', async () => {
    const versions = CANONICAL_PLAN_CATALOG.map((spec, i) => ({
      id: 100 + i,
      planId: spec.code === 'FREE' ? 1 : spec.code === 'PLUS' ? 2 : 3,
      version: 1,
      displayName: spec.versionName,
      description: i === 1 ? 'Chữ cũ' : spec.description,
      durationDays: spec.durationDays,
      priceVnd: spec.priceVnd,
      currency: 'VND',
      entitlements: spec.features.map((featureKey) => ({ featureKey })),
    }));
    const tx = {
      plan: {
        upsert: jest.fn(({ where }: any) =>
          Promise.resolve({
            id: where.code === 'FREE' ? 1 : where.code === 'PLUS' ? 2 : 3,
          }),
        ),
      },
      planVersion: {
        findMany: jest.fn(({ where }: any) =>
          Promise.resolve(
            versions.filter(
              (v) =>
                v.planId === where.planId &&
                v.durationDays === where.durationDays,
            ),
          ),
        ),
        update: jest.fn(),
        updateMany: jest.fn(),
        create: jest.fn(),
        aggregate: jest.fn(),
      },
    };
    const prisma = { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) };

    const results = await ensureCanonicalPlanCatalog(prisma as any);

    expect(tx.planVersion.create).not.toHaveBeenCalled();
    expect(tx.planVersion.updateMany).not.toHaveBeenCalled();
    expect(tx.planVersion.update).toHaveBeenCalledTimes(1);
    expect(tx.planVersion.update).toHaveBeenCalledWith({
      where: { id: 101 },
      data: {
        displayName: CANONICAL_PLAN_CATALOG[1].versionName,
        description: CANONICAL_PLAN_CATALOG[1].description,
      },
    });
    expect(results.every((r) => !r.createdVersion)).toBe(true);
  });
});
