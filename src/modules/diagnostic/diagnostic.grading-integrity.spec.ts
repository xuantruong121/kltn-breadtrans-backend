/**
 * Phase C1: objective grading correctness, attempt authority, task-type
 * validation and the learner delivery contract.
 *
 * Every grading assertion here goes through the REAL grader
 * (isDiagnosticAnswerCorrect / resolveAuthoredOptionIndex) or the REAL
 * service. The test this replaces only checked that a permutation array was a
 * permutation, which is true of every permutation and proved nothing.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';

import {
  classifyDiagnosticTask,
  evaluateAssessmentReadiness,
  getAttemptQuestionPermutation,
  getLearnerQuestionPermutation,
  isDiagnosticAnswerCorrect,
  LEARNER_PERMUTATION_SCHEME,
  resolveAuthoredOptionIndex,
  validateDiagnosticContent,
  validateQuestionBank,
  validateRuntimeReadiness,
} from './diagnostic.logic';
import { DiagnosticService } from './diagnostic.service';

function allPermutations(n: number): number[][] {
  if (n === 1) return [[0]];
  const out: number[][] = [];
  for (const rest of allPermutations(n - 1))
    for (let i = 0; i <= rest.length; i += 1)
      out.push([...rest.slice(0, i), n - 1, ...rest.slice(i)]);
  return out;
}

const mcq = (
  id: number,
  correctIndex: number,
  options = ['A', 'B', 'C', 'D'],
) => ({
  id,
  skill: 'Reading',
  question: `Q${id}`,
  options,
  correctIndex,
  explanation: null,
  order: id,
});

describe('objective grader (actual function)', () => {
  const permutations = allPermutations(4);

  it('enumerates exactly the 24 orderings of four options', () => {
    expect(permutations).toHaveLength(24);
    expect(new Set(permutations.map((p) => p.join(''))).size).toBe(24);
  });

  it('grades correctly under every one of the 24 permutations, for every key position', () => {
    let checks = 0;
    for (const permutation of permutations) {
      for (let key = 0; key < 4; key += 1) {
        const question = mcq(1, key);
        // permutation maps displayed position -> authored option.
        const displayedKey = permutation.indexOf(key);
        for (let clicked = 0; clicked < 4; clicked += 1) {
          expect(
            isDiagnosticAnswerCorrect(question, clicked, permutation),
          ).toBe(clicked === displayedKey);
          expect(
            resolveAuthoredOptionIndex(question, clicked, permutation),
          ).toBe(permutation[clicked]);
          checks += 2;
        }
      }
    }
    expect(checks).toBe(24 * 4 * 4 * 2);
  });

  it('grades correctly across many question ids and learners with the real learner permutation', () => {
    for (const userId of [7, 18, 1001])
      for (const assessmentId of [1, 5])
        for (let questionId = 1; questionId <= 40; questionId += 1) {
          const key = questionId % 4;
          const question = mcq(questionId, key);
          const permutation = getLearnerQuestionPermutation(
            userId,
            assessmentId,
            questionId,
            4,
          );
          const displayedKey = permutation.indexOf(key);
          for (let clicked = 0; clicked < 4; clicked += 1)
            expect(
              isDiagnosticAnswerCorrect(question, clicked, permutation),
            ).toBe(clicked === displayedKey);
        }
  });

  it('FAILS CLOSED without a permutation: a displayed index is never compared to the authored key', () => {
    const question = mcq(1, 2);
    // The former grader returned true here, because 2 === correctIndex.
    expect(isDiagnosticAnswerCorrect(question, 2)).toBe(false);
    expect(isDiagnosticAnswerCorrect(question, 2, undefined)).toBe(false);
    expect(resolveAuthoredOptionIndex(question, 2)).toBeNull();
  });

  it('fails closed on an invalid permutation', () => {
    const question = mcq(1, 0);
    for (const bad of [
      [0, 1, 2],
      [0, 1, 2, 3, 4],
      [0, 0, 1, 2],
      [0, 1, 2, 7],
      [0, 1, 2, -1],
    ])
      for (let clicked = 0; clicked < 4; clicked += 1)
        expect(resolveAuthoredOptionIndex(question, clicked, bad)).toBeNull();
  });

  it('fails closed on an out-of-range or malformed index instead of falling back', () => {
    const question = mcq(1, 0);
    const permutation = [3, 2, 1, 0];
    for (const bad of [
      -1,
      4,
      99,
      1.5,
      Number.NaN,
      Infinity,
      '1',
      true,
      [],
      { index: 9 },
    ])
      expect(resolveAuthoredOptionIndex(question, bad, permutation)).toBeNull();
    // `permutation[4]` is undefined: the old code then compared 4 === key.
    expect(isDiagnosticAnswerCorrect(mcq(1, 3), 4, permutation)).toBe(false);
  });

  it('accepts option text as a permutation-independent identity, only when unambiguous', () => {
    const question = mcq(1, 1, ['red', 'blue', 'green', 'grey']);
    expect(isDiagnosticAnswerCorrect(question, 'blue')).toBe(true);
    expect(isDiagnosticAnswerCorrect(question, ' blue ')).toBe(true);
    expect(isDiagnosticAnswerCorrect(question, { text: 'blue' })).toBe(true);
    expect(isDiagnosticAnswerCorrect(question, 'red')).toBe(false);
    expect(isDiagnosticAnswerCorrect(question, 'purple')).toBe(false);
    const duplicated = mcq(2, 0, ['same', 'other', 'same', 'x']);
    expect(resolveAuthoredOptionIndex(duplicated, 'same')).toBeNull();
  });

  it('refuses a client-declared authored index', () => {
    const question = mcq(1, 2);
    expect(isDiagnosticAnswerCorrect(question, { originalIndex: 2 })).toBe(
      false,
    );
    expect(
      resolveAuthoredOptionIndex(question, { originalIndex: 2 }),
    ).toBeNull();
  });

  it('never grades a productive task as objective', () => {
    const task = {
      id: 9,
      skill: 'Speaking',
      question: 'Talk',
      options: { values: [], questionType: 'OPEN_TEXT', section: 'SPEAKING' },
      correctIndex: -1,
      order: 9,
    };
    expect(isDiagnosticAnswerCorrect(task, -1, [0])).toBe(false);
    expect(resolveAuthoredOptionIndex(task, 'anything')).toBeNull();
  });
});

describe('learner display permutation', () => {
  it('is deterministic and independent of any attempt', () => {
    const a = getLearnerQuestionPermutation(7, 1, 3, 4);
    expect(getLearnerQuestionPermutation(7, 1, 3, 4)).toEqual(a);
    expect([...a].sort()).toEqual([0, 1, 2, 3]);
  });

  it('differs between learners, so the order is not one global shuffle', () => {
    const forUser = (u: number) =>
      Array.from({ length: 20 }, (_, q) =>
        getLearnerQuestionPermutation(u, 1, q + 1, 4).join(''),
      ).join('|');
    expect(forUser(7)).not.toEqual(forUser(8));
  });

  it('actually moves keys: many distinct orderings occur over 200 questions', () => {
    const seen = new Set<string>();
    for (let q = 1; q <= 200; q += 1)
      seen.add(getLearnerQuestionPermutation(18, 5, q, 4).join(''));
    expect(seen.size).toBeGreaterThan(12);
  });
});

describe('task-type-aware validation', () => {
  const speaking = (over: Record<string, unknown> = {}) => ({
    id: 20,
    skill: 'Speaking',
    question: 'Describe your weekend.',
    options: { values: [], questionType: 'OPEN_TEXT', section: 'SPEAKING' },
    correctIndex: -1,
    order: 20,
    taskType: 'SPEAKING_RESPONSE',
    rubricId: 1,
    prepSeconds: 15,
    responseSeconds: 45,
    ...over,
  });
  const writing = (over: Record<string, unknown> = {}) => ({
    id: 21,
    skill: 'Writing',
    question: 'Write an email.',
    options: { values: [], questionType: 'OPEN_TEXT', section: 'WRITING' },
    correctIndex: -1,
    order: 21,
    taskType: 'WRITING_RESPONSE',
    rubricId: 2,
    wordMin: 60,
    wordMax: 90,
    ...over,
  });
  const listening = (audioUrl: string | null) => ({
    id: 22,
    skill: 'Listening',
    question: 'What does the speaker want?',
    options: {
      values: ['a', 'b', 'c', 'd'],
      questionType: 'MCQ',
      section: 'LISTENING',
      audioGroup: 'LST_C_01',
      audioUrl,
    },
    correctIndex: 1,
    order: 22,
    taskType: 'MCQ',
  });
  const reading = (over: Record<string, unknown> = {}) => ({
    id: 23,
    skill: 'Reading',
    question: 'Main idea?',
    options: {
      values: ['a', 'b', 'c', 'd'],
      questionType: 'MCQ',
      section: 'READING',
      passageText: 'Đoạn đọc\nA complete passage.',
    },
    correctIndex: 0,
    order: 23,
    taskType: 'MCQ',
    passageId: 3,
    ...over,
  });

  it('accepts productive tasks with no options, no answer key and no CEFR label', () => {
    expect(validateDiagnosticContent([speaking(), writing()])).toEqual([]);
  });

  it('does not require correctIndex -1 or intendedLevel on productive tasks', () => {
    expect(validateDiagnosticContent([speaking({ correctIndex: 0 })])).toEqual(
      [],
    );
  });

  it('rejects productive tasks that carry fake options or lack a rubric', () => {
    const withOptions = speaking({
      options: {
        values: ['x', 'y'],
        questionType: 'OPEN_TEXT',
        section: 'SPEAKING',
      },
    });
    expect(validateDiagnosticContent([withOptions])).toContain(
      'productive task carries options 20',
    );
    expect(validateDiagnosticContent([writing({ rubricId: null })])).toContain(
      'productive task without rubric 21',
    );
  });

  it('rejects invalid recording and word constraints', () => {
    expect(
      validateDiagnosticContent([speaking({ responseSeconds: 0 })]),
    ).toContain('invalid speaking response time 20');
    expect(
      validateDiagnosticContent([writing({ wordMin: 100, wordMax: 90 })]),
    ).toContain('invalid writing word bounds 21');
  });

  it('flags a task whose taskType contradicts its options', () => {
    const contradiction = speaking({
      options: { values: [], questionType: 'MCQ', section: 'SPEAKING' },
    });
    expect(classifyDiagnosticTask(contradiction)).toBe('INCONSISTENT');
    expect(validateDiagnosticContent([contradiction])).toContain(
      'inconsistent task type 20',
    );
  });

  it('keeps Listening audio a RUNTIME requirement, not a content one', () => {
    expect(validateDiagnosticContent([listening(null)])).toEqual([]);
    expect(validateRuntimeReadiness([listening(null)])).toEqual([
      'missing listening audio 22',
    ]);
    expect(validateRuntimeReadiness([listening('https://cdn/x.mp3')])).toEqual(
      [],
    );
    // The learner runtime gate still enforces both layers.
    expect(validateQuestionBank([listening(null)])).toContain(
      'missing listening audio 22',
    );
  });

  it('requires a Reading item to carry its passage', () => {
    expect(validateDiagnosticContent([reading()])).toEqual([]);
    expect(
      validateDiagnosticContent([
        reading({
          passageId: null,
          options: {
            values: ['a', 'b'],
            questionType: 'MCQ',
            section: 'READING',
          },
        }),
      ]),
    ).toEqual(
      expect.arrayContaining([
        'reading item without passage text 23',
        'reading item without passage reference 23',
      ]),
    );
  });

  it('separates content validity, runtime readiness and activation readiness', () => {
    const draft = evaluateAssessmentReadiness(
      { scoringVersion: 'FOUR_SKILL_PLACEMENT_V2', status: 'DRAFT' },
      [listening(null), reading(), speaking(), writing()],
    );
    expect(draft.content.valid).toBe(true);
    expect(draft.runtime.ready).toBe(false);
    expect(draft.activation.ready).toBe(false);
    expect(draft.activation.blockers.join(' ')).toMatch(/runtime/);
    // DEF-004 is decided (D1), so it is no longer an activation blocker.
    expect(draft.activation.blockers.join(' ')).not.toMatch(/DEF-004/);

    const legacy = evaluateAssessmentReadiness(
      { scoringVersion: 'OBJECTIVE_POOLED_V1', status: 'ACTIVE' },
      [mcq(1, 0), mcq(2, 1)],
    );
    expect(
      legacy.content.valid && legacy.runtime.ready && legacy.activation.ready,
    ).toBe(true);
  });

  it('blocks activation of productive tasks unless the grader runs on real providers', () => {
    const productiveBlocker = (mode?: 'real' | 'mock' | 'unavailable') =>
      evaluateAssessmentReadiness(
        { scoringVersion: 'OBJECTIVE_POOLED_V1', status: 'DRAFT' },
        [mcq(1, 0), speaking(), writing()],
        { productiveGraderMode: mode },
      ).activation.blockers.find((b) => b.startsWith('productive grader'));
    expect(productiveBlocker()).toMatch(/not stated/);
    expect(productiveBlocker('mock')).toMatch(/mock/);
    expect(productiveBlocker('unavailable')).toMatch(/unavailable/);
    expect(productiveBlocker('real')).toBeUndefined();
    // An objective-only form is unaffected by the grader mode.
    expect(
      evaluateAssessmentReadiness(
        { scoringVersion: 'OBJECTIVE_POOLED_V1', status: 'ACTIVE' },
        [mcq(1, 0), mcq(2, 1)],
      ).activation.ready,
    ).toBe(true);
  });
});

describe('DiagnosticService attempt authority and delivery', () => {
  const USER = 7;
  const ASSESSMENT = 1;
  const questions = [mcq(1, 0), mcq(2, 1), mcq(3, 2), mcq(4, 3)].map((q) => ({
    ...q,
    assessmentId: ASSESSMENT,
  }));
  const assessment = {
    id: ASSESSMENT,
    title: 'Entry',
    description: null,
    isActive: true,
    status: 'ACTIVE',
    scoringVersion: 'OBJECTIVE_POOLED_V1',
    blueprintVersion: 'V1_LEGACY_20_ITEM',
    contentVersion: 1,
    questions,
  };
  let prisma: any;
  let service: DiagnosticService;
  let updates: Array<Record<string, unknown>>;
  let attemptRow: Record<string, unknown> | null;

  beforeEach(() => {
    updates = [];
    attemptRow = {
      id: 40,
      userId: USER,
      assessmentId: ASSESSMENT,
      status: 'IN_PROGRESS',
      answers: {},
    };
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      diagnosticAttempt: {
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(1),
        findUnique: jest.fn(() => Promise.resolve(attemptRow)),
        update: jest.fn((args: { data: Record<string, unknown> }) => {
          updates.push(args.data);
          return Promise.resolve({
            ...attemptRow,
            submittedAt: new Date(),
            ...args.data,
          });
        }),
        create: jest.fn(() => {
          throw new Error('an attempt must never be created on submit');
        }),
      },
      learningActivity: { create: jest.fn() },
    };
    prisma = {
      diagnosticAssessment: {
        findFirst: jest.fn().mockResolvedValue(assessment),
      },
      diagnosticAttempt: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(() => Promise.resolve(attemptRow)),
        count: jest.fn().mockResolvedValue(0),
      },
      diagnosticSpeakingResponse: { findMany: jest.fn().mockResolvedValue([]) },
      course: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((cb: (t: any) => unknown) => cb(tx)),
    };
    service = new DiagnosticService(prisma, { awardBanh: jest.fn() } as any);
  });

  /** Displayed index of the option whose TEXT the learner means. */
  const clickFor = (served: any, questionId: number, text: string) =>
    served.questions
      .find((q: any) => q.id === questionId)
      .options.indexOf(text);

  it('serves the SAME option order before and after an attempt exists (root defect)', async () => {
    prisma.diagnosticAttempt.findFirst.mockResolvedValue(null);
    const before = await service.getCurrentAssessment(USER);
    prisma.diagnosticAttempt.findFirst.mockImplementation((args: any) =>
      Promise.resolve(
        args.where.status === 'IN_PROGRESS'
          ? { ...attemptRow, speakingResponses: [] }
          : null,
      ),
    );
    const after = await service.getCurrentAssessment(USER);
    expect(after.questions.map((q: any) => q.options)).toEqual(
      before.questions.map((q: any) => q.options),
    );
    // And the order really is permuted for at least one item.
    expect(
      before.questions.some(
        (q: any, i: number) => q.options.join() !== questions[i].options.join(),
      ),
    ).toBe(true);
  });

  it('grades the option the learner clicked, end to end, and persists that grade', async () => {
    const served = await service.getCurrentAssessment(USER);
    // Correct on 1 and 3, wrong on 2 and 4 - chosen by TEXT, clicked by index.
    const answers = {
      '1': clickFor(served, 1, 'A'),
      '2': clickFor(served, 2, 'A'),
      '3': clickFor(served, 3, 'C'),
      '4': clickFor(served, 4, 'A'),
    };
    const result: any = await service.submitAssessment(
      USER,
      ASSESSMENT,
      answers,
      undefined,
      40,
    );
    expect(updates).toHaveLength(1);
    expect(updates[0].correctCount).toBe(2);
    expect(updates[0].percentage).toBe(50);
    expect((updates[0].answers as any).__permScheme).toBe(
      LEARNER_PERMUTATION_SCHEME,
    );
    // The result screen re-derives the same grade from the persisted scheme.
    expect(result.correctCount).toBe(2);
    const byId = Object.fromEntries(
      result.questionsResult.map((r: any) => [r.questionId, r]),
    );
    expect([
      byId[1].isCorrect,
      byId[2].isCorrect,
      byId[3].isCorrect,
      byId[4].isCorrect,
    ]).toEqual([true, false, true, false]);
    expect(byId[2].selectedText).toBe('A');
    expect(byId[3].selectedText).toBe('C');
  });

  it('rejects a submission with no attempt, before any write', async () => {
    await expect(
      service.submitAssessment(USER, ASSESSMENT, {
        '1': 0,
        '2': 0,
        '3': 0,
        '4': 0,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid id', { id: 40 }, 0],
    ['another learner', { userId: 99 }, 40],
    ['another assessment', { assessmentId: 5 }, 40],
    ['unknown status', { status: 'ABANDONED' }, 40],
  ])(
    'rejects an attempt that is not authoritative (%s)',
    async (_label, over, attemptId) => {
      attemptRow = attemptId ? { ...attemptRow, ...over } : attemptRow;
      await expect(
        service.submitAssessment(
          USER,
          ASSESSMENT,
          { '1': 0, '2': 0, '3': 0, '4': 0 },
          undefined,
          attemptId || undefined,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(updates).toHaveLength(0);
    },
  );

  it('rejects a missing attempt row', async () => {
    attemptRow = null;
    await expect(
      service.submitAssessment(
        USER,
        ASSESSMENT,
        { '1': 0, '2': 0, '3': 0, '4': 0 },
        undefined,
        40,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an out-of-range option index before any write', async () => {
    await expect(
      service.submitAssessment(
        USER,
        ASSESSMENT,
        { '1': 4, '2': 0, '3': 0, '4': 0 },
        undefined,
        40,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.submitAssessment(
        USER,
        ASSESSMENT,
        { '1': { originalIndex: 0 }, '2': 0, '3': 0, '4': 0 },
        undefined,
        40,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('a replayed submission on a completed attempt returns the recorded result and grades nothing', async () => {
    attemptRow = {
      ...attemptRow,
      status: 'COMPLETED',
      answers: { '1': 0, __permScheme: LEARNER_PERMUTATION_SCHEME },
      correctCount: 1,
      totalCount: 4,
      percentage: 25,
      level: 'Starter',
      submittedAt: new Date(),
    };
    const served = await service.getCurrentAssessment(USER);
    const allCorrect = {
      '1': clickFor(served, 1, 'A'),
      '2': clickFor(served, 2, 'B'),
      '3': clickFor(served, 3, 'C'),
      '4': clickFor(served, 4, 'D'),
    };
    const result: any = await service.submitAssessment(
      USER,
      ASSESSMENT,
      allCorrect,
      undefined,
      40,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
    expect(result.attemptId).toBe(40);
  });

  it('a duplicate submission that races into a completed attempt is not graded twice', async () => {
    // Outside the lock the attempt is IN_PROGRESS; inside it, another request
    // has just completed it.
    let reads = 0;
    prisma.diagnosticAttempt.findUnique = jest.fn(() =>
      Promise.resolve(attemptRow),
    );
    prisma.$transaction = jest.fn((cb: (t: any) => unknown) =>
      cb({
        $executeRaw: jest.fn().mockResolvedValue(0),
        diagnosticAttempt: {
          findFirst: jest.fn().mockResolvedValue(null),
          count: jest.fn().mockResolvedValue(1),
          findUnique: jest.fn(() => {
            reads += 1;
            return Promise.resolve({
              ...attemptRow,
              status: 'COMPLETED',
              answers: { __permScheme: LEARNER_PERMUTATION_SCHEME },
              correctCount: 0,
              totalCount: 4,
              percentage: 0,
              level: 'Starter',
              submittedAt: new Date(),
            });
          }),
          update: jest.fn(() => {
            throw new Error('must not update a completed attempt');
          }),
        },
        learningActivity: {
          create: jest.fn(() => {
            throw new Error('must not log a second completion');
          }),
        },
      }),
    );
    const served = await service.getCurrentAssessment(USER);
    const answers = {
      '1': clickFor(served, 1, 'A'),
      '2': clickFor(served, 2, 'A'),
      '3': clickFor(served, 3, 'A'),
      '4': clickFor(served, 4, 'A'),
    };
    const result: any = await service.submitAssessment(
      USER,
      ASSESSMENT,
      answers,
      undefined,
      40,
    );
    expect(reads).toBe(1);
    expect(result.attemptId).toBe(40);
  });

  it('an attempt graded under the legacy attempt-seeded scheme is re-derived with that scheme', async () => {
    const legacyPerm = getAttemptQuestionPermutation(40, 1, 4);
    attemptRow = {
      ...attemptRow,
      status: 'COMPLETED',
      answers: { '1': legacyPerm.indexOf(0), __permAttemptId: 40 },
      correctCount: 1,
      totalCount: 4,
      percentage: 25,
      level: 'Starter',
      submittedAt: new Date(),
    };
    prisma.diagnosticAttempt.findFirst.mockImplementation((args: any) =>
      Promise.resolve(args.where.status === 'COMPLETED' ? attemptRow : null),
    );
    const result: any = await service.getLatestResult(USER);
    expect(
      result.questionsResult.find((r: any) => r.questionId === 1).isCorrect,
    ).toBe(true);
  });

  it('an attempt with no recorded scheme does not guess: index answers are unresolvable', async () => {
    attemptRow = {
      ...attemptRow,
      status: 'COMPLETED',
      answers: { '1': 0 },
      correctCount: 1,
      totalCount: 4,
      percentage: 25,
      level: 'Starter',
      submittedAt: new Date(),
    };
    prisma.diagnosticAttempt.findFirst.mockImplementation((args: any) =>
      Promise.resolve(args.where.status === 'COMPLETED' ? attemptRow : null),
    );
    const result: any = await service.getLatestResult(USER);
    const item = result.questionsResult.find((r: any) => r.questionId === 1);
    expect(item.isCorrect).toBe(false);
    expect(item.selectedText).toBeUndefined();
  });
});

describe('learner delivery contract (real sanitizer)', () => {
  const serve = (question: any, permutation?: number[]) =>
    (DiagnosticService.prototype as any).sanitizeQuestion.call(
      DiagnosticService.prototype,
      question,
      permutation,
    );
  const forbidden = [
    'correctIndex',
    'explanation',
    'answerRationale',
    'distractorRationales',
    'internalLabel',
    'sourceKey',
    'stableKey',
    'difficulty',
    'intendedLevel',
    'rubricId',
    'passageId',
    'script',
    'transcript',
  ];

  it('Listening: carries audioUrl and states NOT_READY when there is no audio', () => {
    const out = serve({
      id: 1,
      skill: 'Listening',
      question: 'Q',
      options: {
        values: ['a', 'b'],
        section: 'LISTENING',
        audioGroup: 'C1',
        audioUrl: null,
      },
      correctIndex: 0,
      order: 1,
      taskType: 'MCQ',
    });
    expect(out.audioUrl).toBeNull();
    expect(out.mediaStatus).toBe('NOT_READY');
    const ready = serve({
      id: 2,
      skill: 'Listening',
      question: 'Q',
      options: {
        values: ['a', 'b'],
        section: 'LISTENING',
        audioUrl: 'https://cdn/a.mp3',
      },
      correctIndex: 0,
      order: 2,
    });
    expect(ready.mediaStatus).toBe('READY');
  });

  it('Speaking: carries prompt, instructions and recording limits, no options', () => {
    const out = serve({
      id: 3,
      skill: 'Speaking',
      question: 'Describe a place.',
      instructions: 'You have 15 seconds to prepare.',
      options: { values: [], questionType: 'OPEN_TEXT', section: 'SPEAKING' },
      correctIndex: -1,
      order: 3,
      taskType: 'SPEAKING_RESPONSE',
      rubricId: 1,
      prepSeconds: 15,
      responseSeconds: 45,
    });
    expect(out).toMatchObject({
      taskType: 'SPEAKING_RESPONSE',
      questionType: 'OPEN_TEXT',
      productive: true,
      instructions: 'You have 15 seconds to prepare.',
      prepSeconds: 15,
      responseSeconds: 45,
      wordMin: null,
      wordMax: null,
      options: [],
    });
    for (const key of forbidden) expect(out).not.toHaveProperty(key);
  });

  it('Writing: carries prompt and word bounds, no recording limits', () => {
    const out = serve({
      id: 4,
      skill: 'Writing',
      question: 'Write an email.',
      options: { values: [], questionType: 'OPEN_TEXT', section: 'WRITING' },
      correctIndex: -1,
      order: 4,
      taskType: 'WRITING_RESPONSE',
      rubricId: 2,
      wordMin: 60,
      wordMax: 90,
    });
    expect(out).toMatchObject({
      taskType: 'WRITING_RESPONSE',
      productive: true,
      wordMin: 60,
      wordMax: 90,
      prepSeconds: null,
      responseSeconds: null,
    });
    for (const key of forbidden) expect(out).not.toHaveProperty(key);
  });

  it('Reading: delivers the complete passage; the generic label line is not a title', () => {
    const body = 'First paragraph.\n\nSecond paragraph.';
    const out = serve({
      id: 5,
      skill: 'Reading',
      question: 'Q',
      options: {
        values: ['a', 'b'],
        section: 'READING',
        passageText: `Đoạn đọc\n${body}`,
      },
      correctIndex: 0,
      order: 5,
      taskType: 'MCQ',
    });
    // "Đoạn đọc" is the page's own label, not an authored title.
    expect(out.passageTitle).toBeNull();
    expect(out.passageBody).toBe(body);
  });

  it('objective options are served in the permutation order and hide the key', () => {
    const out = serve(
      {
        id: 6,
        skill: 'Reading',
        question: 'Q',
        options: ['a', 'b', 'c', 'd'],
        correctIndex: 2,
        order: 6,
      },
      [2, 0, 3, 1],
    );
    expect(out.options).toEqual(['c', 'a', 'd', 'b']);
    for (const key of forbidden) expect(out).not.toHaveProperty(key);
  });
});

describe('DRAFT isolation through the real service (mocked persistence)', () => {
  it('start and submit on a non-active assessment are refused before any write', async () => {
    const prisma: any = {
      diagnosticAssessment: { findFirst: jest.fn().mockResolvedValue(null) },
      diagnosticAttempt: { findUnique: jest.fn(), findFirst: jest.fn() },
      $transaction: jest.fn(),
    };
    const service = new DiagnosticService(prisma, {} as any);
    await expect(service.startAttempt(7, 5)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.submitAssessment(7, 5, {}, undefined, 40),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.diagnosticAssessment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 5, isActive: true }),
      }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
