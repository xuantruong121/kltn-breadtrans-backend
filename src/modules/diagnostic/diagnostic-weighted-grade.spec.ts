/* eslint-disable @typescript-eslint/require-await */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  DiagnosticGraderError,
  gradeWithRubric,
  hasAcousticEvidence,
  parseRubric,
  UNAVAILABLE_ACOUSTIC_FEEDBACK,
  validateRubricGrade,
  type DiagnosticRubricGrader,
} from './diagnostic-productive';
import {
  rubricScoringFor,
  taskWeightingView,
  weightingMetadata,
} from './diagnostic-result-policy.store';

const approved = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '..',
      '..',
      '..',
      'artifacts',
      'entry-diagnostic-v2-rubrics-draft.json',
    ),
    'utf8',
  ),
);
const rubricOf = (skill: string, id: number) => {
  const r = approved.rubrics.find((x: any) => x.skill === skill);
  return parseRubric({
    id,
    skill,
    rubricVersion: r.rubricVersion,
    criteria: r.criteria,
  });
};

const speaking = rubricOf('SPEAKING', 1);
const writing = rubricOf('WRITING', 2);
const TRANSCRIPT =
  'I usually go to the park near my house because it is quiet and green.';
const ESSAY =
  'Dear Lan, I cannot come to the meeting on Friday because I have an exam. Can we meet on Monday instead?';
const acoustic = {
  transcript: TRANSCRIPT,
  azure: { accuracy: 80, fluency: 70, prosody: 60, pronunciation: 75 },
};

function raw(
  rubric: ReturnType<typeof rubricOf>,
  ref: string,
  scores: Record<string, number | null>,
  extra: Record<string, unknown> = {},
) {
  return {
    submissionRef: ref,
    rubricVersion: rubric.version,
    criteria: scores,
    criterionFeedback: Object.fromEntries(
      rubric.criteria.map((c) => [c.key, 'Nhận xét cụ thể cho tiêu chí này.']),
    ),
    feedback: 'Bài làm có ý chính rõ ràng; hãy mở rộng ví dụ cụ thể hơn.',
    suggestions: ['Thêm một ví dụ.'],
    evidenceQuotes: ['the park near my house'],
    ...extra,
  };
}

const spkReq = {
  rubric: speaking,
  submissionRef: 'speaking:1:a',
  skill: 'SPEAKING' as const,
  responseText: undefined,
};
const allFour = Object.fromEntries(speaking.criteria.map((c) => [c.key, 2]));

describe('weighted rubric grading (FOUR_SKILL_OBSERVED_V3)', () => {
  it('without the weighted option the historical plain mean is kept', () => {
    const v = validateRubricGrade(
      spkReq,
      raw(speaking, 'speaking:1:a', allFour, {
        transcript: TRANSCRIPT,
        speechEvidence: acoustic,
      }),
    );
    expect(v.ok && v.grade.taskPercentage).toBe(50);
    expect(v.ok && v.grade.weightingVersion).toBeUndefined();
  });

  it('applies the Speaking weights with acoustic evidence', () => {
    const scores = {
      ...allFour,
      task_fulfilment: 4,
      intelligibility: 0,
    };
    const v = validateRubricGrade(
      spkReq,
      raw(speaking, 'speaking:1:a', scores, {
        transcript: TRANSCRIPT,
        speechEvidence: acoustic,
      }),
      { weighted: true },
    );
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    // 0.3*1 + 0.25*0.5 + 0.25*0.5 + 0.2*0 = 0.55
    expect(Math.round(v.grade.taskPercentage * 10) / 10).toBe(55);
    expect(v.grade.unavailableCriteria).toEqual([]);
    expect(weightingMetadata(v.grade)).toMatchObject({
      weightingVersion: 'DIAG_RUBRIC_WEIGHTS_V1',
      limitedEvidence: false,
    });
  });

  it('T17 transcript without acoustic evidence: intelligibility and fluency are UNAVAILABLE, not credited', () => {
    // The model still sent numbers for the acoustic criteria; they are discarded.
    const scores = {
      ...allFour,
      task_fulfilment: 4,
      intelligibility: 4,
      fluency: 4,
    };
    const v = validateRubricGrade(
      spkReq,
      raw(speaking, 'speaking:1:a', scores, {
        transcript: TRANSCRIPT,
        speechEvidence: { transcript: TRANSCRIPT },
      }),
      { weighted: true },
    );
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.grade.criteria.intelligibility).toBeNull();
    expect(v.grade.criteria.fluency).toBeNull();
    expect(v.grade.criterionFeedback.fluency).toBe(
      UNAVAILABLE_ACOUSTIC_FEEDBACK,
    );
    expect(v.grade.unavailableCriteria?.sort()).toEqual([
      'fluency',
      'intelligibility',
    ]);
    expect(v.grade.assessedWeight).toBe(0.55);
    // (0.3*1 + 0.25*0.5) / 0.55, not inflated by the discarded 4s.
    expect(Math.round(v.grade.taskPercentage * 10) / 10).toBe(
      Math.round((0.425 / 0.55) * 1000) / 10,
    );
    expect(weightingMetadata(v.grade).limitedEvidence).toBe(true);
  });

  it('Speaking without any speech evidence still fails (no transcript-only grade is invented)', () => {
    const v = validateRubricGrade(
      spkReq,
      raw(speaking, 'speaking:1:a', allFour, { transcript: TRANSCRIPT }),
      { weighted: true },
    );
    expect(v).toEqual({ ok: false, reason: 'SPEECH_EVIDENCE_MISSING' });
  });

  it('applies the Writing weights; Writing has no acoustic criteria', () => {
    const scores = {
      task_achievement: 0,
      organisation: 4,
      vocabulary: 4,
      grammar: 4,
    };
    const v = validateRubricGrade(
      {
        rubric: writing,
        submissionRef: 'writing:2:1',
        skill: 'WRITING',
        responseText: ESSAY,
      },
      raw(writing, 'writing:2:1', scores, {
        evidenceQuotes: ['I cannot come to the meeting'],
      }),
      { weighted: true },
    );
    expect(v.ok).toBe(true);
    // T16 shape: fluent language with no task achievement scores 70, not 100.
    if (v.ok) expect(Math.round(v.grade.taskPercentage)).toBe(70);
  });

  it('T14 malformed or contradictory output is rejected, then failed after the retry', async () => {
    let calls = 0;
    const grader: DiagnosticRubricGrader = {
      provider: 'test',
      providerVersion: 't',
      mode: 'mock',
      grade: async () => {
        calls += 1;
        return calls === 1
          ? '{not json'
          : raw(
              speaking,
              'speaking:1:a',
              { ...allFour, fluency: 9 },
              {
                transcript: TRANSCRIPT,
                speechEvidence: acoustic,
              },
            );
      },
    };
    const outcome = await gradeWithRubric(grader, spkReq as never, {
      weighted: true,
    });
    expect(outcome.status).toBe('GRADING_FAILED');
    expect(calls).toBe(2);
    if (outcome.status === 'GRADING_FAILED')
      expect(outcome.reason).toMatch(/CRITERION_OUT_OF_RANGE:fluency/);
  });

  it('T15 a transient failure followed by a valid grade succeeds on the retry', async () => {
    let calls = 0;
    const grader: DiagnosticRubricGrader = {
      provider: 'test',
      providerVersion: 't',
      mode: 'mock',
      grade: async () => {
        calls += 1;
        if (calls === 1)
          throw new DiagnosticGraderError('TRANSIENT', 'TIMEOUT');
        return raw(speaking, 'speaking:1:a', allFour, {
          transcript: TRANSCRIPT,
          speechEvidence: acoustic,
        });
      },
    };
    const outcome = await gradeWithRubric(grader, spkReq as never, {
      weighted: true,
    });
    expect(outcome.status).toBe('GRADED');
    expect(calls).toBe(2);
  });

  it('chooses weighted scoring from the persisted attempt only', async () => {
    const db = (row: unknown) =>
      ({
        diagnosticAttempt: { findUnique: async () => row },
      }) as never;
    const v2 = 'FOUR_SKILL_PLACEMENT_V2';
    // Marked at submission.
    await expect(
      rubricScoringFor(
        db({
          answers: { __resultPolicy: 'FOUR_SKILL_OBSERVED_V3' },
          status: 'COMPLETED',
          scoringVersion: v2,
        }),
        1,
      ),
    ).resolves.toEqual({ weighted: true });
    // Speaking confirmed before submission: will be marked V3 at submit.
    await expect(
      rubricScoringFor(
        db({ answers: {}, status: 'IN_PROGRESS', scoringVersion: v2 }),
        1,
      ),
    ).resolves.toEqual({ weighted: true });
    // Historical completed attempt (no marker), e.g. on a retry: plain mean.
    await expect(
      rubricScoringFor(
        db({ answers: {}, status: 'COMPLETED', scoringVersion: v2 }),
        1,
      ),
    ).resolves.toBeUndefined();
    // Another scorer, or no attempt.
    await expect(
      rubricScoringFor(
        db({ answers: {}, status: 'IN_PROGRESS', scoringVersion: 'X' }),
        1,
      ),
    ).resolves.toBeUndefined();
    await expect(rubricScoringFor(db(null), 1)).resolves.toBeUndefined();
  });

  it('shows the learner the weights and unavailable criteria of a graded task only', () => {
    const meta = {
      weightingVersion: 'DIAG_RUBRIC_WEIGHTS_V1',
      unavailableCriteria: ['fluency', 'intelligibility'],
    };
    expect(taskWeightingView('SPEAKING', true, meta)).toEqual({
      weightingVersion: 'DIAG_RUBRIC_WEIGHTS_V1',
      criterionWeights: {
        task_fulfilment: 0.3,
        language_use: 0.25,
        fluency: 0.25,
        intelligibility: 0.2,
      },
      unavailableCriteria: ['fluency', 'intelligibility'],
      limitedEvidence: true,
    });
    // Not graded, or graded before weighting existed: nothing is claimed.
    for (const view of [
      taskWeightingView('SPEAKING', false, meta),
      taskWeightingView('WRITING', true, {}),
    ])
      expect(view).toEqual({
        weightingVersion: null,
        criterionWeights: null,
        unavailableCriteria: [],
        limitedEvidence: false,
      });
  });

  it('acoustic evidence needs numeric Azure scores', () => {
    expect(hasAcousticEvidence(acoustic)).toBe(true);
    expect(hasAcousticEvidence({ azure: { accuracy: 80 } })).toBe(false);
    expect(hasAcousticEvidence(null)).toBe(false);
  });
});
