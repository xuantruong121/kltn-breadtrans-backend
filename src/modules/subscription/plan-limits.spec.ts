import {
  PLAN_LIMITS,
  aiGradingLimitMessage,
  planCodeOf,
  planLimits,
  revisionLimitMessage,
  streakFreezesForPlan,
} from './plan-limits';

describe('plan-limits', () => {
  it('holds the numbers the owner set on 2026-11-11', () => {
    expect(PLAN_LIMITS).toEqual({
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
    });
  });

  it('never gives a lower plan more than a higher one', () => {
    const order = [PLAN_LIMITS.FREE, PLAN_LIMITS.PLUS, PLAN_LIMITS.PRO];
    for (const key of [
      'aiGradingPerDay',
      'tutorPerDay',
      'writingRevisions',
      'streakFreezesPer30Days',
    ] as const) {
      expect(order[0][key]).toBeLessThanOrEqual(order[1][key]);
      expect(order[1][key]).toBeLessThanOrEqual(order[2][key]);
    }
  });

  it('reads an unknown or missing plan as FREE', () => {
    expect(planCodeOf(' pro ')).toBe('PRO');
    expect(planCodeOf('plus')).toBe('PLUS');
    for (const value of [null, undefined, '', 'GOLD', 'FREE'])
      expect(planCodeOf(value)).toBe('FREE');
    expect(planLimits(undefined)).toBe(PLAN_LIMITS.FREE);
  });

  it('gives streak freezes for each whole 30 days bought', () => {
    expect(streakFreezesForPlan('PLUS', 30)).toBe(1);
    expect(streakFreezesForPlan('PLUS', 90)).toBe(3);
    expect(streakFreezesForPlan('PRO', 30)).toBe(3);
    expect(streakFreezesForPlan('PRO', 180)).toBe(18);
    expect(streakFreezesForPlan('FREE', 30)).toBe(0);
    // A short grant, or a plan without a duration, gives none.
    expect(streakFreezesForPlan('PRO', 7)).toBe(0);
    expect(streakFreezesForPlan('PRO', null)).toBe(0);
  });

  it('names the plan and the next plan when gradings run out', () => {
    expect(aiGradingLimitMessage('FREE')).toBe(
      'Bạn đã dùng hết 10 lượt AI chấm của hôm nay (gói Free). Lượt chấm được làm mới vào ngày mai. Gói Plus có 30 lượt mỗi ngày.',
    );
    expect(aiGradingLimitMessage('PLUS')).toContain('Gói Pro có 60 lượt');
    expect(aiGradingLimitMessage('PRO')).not.toContain('Gói');
  });

  it('says why a revision is refused', () => {
    expect(revisionLimitMessage('FREE')).toBe(
      'Sửa và nộp lại là quyền lợi của gói Plus và Pro.',
    );
    expect(revisionLimitMessage('PLUS')).toBe(
      'Bạn đã dùng hết 2 lần sửa cho bài viết này. Gói Pro được sửa 5 lần mỗi bài.',
    );
    expect(revisionLimitMessage('PRO')).toBe(
      'Bạn đã dùng hết 5 lần sửa cho bài viết này.',
    );
  });
});
