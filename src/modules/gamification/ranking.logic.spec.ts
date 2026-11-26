import {
  activityText,
  leagueStanding,
  maskName,
  periodStart,
  streakMilestone,
  weeklyNextTier,
  xpLevel,
} from './ranking.logic';

describe('xpLevel', () => {
  it('Lv. L at 50·L·(L−1) XP', () => {
    expect(xpLevel(0)).toBe(1);
    expect(xpLevel(99)).toBe(1);
    expect(xpLevel(100)).toBe(2);
    expect(xpLevel(299)).toBe(2);
    expect(xpLevel(300)).toBe(3);
    expect(xpLevel(600)).toBe(4);
    expect(xpLevel(14_080)).toBe(17);
    expect(xpLevel(-5)).toBe(1);
  });
});

describe('maskName', () => {
  it('keeps the first word and the initial of the last', () => {
    expect(maskName('Nguyễn Văn An')).toBe('Nguyễn A.');
    expect(maskName('  Trần   bình ')).toBe('Trần B.');
    expect(maskName('Tín')).toBe('Tín');
    expect(maskName('')).toBe('Học viên');
    expect(maskName(null)).toBe('Học viên');
  });
});

describe('periodStart', () => {
  // 03:00 on Wednesday 11 Nov 2026 in Vietnam.
  const now = new Date('2026-11-10T20:00:00Z');
  it('today, this week from Monday, this month, all time, in Vietnam time', () => {
    // Every period starts at 00:01 like the learner day (owner 24/11).
    expect(periodStart('today', now)!.toISOString()).toBe(
      '2026-11-10T17:01:00.000Z',
    );
    expect(periodStart('week', now)!.toISOString()).toBe(
      '2026-11-08T17:01:00.000Z',
    );
    expect(periodStart('month', now)!.toISOString()).toBe(
      '2026-10-31T17:01:00.000Z',
    );
    expect(periodStart('all', now)).toBeNull();
  });
  it('a Monday starts its own week', () => {
    const monday = new Date('2026-11-09T01:00:00Z'); // 08:00 Monday in Vietnam
    expect(periodStart('week', monday)!.toISOString()).toBe(
      '2026-11-08T17:01:00.000Z',
    );
  });
});

describe('streakMilestone', () => {
  it('reports a milestone only when it is crossed', () => {
    expect(streakMilestone(6, 7)).toBe(7);
    expect(streakMilestone(7, 8)).toBeNull();
    expect(streakMilestone(2, 3)).toBe(3);
    expect(streakMilestone(5, 1)).toBeNull();
  });
});

describe('leagueStanding', () => {
  it('a tier of 10: top 2 go up, from rank 9 down', () => {
    const s = leagueStanding({
      tier: 'Vàng',
      tierSize: 10,
      rankInTier: 5,
      myXp: 80,
      cutoffXp: 200,
      safeXp: 50,
    });
    expect(s).toMatchObject({
      promoteCount: 2,
      demoteFrom: 9,
      xpToPromotion: 121,
      inDemotionZone: false,
    });
    expect(
      leagueStanding({
        tier: 'Vàng',
        tierSize: 10,
        rankInTier: 2,
        myXp: 210,
        cutoffXp: 210,
        safeXp: 50,
      }).xpToPromotion,
    ).toBe(0);
    const low = leagueStanding({
      tier: 'Vàng',
      tierSize: 10,
      rankInTier: 9,
      myXp: 10,
      cutoffXp: 200,
      safeXp: 40,
    });
    expect(low).toMatchObject({ inDemotionZone: true, xpToLeaveDemotion: 31 });
  });
  it('Đồng never goes down, Kim Cương never goes up', () => {
    expect(
      leagueStanding({
        tier: 'Đồng',
        tierSize: 10,
        rankInTier: 10,
        myXp: 0,
        cutoffXp: 5,
        safeXp: 1,
      }).inDemotionZone,
    ).toBe(false);
    expect(
      leagueStanding({
        tier: 'Kim Cương',
        tierSize: 10,
        rankInTier: 1,
        myXp: 900,
        cutoffXp: null,
        safeXp: 1,
      }).xpToPromotion,
    ).toBeNull();
  });
});

describe('activityText', () => {
  it('words each source, and leaves out mastered words', () => {
    expect(
      activityText({ kind: 'activity', type: 'READING_PRACTICE_COMPLETED' }),
    ).toEqual({ text: 'vừa hoàn thành 1 bài luyện đọc', kind: 'study' });
    expect(
      activityText({ kind: 'activity', type: 'VOCABULARY_MASTERED' }),
    ).toBeNull();
    expect(activityText({ kind: 'badge', name: 'Học Bá' })!.text).toBe(
      'vừa nhận huy hiệu Học Bá',
    );
    expect(activityText({ kind: 'arena_win' })!.kind).toBe('arena');
    expect(
      activityText({ kind: 'event', type: 'LEVEL_UP', value: 13 })!.text,
    ).toBe('vừa lên Cấp 13');
    expect(
      activityText({ kind: 'event', type: 'STREAK_MILESTONE', value: 7 })!.text,
    ).toBe('vừa đạt chuỗi 7 ngày');
  });
  it('a Hầm Bánh Mì run reaches the feed only from floor 10', () => {
    expect(
      activityText({ kind: 'event', type: 'DUNGEON_DAILY', value: 9 }),
    ).toBeNull();
    expect(
      activityText({ kind: 'event', type: 'DUNGEON_FREE', value: 12 }),
    ).toEqual({
      text: 'vừa xuống tới tầng 12 Hầm Bánh Mì',
      kind: 'arena',
    });
  });
});

describe('weeklyNextTier (owner 2026-11-26: no promotion without XP)', () => {
  it('keeps a learner alone in a tier where they are with 0 XP that week', () => {
    expect(
      weeklyNextTier({
        tier: 'Vàng',
        indexInTier: 0,
        tierSize: 1,
        weeklyExp: 0,
      }),
    ).toBe('Vàng');
  });

  it('moves the same learner up with some XP', () => {
    expect(
      weeklyNextTier({
        tier: 'Vàng',
        indexInTier: 0,
        tierSize: 1,
        weeklyExp: 16,
      }),
    ).toBe('Bạch Kim');
  });

  it('still takes the bottom 20 % down, XP or not', () => {
    // a tier of 10: places 0-1 go up, 8-9 go down
    expect(
      weeklyNextTier({
        tier: 'Bạc',
        indexInTier: 8,
        tierSize: 10,
        weeklyExp: 40,
      }),
    ).toBe('Đồng');
    expect(
      weeklyNextTier({
        tier: 'Bạc',
        indexInTier: 1,
        tierSize: 10,
        weeklyExp: 0,
      }),
    ).toBe('Bạc');
    expect(
      weeklyNextTier({
        tier: 'Bạc',
        indexInTier: 1,
        tierSize: 10,
        weeklyExp: 5,
      }),
    ).toBe('Vàng');
  });

  it('never goes below Đồng or above Kim Cương', () => {
    expect(
      weeklyNextTier({
        tier: 'Đồng',
        indexInTier: 4,
        tierSize: 5,
        weeklyExp: 0,
      }),
    ).toBe('Đồng');
    expect(
      weeklyNextTier({
        tier: 'Kim Cương',
        indexInTier: 0,
        tierSize: 3,
        weeklyExp: 900,
      }),
    ).toBe('Kim Cương');
  });
});

describe('leagueStanding with no XP this week', () => {
  it('says one XP is still needed in a promotion place', () => {
    expect(
      leagueStanding({
        tier: 'Bạch Kim',
        tierSize: 1,
        rankInTier: 1,
        myXp: 0,
        cutoffXp: 0,
        safeXp: null,
      }).xpToPromotion,
    ).toBe(1);
  });
});
