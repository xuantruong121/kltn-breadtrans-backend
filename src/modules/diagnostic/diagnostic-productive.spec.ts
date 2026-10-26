import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  assessWritingLength,
  checkRecordingDuration,
  countDiagnosticWords,
  DiagnosticGraderError,
  DiagnosticGraderUnavailableError,
  gradeWithRubric,
  normalizeForGrounding,
  summarizeProductiveSkill,
  parseRubric,
  speakingDurationPolicy,
  validateRubricGrade,
  type DiagnosticRubricGrader,
} from './diagnostic-productive';

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

describe('speaking duration policy', () => {
  it('derives the limit from the task response time, never from preparation time', () => {
    expect(
      speakingDurationPolicy({ id: 1, responseSeconds: 45 })
        .configuredResponseMs,
    ).toBe(45_000);
    expect(speakingDurationPolicy({ id: 2, responseSeconds: 60 }).maxMs).toBe(
      60_550,
    );
  });

  it('refuses a task with no response time instead of applying a generic limit', () => {
    for (const bad of [null, undefined, 0, -5, 1.5])
      expect(() =>
        speakingDurationPolicy({ id: 3, responseSeconds: bad as any }),
      ).toThrow(/SPEAKING_TASK_MISCONFIGURED/);
  });

  it('owner bug (attempt 58, q86): a stopwatch longer than the audio is refused; the recording length is accepted', () => {
    // The page used to report wall time from start() to onstop. With a real
    // microphone the first samples arrive late, so the stopwatch ran ~1.8 s
    // past the decoded audio and the confirm answered 400. The page now
    // reports the decoded length of the Blob itself.
    const p = speakingDurationPolicy({ id: 86, responseSeconds: 45 });
    const decoded = 12_000;
    expect(checkRecordingDuration(p, decoded, decoded + 1_800)).toMatchObject({
      ok: false,
      code: 'CLIENT_DURATION_MISMATCH',
    });
    expect(checkRecordingDuration(p, decoded, decoded + 30).ok).toBe(true);
    // No client figure: the server's own measurement decides.
    expect(checkRecordingDuration(p, decoded).ok).toBe(true);
  });

  it('judges the measured duration and cross-checks the client one', () => {
    const p = speakingDurationPolicy({ id: 1, responseSeconds: 45 });
    expect(checkRecordingDuration(p, 45_000, 45_000).ok).toBe(true);
    expect(checkRecordingDuration(p, 45_550).ok).toBe(true);
    expect(checkRecordingDuration(p, 45_551)).toMatchObject({
      ok: false,
      code: 'TOO_LONG',
    });
    expect(checkRecordingDuration(p, 299)).toMatchObject({
      ok: false,
      code: 'TOO_SHORT',
    });
    expect(checkRecordingDuration(p, 30_000, 31_500).ok).toBe(true);
    expect(checkRecordingDuration(p, 30_000, 31_501)).toMatchObject({
      code: 'CLIENT_DURATION_MISMATCH',
    });
    expect(checkRecordingDuration(p, 30_000, Number.NaN)).toMatchObject({
      code: 'CLIENT_DURATION_MISMATCH',
    });
  });
});

describe('writing length', () => {
  it('counts words exactly as the learner page does', () => {
    // Mirrors countWritingWords in the frontend writingExperienceLogic.ts.
    expect(countDiagnosticWords('')).toBe(0);
    expect(countDiagnosticWords('   \n\t ')).toBe(0);
    expect(countDiagnosticWords('one')).toBe(1);
    expect(countDiagnosticWords('  one\ttwo\n\nthree  ')).toBe(3);
    expect(countDiagnosticWords("don't stop - ever")).toBe(4);
  });

  it('turns the approved range into grading flags, not a submission gate', () => {
    const words = (n: number) => Array.from({ length: n }, () => 'w').join(' ');
    expect(assessWritingLength(words(60), 60, 90)).toMatchObject({
      belowMinimum: false,
      belowTwoThirdsMinimum: false,
      aboveMaximum: false,
    });
    expect(assessWritingLength(words(59), 60, 90)).toMatchObject({
      belowMinimum: true,
      belowTwoThirdsMinimum: false,
    });
    expect(assessWritingLength(words(39), 60, 90)).toMatchObject({
      belowTwoThirdsMinimum: true,
    });
    expect(assessWritingLength(words(131), 90, 130)).toMatchObject({
      aboveMaximum: true,
      wordCount: 131,
    });
  });
});

describe('approved rubrics', () => {
  it('parse into four 0-4 criteria for each skill, with the approved keys', () => {
    expect(rubricOf('SPEAKING', 1).criteria.map((c) => c.key)).toEqual([
      'task_fulfilment',
      'intelligibility',
      'fluency',
      'language_use',
    ]);
    expect(rubricOf('WRITING', 2).criteria.map((c) => c.key)).toEqual([
      'task_achievement',
      'organisation',
      'vocabulary',
      'grammar',
    ]);
    for (const c of [
      ...rubricOf('SPEAKING', 1).criteria,
      ...rubricOf('WRITING', 2).criteria,
    ])
      expect([c.min, c.max]).toEqual([0, 4]);
  });

  it('refuses a rubric that cannot support grading', () => {
    expect(() =>
      parseRubric({
        id: 9,
        skill: 'READING',
        rubricVersion: 'x',
        criteria: [],
      }),
    ).toThrow();
    expect(() =>
      parseRubric({
        id: 9,
        skill: 'WRITING',
        rubricVersion: 'x',
        criteria: [],
      }),
    ).toThrow();
    expect(() =>
      parseRubric({
        id: 9,
        skill: 'WRITING',
        rubricVersion: 'x',
        criteria: [
          { criterionKey: 'a', scoreMin: 0, scoreMax: 4 },
          { criterionKey: 'a', scoreMin: 0, scoreMax: 4 },
        ],
      }),
    ).toThrow(/repeats/);
  });
});

describe('grader output contract (aiGradingRequirements + C3 evidence)', () => {
  const rubric = rubricOf('WRITING', 2);
  const responseText =
    'Hi Lan, I am sorry I cannot come on Saturday because my grandmother is ill. Could we meet next week instead?';
  const req = {
    rubric,
    submissionRef: 'writing:5:1',
    skill: 'WRITING' as const,
    responseText,
  };
  const notes = {
    task_achievement: 'Covers apology and reason.',
    organisation: 'Clear simple sequence.',
    vocabulary: 'Adequate everyday words.',
    grammar: 'Mostly accurate sentences.',
  };
  const good = {
    submissionRef: 'writing:5:1',
    rubricVersion: 'WRT_RUBRIC_V3',
    criteria: {
      task_achievement: 3,
      organisation: 2,
      vocabulary: 4,
      grammar: 1,
    },
    criterionFeedback: notes,
    feedback: 'Bài viết rõ ràng, đủ ý xin lỗi và đề xuất thời gian khác.',
    suggestions: ['Thêm lời chào kết.'],
    evidenceQuotes: ['I cannot come on Saturday', 'could we meet next week'],
  };

  it('accepts complete in-range integer output and computes the task percentage', () => {
    const v = validateRubricGrade(req, good);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.grade.taskPercentage).toBeCloseTo((10 / 16) * 100);
      expect(v.grade.criterionFeedback).toEqual(notes);
      expect(v.grade.speechEvidence).toBeNull();
    }
    expect(validateRubricGrade(req, JSON.stringify(good)).ok).toBe(true);
  });

  it.each([
    ['malformed JSON', '{oops', 'MALFORMED_JSON'],
    ['not an object', [1, 2], 'NOT_AN_OBJECT'],
    ['null', null, 'NOT_AN_OBJECT'],
    [
      'another submission',
      { ...good, submissionRef: 'writing:6:1' },
      'DIFFERENT_SUBMISSION',
    ],
    [
      'another rubric version',
      { ...good, rubricVersion: 'WRT_RUBRIC_V2' },
      'DIFFERENT_RUBRIC_VERSION',
    ],
    [
      'rubric version missing',
      { ...good, rubricVersion: undefined },
      'DIFFERENT_RUBRIC_VERSION',
    ],
    ['criteria missing', { ...good, criteria: undefined }, 'CRITERIA_MISSING'],
    ['criteria as array', { ...good, criteria: [3, 2] }, 'CRITERIA_MISSING'],
    [
      'criterion absent',
      { ...good, criteria: { ...good.criteria, grammar: undefined } },
      'CRITERION_ABSENT:grammar',
    ],
    [
      'non-numeric',
      { ...good, criteria: { ...good.criteria, grammar: '3' } },
      'CRITERION_NOT_NUMERIC:grammar',
    ],
    [
      'NaN',
      { ...good, criteria: { ...good.criteria, grammar: Number.NaN } },
      'CRITERION_NOT_NUMERIC:grammar',
    ],
    [
      'Infinity',
      { ...good, criteria: { ...good.criteria, grammar: Infinity } },
      'CRITERION_NOT_NUMERIC:grammar',
    ],
    [
      'out of range',
      { ...good, criteria: { ...good.criteria, grammar: 5 } },
      'CRITERION_OUT_OF_RANGE:grammar',
    ],
    [
      'negative',
      { ...good, criteria: { ...good.criteria, grammar: -1 } },
      'CRITERION_OUT_OF_RANGE:grammar',
    ],
    [
      'fractional',
      { ...good, criteria: { ...good.criteria, grammar: 2.5 } },
      'CRITERION_OUT_OF_RANGE:grammar',
    ],
    [
      'unknown criterion',
      { ...good, criteria: { ...good.criteria, style: 2 } },
      'UNKNOWN_CRITERION:style',
    ],
    [
      'criterion feedback missing',
      { ...good, criterionFeedback: undefined },
      'CRITERION_FEEDBACK_MISSING',
    ],
    [
      'one criterion note empty',
      { ...good, criterionFeedback: { ...notes, grammar: '  ' } },
      'CRITERION_FEEDBACK_MISSING:grammar',
    ],
    [
      'note for an unknown criterion',
      { ...good, criterionFeedback: { ...notes, style: 'Some note here.' } },
      'UNKNOWN_CRITERION:style',
    ],
    ['empty feedback', { ...good, feedback: '   ' }, 'FEEDBACK_MISSING'],
    ['feedback too short', { ...good, feedback: 'Tốt.' }, 'FEEDBACK_TOO_SHORT'],
    [
      'no evidence quotes',
      { ...good, evidenceQuotes: [] },
      'EVIDENCE_QUOTES_MISSING',
    ],
    [
      'evidence quotes not an array',
      { ...good, evidenceQuotes: 'I cannot come' },
      'EVIDENCE_QUOTES_MISSING',
    ],
    [
      'a non-string quote',
      { ...good, evidenceQuotes: ['I cannot come', 3] },
      'EVIDENCE_QUOTES_MISSING',
    ],
    [
      'too many quotes',
      { ...good, evidenceQuotes: Array(6).fill('I cannot come') },
      'EVIDENCE_QUOTES_TOO_MANY',
    ],
    [
      'a paraphrased quote',
      { ...good, evidenceQuotes: ['I am unable to attend'] },
      'EVIDENCE_QUOTE_NOT_IN_RESPONSE',
    ],
    [
      'a quote cut mid-word',
      { ...good, evidenceQuotes: ['annot come'] },
      'EVIDENCE_QUOTE_NOT_IN_RESPONSE',
    ],
  ])('rejects %s', (_label, raw, reason) => {
    expect(validateRubricGrade(req, raw)).toEqual({ ok: false, reason });
  });

  it('grounds quotes ignoring case, punctuation and spacing only', () => {
    expect(normalizeForGrounding('  Hi,   LAN!  ')).toBe('hi lan');
    expect(
      validateRubricGrade(req, {
        ...good,
        evidenceQuotes: ['hi lan i am sorry'],
      }).ok,
    ).toBe(true);
  });

  it('refuses a Writing grade when there is no learner text to ground it', () => {
    expect(validateRubricGrade({ ...req, responseText: '' }, good)).toEqual({
      ok: false,
      reason: 'GRADED_TEXT_MISSING',
    });
  });

  describe('Speaking', () => {
    const spk = rubricOf('SPEAKING', 1);
    const sreq = {
      rubric: spk,
      submissionRef: 'speaking:7:key',
      skill: 'SPEAKING' as const,
    };
    const transcript =
      'I think my favourite place is the park near my house because it is quiet.';
    const sgood = {
      submissionRef: 'speaking:7:key',
      rubricVersion: 'SPK_RUBRIC_V3',
      criteria: {
        task_fulfilment: 3,
        intelligibility: 3,
        fluency: 2,
        language_use: 2,
      },
      criterionFeedback: {
        task_fulfilment: 'Answers the question.',
        intelligibility: 'Easy to follow.',
        fluency: 'Some long pauses.',
        language_use: 'Simple but correct.',
      },
      feedback: 'Bạn trả lời đúng trọng tâm, cần nói liền mạch hơn.',
      suggestions: [],
      evidenceQuotes: ['the park near my house'],
      transcript,
      speechEvidence: { mode: 'UNSCRIPTED_CONTINUOUS' },
    };

    it('accepts a grade carrying the adapter transcript and evidence', () => {
      const v = validateRubricGrade(sreq, sgood);
      expect(v.ok).toBe(true);
      if (v.ok) expect(v.grade.transcript).toBe(transcript);
    });

    it('refuses a grade without speech evidence or transcript', () => {
      expect(
        validateRubricGrade(sreq, { ...sgood, speechEvidence: undefined }),
      ).toEqual({ ok: false, reason: 'SPEECH_EVIDENCE_MISSING' });
      expect(validateRubricGrade(sreq, { ...sgood, transcript: ' ' })).toEqual({
        ok: false,
        reason: 'SPEECH_EVIDENCE_MISSING',
      });
    });

    it('grounds Speaking quotes in the transcript, not in the task prompt', () => {
      expect(
        validateRubricGrade(sreq, {
          ...sgood,
          evidenceQuotes: ['describe a place you like'],
        }),
      ).toEqual({ ok: false, reason: 'EVIDENCE_QUOTE_NOT_IN_RESPONSE' });
    });
  });

  const fake = (
    grade: DiagnosticRubricGrader['grade'],
  ): DiagnosticRubricGrader => ({
    provider: 'fake',
    providerVersion: '1',
    mode: 'mock',
    grade,
  });
  const full = { ...req, taskPrompt: 'p', taskInstructions: null };

  it('retries once on invalid output and never returns an unvalidated score', async () => {
    let n = 0;
    const out = await gradeWithRubric(
      fake(() =>
        Promise.resolve(
          ++n === 1 ? { ...good, criteria: { grammar: 9 } } : good,
        ),
      ),
      full,
    );
    expect(out).toMatchObject({ status: 'GRADED', attempts: 2 });
  });

  it('fails after two invalid outputs, and does not retry an unavailable grader', async () => {
    expect(
      await gradeWithRubric(
        fake(() => Promise.resolve({})),
        full,
      ),
    ).toMatchObject({
      status: 'GRADING_FAILED',
      attempts: 2,
      reason: expect.stringMatching(/^INVALID_GRADER_OUTPUT:/),
    });
    let calls = 0;
    expect(
      await gradeWithRubric(
        fake(() => {
          calls += 1;
          return Promise.reject(new DiagnosticGraderUnavailableError('OFF'));
        }),
        full,
      ),
    ).toMatchObject({ status: 'GRADING_FAILED', reason: 'OFF' });
    expect(calls).toBe(1);
  });

  it.each([
    ['PERMANENT', 'PROVIDER_PERMANENT:AZURE_AuthenticationFailure'],
    [
      'INSUFFICIENT_EVIDENCE',
      'INSUFFICIENT_EVIDENCE:AZURE_AuthenticationFailure',
    ],
    ['NOT_CONFIGURED', 'AZURE_AuthenticationFailure'],
  ] as const)('does not retry a %s failure', async (kind, reason) => {
    let calls = 0;
    const out = await gradeWithRubric(
      fake(() => {
        calls += 1;
        return Promise.reject(
          new DiagnosticGraderError(kind, 'AZURE_AuthenticationFailure'),
        );
      }),
      full,
    );
    expect(out).toMatchObject({ status: 'GRADING_FAILED', reason });
    expect(calls).toBe(1);
  });

  it('retries a transient failure once, then grades', async () => {
    let calls = 0;
    const out = await gradeWithRubric(
      fake(() => {
        calls += 1;
        return calls === 1
          ? Promise.reject(
              new DiagnosticGraderError('TRANSIENT', 'MODEL_HTTP_429'),
            )
          : Promise.resolve(good);
      }),
      full,
    );
    expect(out).toMatchObject({ status: 'GRADED', attempts: 2 });
  });

  it('fails as transient after two transient failures, storing no raw output', async () => {
    const out = await gradeWithRubric(
      fake(() =>
        Promise.reject(
          new DiagnosticGraderError('TRANSIENT', 'MODEL_HTTP_503'),
        ),
      ),
      full,
    );
    expect(out).toEqual({
      status: 'GRADING_FAILED',
      reason: 'PROVIDER_TRANSIENT:MODEL_HTTP_503',
      attempts: 2,
      raw: null,
    });
  });
});

describe('productive skill completion', () => {
  it('scores a skill only when every task is GRADED, rounding once', () => {
    expect(
      summarizeProductiveSkill(
        [1, 2],
        [
          { questionId: 1, status: 'GRADED', score: 62.5 },
          { questionId: 2, status: 'GRADED', score: 75 },
        ],
      ),
    ).toMatchObject({ status: 'COMPLETE', score: 68.8, gradedCount: 2 });
  });

  it('never treats a pending task as zero or averages it away', () => {
    expect(
      summarizeProductiveSkill(
        [1, 2],
        [
          { questionId: 1, status: 'GRADED', score: 100 },
          { questionId: 2, status: 'QUEUED', score: null },
        ],
      ),
    ).toMatchObject({
      status: 'PENDING',
      score: null,
      pendingQuestionIds: [2],
    });
  });

  it('never treats a failed task as zero', () => {
    expect(
      summarizeProductiveSkill(
        [1, 2],
        [
          { questionId: 1, status: 'GRADED', score: 100 },
          { questionId: 2, status: 'GRADING_FAILED', score: 0 },
        ],
      ),
    ).toMatchObject({ status: 'FAILED', score: null, failedQuestionIds: [2] });
  });

  it('reports pending before failed, so a running retry is visible', () => {
    expect(
      summarizeProductiveSkill(
        [1, 2],
        [
          { questionId: 1, status: 'GRADING', score: null },
          { questionId: 2, status: 'GRADING_FAILED', score: null },
        ],
      ).status,
    ).toBe('PENDING');
  });

  it('reports a task with no gradable answer as incomplete', () => {
    expect(
      summarizeProductiveSkill(
        [1, 2],
        [{ questionId: 1, status: 'GRADED', score: 50 }],
      ),
    ).toMatchObject({
      status: 'INCOMPLETE',
      score: null,
      missingQuestionIds: [2],
    });
    expect(
      summarizeProductiveSkill(
        [1],
        [{ questionId: 1, status: 'SKIPPED', score: null }],
      ).status,
    ).toBe('INCOMPLETE');
  });

  it('refuses a GRADED row whose score is not a finite number', () => {
    expect(
      summarizeProductiveSkill(
        [1],
        [{ questionId: 1, status: 'GRADED', score: null }],
      ).score,
    ).toBeNull();
  });

  it('is not applicable to a form without that skill', () => {
    expect(summarizeProductiveSkill([], [])).toMatchObject({
      status: 'NOT_APPLICABLE',
      score: null,
    });
  });
});
