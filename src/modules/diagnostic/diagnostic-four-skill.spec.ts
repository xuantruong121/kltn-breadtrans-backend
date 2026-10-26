import { scoreFourSkillPlacementV2 } from './diagnostic-four-skill';

const items = (section: string, correct: number, total: number) =>
  Array.from({ length: total }, (_, i) => ({
    section,
    isCorrect: i < correct,
  }));

const base = (
  overrides: Partial<Parameters<typeof scoreFourSkillPlacementV2>[0]> = {},
) =>
  scoreFourSkillPlacementV2({
    objective: [
      ...items('LISTENING', 7, 10),
      ...items('READING', 6, 10),
      ...items('LANGUAGE_USE', 1, 5),
    ],
    speakingQuestionIds: [21, 22],
    speaking: [
      { questionId: 21, status: 'GRADED', score: 62.5 },
      { questionId: 22, status: 'GRADED', score: 75 },
    ],
    writingQuestionIds: [23, 24],
    writing: [
      { questionId: 23, status: 'GRADED', score: 50 },
      { questionId: 24, status: 'GRADED', score: 87.5 },
    ],
    ...overrides,
  });

describe('FOUR_SKILL_PLACEMENT_V2', () => {
  it('scores each skill by the blueprint formula and the overall as the equal-weight mean of the four', () => {
    const r = base();
    expect(r.state).toBe('COMPLETE');
    expect(r.skills.LISTENING.score).toBe(70);
    expect(r.skills.READING.score).toBe(60);
    expect(r.skills.SPEAKING.score).toBe(69); // round(68.75)
    expect(r.skills.WRITING.score).toBe(69); // round(68.75)
    expect(r.skills.LANGUAGE_USE.score).toBe(20);
    expect(r.overall).toBe(Math.round((70 + 60 + 69 + 69) / 4)); // 67
  });

  it('Language Use never changes the overall', () => {
    const low = base({
      objective: [
        ...items('LISTENING', 7, 10),
        ...items('READING', 6, 10),
        ...items('LANGUAGE_USE', 0, 5),
      ],
    });
    const high = base({
      objective: [
        ...items('LISTENING', 7, 10),
        ...items('READING', 6, 10),
        ...items('LANGUAGE_USE', 5, 5),
      ],
    });
    expect(low.overall).toBe(high.overall);
    expect(low.skills.LANGUAGE_USE.weight).toBe(0);
  });

  it('withholds Speaking and the overall while a task is still being graded (never 0)', () => {
    const r = base({
      speaking: [
        { questionId: 21, status: 'GRADED', score: 100 },
        { questionId: 22, status: 'QUEUED', score: null },
      ],
    });
    expect(r.state).toBe('PENDING_GRADING');
    expect(r.skills.SPEAKING).toMatchObject({
      state: 'PENDING_GRADING',
      score: null,
    });
    expect(r.overall).toBeNull();
    expect(r.skills.LISTENING.score).toBe(70); // finished skills are still reported
  });

  it('a failed grading leaves the skill and the overall unscored, not 0', () => {
    const r = base({
      writing: [
        { questionId: 23, status: 'GRADED', score: 50 },
        { questionId: 24, status: 'GRADING_FAILED', score: 0 },
      ],
    });
    expect(r.state).toBe('GRADING_FAILED');
    expect(r.skills.WRITING).toMatchObject({
      state: 'GRADING_FAILED',
      score: null,
    });
    expect(r.overall).toBeNull();
  });

  it('pending wins over failed so a running retry stays visible', () => {
    const r = base({
      writing: [
        { questionId: 23, status: 'GRADING', score: null },
        { questionId: 24, status: 'GRADING_FAILED', score: null },
      ],
    });
    expect(r.state).toBe('PENDING_GRADING');
  });

  it('a missing recording leaves Speaking NOT_STARTED and no overall', () => {
    const r = base({
      speaking: [{ questionId: 21, status: 'GRADED', score: 80 }],
    });
    expect(r.skills.SPEAKING.state).toBe('NOT_STARTED');
    expect(r.overall).toBeNull();
  });

  it('never produces a placement band while DEF-004 is open', () => {
    const r = base();
    expect(r.placementBand).toBeNull();
    expect(r.placementBandStatus).toBe('WITHHELD_DEF_004_OPEN');
  });

  it('refuses objective items without a known section instead of guessing from labels', () => {
    expect(() =>
      base({
        objective: [
          { section: undefined, isCorrect: true },
          ...items('LISTENING', 3, 10),
        ],
      }),
    ).toThrow('DIAGNOSTIC_SCORER_V2_UNSCORABLE');
  });

  it('a skill with fewer than 3 scored items reports no score', () => {
    const r = base({
      objective: [
        ...items('LISTENING', 2, 2),
        ...items('READING', 6, 10),
        ...items('LANGUAGE_USE', 1, 5),
      ],
    });
    expect(r.skills.LISTENING).toMatchObject({
      state: 'NOT_STARTED',
      score: null,
    });
    expect(r.overall).toBeNull();
  });
});
