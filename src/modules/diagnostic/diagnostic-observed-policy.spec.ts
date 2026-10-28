import {
  OBSERVED_RESULT_POLICY,
  RESULT_POLICY_ANSWER_KEY,
  readResultPolicy,
  round1,
  scoreObservedV3,
  weightedTaskPercentage,
  normalizeTaskStatus,
  type ProductiveOutcome,
} from './diagnostic-observed-policy';

/** 10 Listening, 10 Reading, 5 Language Use items, as on the active form. */
function objective(
  listeningCorrect: number,
  readingCorrect: number,
  luCorrect = 3,
) {
  const items = (section: string, n: number, correct: number) =>
    Array.from({ length: n }, (_, i) => ({ section, isCorrect: i < correct }));
  return [
    ...items('LISTENING', 10, listeningCorrect),
    ...items('READING', 10, readingCorrect),
    ...items('LANGUAGE_USE', 5, luCorrect),
  ];
}
const S = [101, 102];
const W = [201, 202];
const graded = (questionId: number, score: number): ProductiveOutcome => ({
  questionId,
  status: 'GRADED',
  score,
});
const skipped = (questionId: number): ProductiveOutcome => ({
  questionId,
  status: 'SKIPPED',
  score: null,
});
const run = (
  l: number,
  r: number,
  speaking: ProductiveOutcome[] = [],
  writing: ProductiveOutcome[] = [],
) =>
  scoreObservedV3({
    objective: objective(l, r),
    speakingQuestionIds: S,
    speaking,
    writingQuestionIds: W,
    writing,
  });

describe('FOUR_SKILL_OBSERVED_V3 result policy', () => {
  it('T01 objective only: all productive tasks skipped, denominator 0.70', () => {
    const r = run(
      6,
      8,
      [skipped(101), skipped(102)],
      [skipped(201), skipped(202)],
    );
    expect(r.objectiveCore).toBe(70);
    expect(r.observed.denominator).toBe(0.7);
    expect(r.observed.score).toBe(70);
    expect(r.speaking.coverage).toBe('NONE');
    expect(r.speaking.score).toBeNull();
    expect(r.speaking.skipped).toBe(2);
    expect(r.writing.score).toBeNull();
  });

  it('T02/T03 one Speaking task graded (either task), denominator 0.775', () => {
    for (const [g, s] of [
      [101, 102],
      [102, 101],
    ]) {
      const r = run(6, 8, [graded(g, 50), skipped(s)]);
      expect(r.observed.denominator).toBe(0.775);
      // (0.35*60 + 0.35*80 + 0.075*50) / 0.775 = 52.75/0.775 = 68.0645...
      expect(r.observed.score).toBe(68.1);
      expect(r.speaking.coverage).toBe('PARTIAL');
      expect(r.speaking.score).toBe(50);
      expect(r.objectiveCore).toBe(70);
    }
  });

  it('T04 both Speaking tasks graded, denominator 0.85', () => {
    const r = run(6, 8, [graded(101, 50), graded(102, 100)]);
    expect(r.observed.denominator).toBe(0.85);
    // (49 + 3.75 + 7.5) / 0.85 = 70.882...
    expect(r.observed.score).toBe(70.9);
    expect(r.speaking.coverage).toBe('FULL');
    expect(r.speaking.score).toBe(75);
  });

  it('T05/T06/T07 Writing 1/2 (either task) and 2/2', () => {
    expect(
      run(6, 8, [], [graded(201, 40), skipped(202)]).observed.denominator,
    ).toBe(0.775);
    expect(
      run(6, 8, [], [skipped(201), graded(202, 40)]).writing.coverage,
    ).toBe('PARTIAL');
    const both = run(6, 8, [], [graded(201, 40), graded(202, 60)]);
    expect(both.observed.denominator).toBe(0.85);
    expect(both.writing.score).toBe(50);
  });

  it('T08/T09/T10 mixed coverage: denominators 0.85, 0.925, 1.00', () => {
    expect(
      run(5, 5, [graded(101, 80)], [graded(201, 80)]).observed.denominator,
    ).toBe(0.85);
    const three = run(
      5,
      5,
      [graded(101, 80), graded(102, 80)],
      [graded(201, 80)],
    );
    expect(three.observed.denominator).toBe(0.925);
    const all = run(
      5,
      5,
      [graded(101, 100), graded(102, 100)],
      [graded(201, 100), graded(202, 100)],
    );
    expect(all.observed.denominator).toBe(1);
    // 0.35*50 + 0.35*50 + 0.3*100 = 65
    expect(all.observed.score).toBe(65);
    expect(all.coverageWeight).toBe(1);
  });

  it('T11/T12 a graded zero counts with its weight; a skip does not', () => {
    const zero = run(10, 10, [graded(101, 0), skipped(102)]);
    const skip = run(10, 10, [skipped(101), skipped(102)]);
    expect(zero.observed.denominator).toBe(0.775);
    expect(zero.observed.score).toBe(round1(70 / 0.775));
    expect(skip.observed.denominator).toBe(0.7);
    expect(skip.observed.score).toBe(100);
    expect(zero.speaking.score).toBe(0);
    expect(skip.speaking.score).toBeNull();
  });

  it('pending or failed tasks withhold the observed score, never zero it; objective core stays', () => {
    const pending = run(6, 8, [
      { questionId: 101, status: 'QUEUED', score: null },
    ]);
    expect(pending.observed.score).toBeNull();
    expect(pending.observed.withheldReason).toBe('PRODUCTIVE_PENDING');
    expect(pending.objectiveCore).toBe(70);
    expect(pending.speaking.pending).toBe(1);
    const failed = run(
      6,
      8,
      [],
      [{ questionId: 201, status: 'GRADING_FAILED', score: null }],
    );
    expect(failed.observed.score).toBeNull();
    expect(failed.observed.withheldReason).toBe('PRODUCTIVE_FAILED');
    expect(failed.writing.failed).toBe(1);
    expect(failed.writing.score).toBeNull();
  });

  it('a GRADED row without a score is treated as failed, not as zero', () => {
    const r = run(6, 8, [{ questionId: 101, status: 'GRADED', score: null }]);
    expect(r.speaking.tasks[0].status).toBe('GRADING_FAILED');
    expect(r.observed.score).toBeNull();
  });

  it('T18/T19 strong objective with weak productive, and the reverse', () => {
    const t18 = run(
      10,
      10,
      [graded(101, 10), graded(102, 10)],
      [graded(201, 10), graded(202, 10)],
    );
    expect(t18.objectiveCore).toBe(100);
    expect(t18.observed.score).toBe(73); // 70 + 0.3*10
    const t19 = run(2, 2, [graded(101, 95)]);
    expect(t19.objectiveCore).toBe(20);
    expect(t19.speaking.coverage).toBe('PARTIAL');
    // (0.35*20 + 0.35*20 + 0.075*95) / 0.775
    expect(t19.observed.score).toBe(round1(21.125 / 0.775));
  });

  it('T27 invariants: 0..100 bounds and exact edges', () => {
    const min = run(
      0,
      0,
      [graded(101, 0), graded(102, 0)],
      [graded(201, 0), graded(202, 0)],
    );
    expect(min.observed.score).toBe(0);
    expect(min.objectiveCore).toBe(0);
    const max = run(
      10,
      10,
      [graded(101, 100), graded(102, 100)],
      [graded(201, 100), graded(202, 100)],
    );
    expect(max.observed.score).toBe(100);
    for (let l = 0; l <= 10; l += 1)
      for (const score of [0, 33.3, 66.7, 100]) {
        const r = run(
          l,
          10 - l,
          [graded(101, score)],
          [skipped(201), skipped(202)],
        );
        expect(r.observed.score).toBeGreaterThanOrEqual(0);
        expect(r.observed.score).toBeLessThanOrEqual(100);
      }
    expect(() => run(5, 5, [graded(101, 101)])).toThrow(/OUT_OF_RANGE/);
  });

  it('objective skills below the minimum evidence leave no score', () => {
    const r = scoreObservedV3({
      objective: [{ section: 'LISTENING', isCorrect: true }],
      speakingQuestionIds: S,
      speaking: [],
      writingQuestionIds: W,
      writing: [],
    });
    expect(r.objectiveCore).toBeNull();
    expect(r.observed.withheldReason).toBe('OBJECTIVE_INCOMPLETE');
    expect(r.coverageWeight).toBe(0);
  });

  it('Language Use is reported with weight 0 and never moves a score', () => {
    const a = scoreObservedV3({
      objective: objective(6, 8, 0),
      speakingQuestionIds: S,
      speaking: [],
      writingQuestionIds: W,
      writing: [],
    });
    const b = scoreObservedV3({
      objective: objective(6, 8, 5),
      speakingQuestionIds: S,
      speaking: [],
      writingQuestionIds: W,
      writing: [],
    });
    expect(a.languageUse.weight).toBe(0);
    expect(a.observed.score).toBe(b.observed.score);
    expect(b.languageUse.score).toBe(100);
  });

  it('refuses objective items without a scorable section', () => {
    expect(() =>
      scoreObservedV3({
        objective: [{ section: 'GRAMMAR', isCorrect: true }],
        speakingQuestionIds: [],
        speaking: [],
        writingQuestionIds: [],
        writing: [],
      }),
    ).toThrow(/UNSCORABLE/);
  });

  it('task statuses map onto the contract', () => {
    expect(normalizeTaskStatus('QUEUED')).toBe('GRADING_PENDING');
    expect(normalizeTaskStatus('GRADING')).toBe('GRADING_PENDING');
    expect(normalizeTaskStatus('NOT_SUBMITTED')).toBe('NOT_ATTEMPTED');
    expect(normalizeTaskStatus(undefined)).toBe('NOT_ATTEMPTED');
    expect(normalizeTaskStatus('SKIPPED')).toBe('SKIPPED');
  });

  it('the policy marker is read from the attempt answers only', () => {
    expect(
      readResultPolicy({ [RESULT_POLICY_ANSWER_KEY]: OBSERVED_RESULT_POLICY }),
    ).toBe(OBSERVED_RESULT_POLICY);
    expect(readResultPolicy({})).toBeNull();
    expect(readResultPolicy(null)).toBeNull();
  });
});

describe('weighted rubric task percentage', () => {
  const spk = [
    { key: 'task_fulfilment', min: 0, max: 4 },
    { key: 'intelligibility', min: 0, max: 4 },
    { key: 'fluency', min: 0, max: 4 },
    { key: 'language_use', min: 0, max: 4 },
  ];
  const wrt = [
    { key: 'task_achievement', min: 0, max: 4 },
    { key: 'organisation', min: 0, max: 4 },
    { key: 'vocabulary', min: 0, max: 4 },
    { key: 'grammar', min: 0, max: 4 },
  ];

  it('applies 30/25/25/20 to Speaking', () => {
    const r = weightedTaskPercentage('SPEAKING', spk, {
      task_fulfilment: 4,
      intelligibility: 0,
      fluency: 2,
      language_use: 2,
    });
    // 0.3*1 + 0.2*0 + 0.25*0.5 + 0.25*0.5 = 0.55
    expect(round1(r.percentage as number)).toBe(55);
    expect(r.unavailableCriteria).toEqual([]);
    expect(r.assessedWeight).toBe(1);
  });

  it('applies 30/25/20/25 to Writing; all-zero and all-max edges', () => {
    const r = weightedTaskPercentage('WRITING', wrt, {
      task_achievement: 0,
      organisation: 4,
      vocabulary: 4,
      grammar: 4,
    });
    expect(round1(r.percentage as number)).toBe(70);
    expect(
      weightedTaskPercentage('WRITING', wrt, {
        task_achievement: 0,
        organisation: 0,
        vocabulary: 0,
        grammar: 0,
      }).percentage,
    ).toBe(0);
    expect(
      weightedTaskPercentage('WRITING', wrt, {
        task_achievement: 4,
        organisation: 4,
        vocabulary: 4,
        grammar: 4,
      }).percentage,
    ).toBe(100);
  });

  it('T17 unavailable acoustic criteria are excluded and listed, not credited', () => {
    const r = weightedTaskPercentage('SPEAKING', spk, {
      task_fulfilment: 4,
      intelligibility: null,
      fluency: null,
      language_use: 2,
    });
    // (0.3*1 + 0.25*0.5) / 0.55
    expect(round1(r.percentage as number)).toBe(round1((0.425 / 0.55) * 100));
    expect(r.unavailableCriteria).toEqual(['intelligibility', 'fluency']);
    expect(r.assessedWeight).toBe(0.55);
  });

  it('refuses a rubric criterion with no agreed weight', () => {
    expect(() =>
      weightedTaskPercentage('SPEAKING', [{ key: 'accent', min: 0, max: 4 }], {
        accent: 2,
      }),
    ).toThrow(/WEIGHT_MISSING/);
  });
});

describe('V3 view of the stored four-skill result', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { withObservedPolicy } = require('./diagnostic-four-skill.store');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { scoreFourSkillPlacementV2 } = require('./diagnostic-four-skill');
  const input = (
    speaking: ProductiveOutcome[],
    writing: ProductiveOutcome[],
  ) => ({
    objective: objective(6, 8),
    speakingQuestionIds: S,
    speaking,
    writingQuestionIds: W,
    writing,
  });
  const view = (speaking: ProductiveOutcome[], writing: ProductiveOutcome[]) =>
    withObservedPolicy(
      scoreFourSkillPlacementV2(input(speaking, writing)),
      scoreObservedV3(input(speaking, writing)),
    );

  it('T20 one graded Speaking task: skill COMPLETE with coverage 1/2, overall = observed', () => {
    const r = view(
      [graded(101, 50), skipped(102)],
      [skipped(201), skipped(202)],
    );
    expect(r.skills.SPEAKING.state).toBe('COMPLETE');
    expect(r.skills.SPEAKING.score).toBe(50);
    expect(r.skills.SPEAKING.itemsScored).toBe(1);
    expect(r.skills.SPEAKING.itemsTotal).toBe(2);
    expect(r.skills.WRITING.state).toBe('NOT_STARTED');
    expect(r.skills.WRITING.score).toBeNull();
    expect(r.overall).toBe(68.1);
    expect(r.state).toBe('COMPLETE');
    expect(r.observed.speaking.coverage).toBe('PARTIAL');
  });

  it('pending grading keeps the skill and the attempt pending, overall withheld', () => {
    const r = view([{ questionId: 101, status: 'GRADING', score: null }], []);
    expect(r.skills.SPEAKING.state).toBe('PENDING_GRADING');
    expect(r.state).toBe('PENDING_GRADING');
    expect(r.overall).toBeNull();
    expect(r.observed.objectiveCore).toBe(70);
  });

  it('a failed task keeps the attempt in GRADING_FAILED, never a zero', () => {
    const r = view(
      [],
      [{ questionId: 202, status: 'GRADING_FAILED', score: null }],
    );
    expect(r.skills.WRITING.state).toBe('GRADING_FAILED');
    expect(r.skills.WRITING.score).toBeNull();
    expect(r.state).toBe('GRADING_FAILED');
  });
});

describe('objective breakdown', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { buildObjectiveBreakdown } = require('./diagnostic-observed-policy');
  it('groups correct/total by difficulty tier and subskill per section', () => {
    const b = buildObjectiveBreakdown([
      {
        section: 'LISTENING',
        difficulty: 'D1',
        subskill: 'gist',
        isCorrect: true,
      },
      {
        section: 'LISTENING',
        difficulty: 'D1',
        subskill: 'inference',
        isCorrect: false,
      },
      {
        section: 'LISTENING',
        difficulty: 'D3',
        subskill: 'inference',
        isCorrect: false,
      },
      { section: 'READING', difficulty: null, subskill: null, isCorrect: true },
    ]);
    expect(b.LISTENING.byDifficulty).toEqual([
      { key: 'D1', correct: 1, total: 2 },
      { key: 'D3', correct: 0, total: 1 },
    ]);
    expect(b.LISTENING.bySubskill).toEqual([
      { key: 'gist', correct: 1, total: 1 },
      { key: 'inference', correct: 0, total: 2 },
    ]);
    expect(b.READING.byDifficulty).toEqual([
      { key: 'UNSPECIFIED', correct: 1, total: 1 },
    ]);
    expect(b.LANGUAGE_USE.byDifficulty).toEqual([]);
  });
});
