import { focusOf, weakFocus, focusKindsFor } from './weak-focus.logic';

const speaking = (intelligibility: number | null, others = 3) => ({
  skill: 'SPEAKING' as const,
  criteria: {
    intelligibility,
    fluency: others,
    task_fulfilment: others,
    language_use: others,
  },
});

describe('weakFocus', () => {
  it('finds the lowest criterion across tasks', () => {
    const [focus] = weakFocus([speaking(1), speaking(2)]);
    expect(focus.label).toBe('phát âm');
    expect(focus.kinds).toContain('READ_ALOUD');
  });

  it('names none when every criterion is equal', () => {
    expect(weakFocus([speaking(3)])).toEqual([]);
  });

  it('ignores a criterion a task did not report', () => {
    const [focus] = weakFocus([
      speaking(1),
      speaking(null, 2),
      {
        skill: 'SPEAKING',
        criteria: { fluency: 1, task_fulfilment: 2, language_use: 2 },
      },
    ]);
    expect(focus.label).not.toBe('phát âm');
  });

  it('keeps speaking and writing apart', () => {
    const list = weakFocus([
      speaking(1),
      {
        skill: 'WRITING',
        criteria: {
          task_achievement: 3,
          organisation: 1,
          vocabulary: 3,
          grammar: 3,
        },
      },
    ]);
    expect(list.map((f) => f.label)).toEqual(['phát âm', 'bố cục bài viết']);
  });

  it('handles no graded tasks', () => {
    expect(weakFocus([])).toEqual([]);
  });
});

describe('focusOf', () => {
  const focus = weakFocus([speaking(1)]);

  it('matches on skill and kind', () => {
    expect(
      focusOf({ skill: 'SPEAKING', kinds: ['READ_ALOUD'] }, focus)?.label,
    ).toBe('phát âm');
    expect(
      focusOf({ skill: 'SPEAKING', kinds: ['EXPRESS_OPINION'] }, focus),
    ).toBeNull();
    expect(
      focusOf({ skill: 'WRITING', kinds: ['READ_ALOUD'] }, focus),
    ).toBeNull();
  });
});

describe('focusKindsFor', () => {
  it('names the practice kinds that train a criterion', () => {
    expect(focusKindsFor('SPEAKING', 'intelligibility')).toEqual([
      'READ_ALOUD',
      'PRONUNCIATION_DRILL',
    ]);
    expect(focusKindsFor('WRITING', 'task_achievement')).toEqual([
      'WRITING_EMAIL',
    ]);
    expect(focusKindsFor('WRITING', 'unknown')).toEqual([]);
  });
});
