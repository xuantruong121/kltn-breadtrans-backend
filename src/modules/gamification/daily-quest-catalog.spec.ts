import {
  DAILY_QUEST_POOL,
  questDefinition,
  questsForDay,
  questTypeForSpeaking,
  questTypesForQuiz,
} from './daily-quest-catalog';

const SPEAKING = ['DO_SPEAKING', 'PRACTICE_SPEAKING'];

function days(count: number) {
  const start = Date.UTC(2026, 10, 1);
  return Array.from({ length: count }, (_, i) =>
    new Date(start + i * 86_400_000).toISOString().slice(0, 10),
  );
}

describe('daily quest catalog', () => {
  it('gives the same three quests all day', () => {
    const first = questsForDay(7, '2026-11-03').map((q) => q.type);
    expect(first).toHaveLength(3);
    expect(new Set(first).size).toBe(3);
    expect(questsForDay(7, '2026-11-03').map((q) => q.type)).toEqual(first);
  });

  it('rotates across days, and over two weeks every quest comes up', () => {
    const seen = new Set<string>();
    const sets = new Set<string>();
    for (const day of days(14))
      for (const userId of [1, 2, 3]) {
        const types = questsForDay(userId, day).map((q) => q.type);
        types.forEach((type) => seen.add(type));
        sets.add(types.join(','));
      }
    expect([...seen].sort()).toEqual(
      DAILY_QUEST_POOL.map((q) => q.type).sort(),
    );
    expect(sets.size).toBeGreaterThan(3);
  });

  it('never gives both speaking quests on one day', () => {
    for (const day of days(60))
      for (const userId of [1, 2, 3, 4, 5]) {
        const speaking = questsForDay(userId, day).filter((q) =>
          SPEAKING.includes(q.type),
        );
        expect(speaking.length).toBeLessThanOrEqual(1);
      }
  });

  it('balances effort and reward between the two speaking quests', () => {
    expect(questDefinition('DO_SPEAKING')).toEqual(
      expect.objectContaining({ targetValue: 1, rewardBanh: 10 }),
    );
    expect(questDefinition('PRACTICE_SPEAKING')).toEqual(
      expect.objectContaining({ targetValue: 3, rewardBanh: 10 }),
    );
  });

  it('maps a finished practice to the quests it advances', () => {
    expect(questTypesForQuiz('LISTENING_PRACTICE', 80)).toEqual([
      'DO_LISTENING',
    ]);
    expect(questTypesForQuiz('BILINGUAL_READING', 100)).toEqual([
      'DO_READING',
      'PERFECT_QUIZ',
    ]);
    expect(questTypesForQuiz('WRITING_PICTURE', 100)).toEqual(['DO_WRITING']);
    expect(questTypesForQuiz(undefined, 100)).toEqual([]);
  });

  it('counts one speaking exercise for exactly one speaking quest', () => {
    expect(questTypeForSpeaking('READ_ALOUD')).toBe('PRACTICE_SPEAKING');
    expect(questTypeForSpeaking('PRONUNCIATION_DRILL')).toBe(
      'PRACTICE_SPEAKING',
    );
    for (const task of [
      'RESPOND_TO_QUESTION',
      'RESPOND_USING_INFORMATION',
      'DESCRIBE_PICTURE',
      'EXPRESS_OPINION',
    ])
      expect(questTypeForSpeaking(task)).toBe('DO_SPEAKING');
    expect(questTypeForSpeaking(null)).toBeNull();
  });
});
