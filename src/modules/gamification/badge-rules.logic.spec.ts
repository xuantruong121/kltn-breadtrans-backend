import {
  BADGE_DESCRIPTIONS,
  BADGE_RULES,
  countHighSpeaking,
  countPerfectPractices,
  isHighSpeakingScore,
  qualifyingBadges,
  type BadgeFacts,
} from './badge-rules.logic';

const none: BadgeFacts = {
  totalXp: 0,
  weeklyXp: 0,
  isWeeklyTop: false,
  streak: 0,
  perfectPractices: 0,
  highSpeaking: 0,
  longestArenaWinStreak: 0,
  petLevel: 1,
};

describe('qualifyingBadges', () => {
  it('a new learner has none', () => {
    expect(qualifyingBadges(none)).toEqual([]);
  });

  it('the old easy marks no longer earn anything', () => {
    expect(
      qualifyingBadges({
        ...none,
        totalXp: 499,
        streak: 6,
        isWeeklyTop: true,
        weeklyXp: 999,
        perfectPractices: 9,
        highSpeaking: 9,
        longestArenaWinStreak: 4,
        petLevel: 2,
      }),
    ).toEqual([]);
  });

  it('each badge at exactly its mark', () => {
    expect(
      qualifyingBadges({
        totalXp: BADGE_RULES.hunterXp,
        weeklyXp: BADGE_RULES.starWeeklyXp,
        isWeeklyTop: true,
        streak: BADGE_RULES.streakDays,
        perfectPractices: BADGE_RULES.perfectPractices,
        highSpeaking: BADGE_RULES.highSpeaking,
        longestArenaWinStreak: BADGE_RULES.arenaWinStreak,
        petLevel: BADGE_RULES.petLevel,
      }).sort(),
    ).toEqual(Object.keys(BADGE_DESCRIPTIONS).sort());
  });

  it('Siêu Sao needs both the top spot and the weekly XP', () => {
    expect(
      qualifyingBadges({ ...none, isWeeklyTop: false, weeklyXp: 5000 }),
    ).not.toContain('Siêu Sao');
    expect(
      qualifyingBadges({ ...none, isWeeklyTop: true, weeklyXp: 1000 }),
    ).toContain('Siêu Sao');
  });
});

describe('BADGE_DESCRIPTIONS', () => {
  it('writes thousands the Vietnamese way', () => {
    expect(BADGE_DESCRIPTIONS['Thợ Săn'].description).toBe('Tích lũy 5.000 XP');
    expect(BADGE_DESCRIPTIONS['Siêu Sao'].description).toContain('1.000 XP');
  });
});

describe('countPerfectPractices', () => {
  it('counts each practice once, and only attempts with every answer right', () => {
    const right = { isCorrect: true };
    expect(
      countPerfectPractices([
        { quizId: 1, results: [right, right] },
        { quizId: 1, results: [right] },
        { quizId: 2, results: [right, { isCorrect: false }] },
        { quizId: 3, results: [right, { isCorrect: null }] },
        { quizId: 4, results: [] },
        { quizId: 5, results: [right] },
      ]),
    ).toBe(2);
  });
});

describe('countHighSpeaking', () => {
  it('counts each exercise once, at 8/10 or more', () => {
    expect(
      countHighSpeaking([
        { exerciseId: 1, overallScore: 9 },
        { exerciseId: 1, overallScore: 8.5 },
        { exerciseId: 2, overallScore: 7 },
        { exerciseId: 3, overallScore: null },
        { exerciseId: 4, overallScore: 85 },
      ]),
    ).toBe(2);
  });
});

describe('isHighSpeakingScore', () => {
  it('8/10 or more, or 80 on the old 0-100 scale', () => {
    expect(isHighSpeakingScore(8)).toBe(true);
    expect(isHighSpeakingScore(7.9)).toBe(false);
    expect(isHighSpeakingScore(80)).toBe(true);
    expect(isHighSpeakingScore(79)).toBe(false);
    expect(isHighSpeakingScore(null)).toBe(false);
  });
});
