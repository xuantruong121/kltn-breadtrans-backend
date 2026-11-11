import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';

import {
  buildPracticeWritingRequest,
  practiceWritingTask,
} from './practice-writing-grading';
import {
  compareRevision,
  correctionsStatus,
  numberChain,
  revisionGate,
  revisionGraderInput,
  revisionView,
  storedAttempt,
} from './writing-revision.logic';
import { WritingService } from './writing.service';

const grade = (score: number, corrections: unknown[] = []) =>
  JSON.stringify({
    rubricVersion: 'PRACTICE_WRITING_V1',
    score,
    maxScore: 10,
    criteria: [
      { key: 'grammar', label: 'Ngữ pháp', score: score - 4, max: 6 },
      { key: 'taskCompletion', label: 'Hoàn thành', score: 4, max: 4 },
    ],
    corrections,
    suggestions: ['Kiểm tra lại cách chia động từ.'],
    feedback: 'Nhận xét.',
  });

const slip = {
  original: 'She ask',
  corrected: 'She asks',
  explanation: 'Chủ ngữ số ít.',
};

function attempt(
  id: number,
  answer: string,
  score: number,
  at: string,
  corrections: unknown[] = [],
) {
  return storedAttempt({
    id,
    answer,
    aiFeedback: grade(score, corrections),
    submittedAt: new Date(at),
  })!;
}

describe('writing-revision.logic', () => {
  const first = attempt(1, 'She ask for a refund.', 8, '2026-11-11T01:00:00Z', [
    slip,
  ]);
  const second = attempt(
    2,
    'She asks for a refund.',
    9,
    '2026-11-11T02:00:00Z',
  );
  const third = attempt(
    3,
    'She asks for a full refund.',
    10,
    '2026-11-11T03:00:00Z',
  );

  it('reads a stored practice grade and refuses anything else', () => {
    expect(first.corrections).toEqual([slip]);
    expect(first.criteria[0]).toEqual({
      key: 'grammar',
      label: 'Ngữ pháp',
      score: 4,
      max: 6,
    });
    const row = { id: 9, submittedAt: new Date(), answer: 'text' };
    expect(storedAttempt({ ...row, aiFeedback: null })).toBeNull();
    expect(storedAttempt({ ...row, aiFeedback: 'not json' })).toBeNull();
    // An exam Writing grade: one paragraph, no rubric version.
    expect(
      storedAttempt({
        ...row,
        aiFeedback: JSON.stringify({ score: 3, maxScore: 4, feedback: 'x' }),
      }),
    ).toBeNull();
    expect(
      storedAttempt({ ...row, answer: null, aiFeedback: grade(8) }),
    ).toBeNull();
  });

  it('numbers a chain in the order it was written', () => {
    const chain = numberChain([third, first, second]);
    expect(chain.map((a) => [a.submissionId, a.number])).toEqual([
      [1, 0],
      [2, 1],
      [3, 2],
    ]);
  });

  it('allows as many revisions as the plan gives and no more', () => {
    // Plus: 2.
    expect(revisionGate(numberChain([first]), 'She asks.', 2)).toEqual({
      ok: true,
    });
    expect(revisionGate(numberChain([first, second]), 'New text.', 2)).toEqual({
      ok: true,
    });
    expect(
      revisionGate(numberChain([first, second, third]), 'New text.', 2),
    ).toEqual({ ok: false, reason: 'LIMIT' });
    // Pro: 5, so a third revision is still allowed.
    expect(
      revisionGate(numberChain([first, second, third]), 'New text.', 5),
    ).toEqual({ ok: true });
    // Free: none, not even the first.
    expect(revisionGate(numberChain([first]), 'She asks.', 0)).toEqual({
      ok: false,
      reason: 'LIMIT',
    });
  });

  it('refuses a text that is the same apart from case and spacing', () => {
    expect(
      revisionGate(numberChain([first]), '  she ASK for   a refund. ', 2),
    ).toEqual({ ok: false, reason: 'UNCHANGED' });
  });

  it('decides what was fixed from the texts', () => {
    expect(correctionsStatus([slip], 'She asks for a refund.')).toEqual({
      fixed: [slip],
      remaining: [],
    });
    expect(correctionsStatus([slip], 'Today she  ASK again.')).toEqual({
      fixed: [],
      remaining: [slip],
    });
  });

  it('compares a revision with the text before it, criterion by criterion', () => {
    const [a, b] = numberChain([first, second]);
    const cmp = compareRevision(a, b);
    expect(cmp).toMatchObject({
      previousSubmissionId: 1,
      previousAnswer: 'She ask for a refund.',
      scoreBefore: 8,
      scoreAfter: 9,
      maxScore: 10,
      fixed: [slip],
      remaining: [],
    });
    expect(cmp.criteria[0]).toEqual({
      key: 'grammar',
      label: 'Ngữ pháp',
      before: 4,
      after: 5,
      max: 6,
    });
  });

  it('lets only the latest text of a chain be revised', () => {
    const chain = numberChain([first, second]);
    expect(revisionView(chain, 1, 2)).toMatchObject({
      number: 0,
      used: 1,
      remaining: 1,
      isLatest: false,
      canRevise: false,
      comparison: null,
    });
    const latest = revisionView(chain, 2, 2)!;
    expect(latest).toMatchObject({
      rootSubmissionId: 1,
      number: 1,
      isLatest: true,
      canRevise: true,
    });
    expect(latest.comparison?.scoreBefore).toBe(8);
    const full = revisionView(numberChain([first, second, third]), 3, 2)!;
    expect(full).toMatchObject({ remaining: 0, canRevise: false });
    expect(full.comparison?.previousSubmissionId).toBe(2);
    expect(revisionView(chain, 77, 2)).toBeNull();
    // The same chain on Pro has three revisions left; on Free none at all.
    expect(
      revisionView(numberChain([first, second, third]), 3, 5),
    ).toMatchObject({ limit: 5, remaining: 3, canRevise: true });
    expect(revisionView(numberChain([first]), 1, 0)).toMatchObject({
      limit: 0,
      remaining: 0,
      canRevise: false,
    });
  });

  it('gives the grader the earlier text and feedback, and tells it to grade the new text on its own', () => {
    const task = practiceWritingTask(
      {
        prompt: 'Ask for a refund.',
        rubric: { grammar: 6, taskCompletion: 4 },
      },
      'Refund',
    )!;
    const [a] = numberChain([first]);
    const request = buildPracticeWritingRequest(
      task,
      'She asks for a refund.',
      revisionGraderInput(a),
    );
    const sent = JSON.parse(request.prompt);
    expect(sent.previousAttempt).toEqual({
      previousResponse: 'She ask for a refund.',
      corrections: [{ original: 'She ask', corrected: 'She asks' }],
      suggestions: ['Kiểm tra lại cách chia động từ.'],
    });
    expect(sent.learnerResponse).toBe('She asks for a refund.');
    expect(request.systemInstruction).toContain('REVISION');
    expect(request.systemInstruction).toContain(
      'never raise a score because it is a revision',
    );
    // A first submission says nothing about revisions.
    const plain = buildPracticeWritingRequest(task, 'She asks.');
    expect(JSON.parse(plain.prompt).previousAttempt).toBeUndefined();
    expect(plain.systemInstruction).not.toContain('REVISION');
  });
});

describe('WritingService.reviseWriting', () => {
  const content = {
    prompt: 'Ask for a refund.',
    rubric: { grammar: 6, taskCompletion: 4 },
  };
  const source = (revisionOfId: number | null = null) => ({
    id: revisionOfId ? 2 : 1,
    quizId: 50,
    revisionOfId,
    results: [{ questionId: 500 }],
    quiz: {
      id: 50,
      title: 'Refund',
      type: 'WRITING_EMAIL',
      isPremiumContent: false,
      publicationStatus: 'PUBLISHED',
      practiceTopic: { category: 'WRITING_PART2' },
      questions: [{ id: 500, content }],
    },
  });
  const chainRow = (id: number, answer: string, at: string) => ({
    id,
    submittedAt: new Date(at),
    aiFeedback: grade(8, [slip]),
    results: [{ answer }],
  });
  const graded = {
    text: JSON.stringify({
      criteria: [
        { key: 'grammar', score: 6, comment: 'Ngữ pháp đã đúng.' },
        { key: 'taskCompletion', score: 4, comment: 'Đủ yêu cầu của đề.' },
      ],
      strengths: ['Đúng chủ đề.'],
      corrections: [],
      feedback: 'Bạn đã sửa lỗi chia động từ.',
      suggestions: [],
      taskRelevance: 'ON_TASK',
      relevanceEvidence: 'Bài viết yêu cầu hoàn tiền đúng như đề.',
    }),
  };

  function setup(plan: 'FREE' | 'PLUS' | 'PRO' = 'PLUS') {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      submission: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: 3 }),
      },
      learningActivity: { create: jest.fn() },
    };
    const prisma = {
      submission: {
        findFirst: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn(),
      },
      userQuizReward: { createMany: jest.fn() },
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    const ai = { generateStructuredJson: jest.fn().mockResolvedValue(graded) };
    const events = { emit: jest.fn() };
    const subscriptions = { planCodeFor: jest.fn().mockResolvedValue(plan) };
    const service = new WritingService(
      prisma as any,
      ai as any,
      undefined,
      events as any,
      undefined,
      subscriptions as any,
    );
    return { service, prisma, tx, ai, events, subscriptions };
  }

  it('answers "not found" for a submission that is not the learner own', async () => {
    const { service, prisma, ai } = setup();
    prisma.submission.findFirst.mockResolvedValue(null);
    await expect(service.reviseWriting(1, 10, 'New text.')).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.submission.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1, userId: 10 } }),
    );
    expect(ai.generateStructuredJson).not.toHaveBeenCalled();
  });

  it('refuses a third revision without calling the grader', async () => {
    const { service, prisma, ai } = setup();
    prisma.submission.findFirst.mockResolvedValue(source());
    prisma.submission.findMany.mockResolvedValue([
      chainRow(1, 'She ask.', '2026-11-11T01:00:00Z'),
      chainRow(2, 'She asks.', '2026-11-11T02:00:00Z'),
      chainRow(3, 'She asks now.', '2026-11-11T03:00:00Z'),
    ]);
    await expect(service.reviseWriting(1, 10, 'New text.')).rejects.toThrow(
      ConflictException,
    );
    expect(ai.generateStructuredJson).not.toHaveBeenCalled();
  });

  it('refuses an unchanged text without calling the grader', async () => {
    const { service, prisma, ai } = setup();
    prisma.submission.findFirst.mockResolvedValue(source());
    prisma.submission.findMany.mockResolvedValue([
      chainRow(1, 'She ask for a refund.', '2026-11-11T01:00:00Z'),
    ]);
    await expect(
      service.reviseWriting(1, 10, 'she ask for a refund.'),
    ).rejects.toThrow(BadRequestException);
    expect(ai.generateStructuredJson).not.toHaveBeenCalled();
  });

  it('refuses a submission without a practice grade', async () => {
    const { service, prisma } = setup();
    prisma.submission.findFirst.mockResolvedValue(source());
    prisma.submission.findMany.mockResolvedValue([
      {
        ...chainRow(1, 'She ask.', '2026-11-11T01:00:00Z'),
        aiFeedback: JSON.stringify({ score: 3, maxScore: 4, feedback: 'x' }),
      },
    ]);
    await expect(service.reviseWriting(1, 10, 'New text.')).rejects.toThrow(
      'Bài viết này không hỗ trợ sửa và nộp lại.',
    );
  });

  it('stores a revision on the first submission of the chain, with no reward and no quiz event', async () => {
    const { service, prisma, tx, ai, events } = setup();
    // The learner revises from revision 1 (id 2); the chain starts at id 1.
    prisma.submission.findFirst.mockResolvedValue(source(1));
    prisma.submission.findMany
      .mockResolvedValueOnce([
        chainRow(1, 'She ask for a refund.', '2026-11-11T01:00:00Z'),
        chainRow(2, 'She ask for a refund now.', '2026-11-11T02:00:00Z'),
      ])
      .mockResolvedValueOnce([
        chainRow(1, 'She ask for a refund.', '2026-11-11T01:00:00Z'),
        chainRow(2, 'She ask for a refund now.', '2026-11-11T02:00:00Z'),
        {
          id: 3,
          submittedAt: new Date('2026-11-11T03:00:00Z'),
          aiFeedback: grade(10),
          results: [{ answer: 'She asks for a refund now.' }],
        },
      ]);
    tx.submission.count.mockResolvedValue(1);

    const out = await service.reviseWriting(
      2,
      10,
      'She asks for a refund now.',
    );

    expect(prisma.submission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ id: 1 }, { revisionOfId: 1 }],
          score: { not: null },
        },
      }),
    );
    // The grader got the latest earlier text, not the first one.
    const sent = JSON.parse(ai.generateStructuredJson.mock.calls[0][0].prompt);
    expect(sent.previousAttempt.previousResponse).toBe(
      'She ask for a refund now.',
    );
    expect(tx.submission.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          revisionOfId: 1,
          userId: 10,
          quizId: 50,
          score: 10,
        }),
      }),
    );
    expect(events.emit).not.toHaveBeenCalled();
    expect(prisma.userQuizReward.createMany).not.toHaveBeenCalled();
    expect(out).toMatchObject({
      submissionId: 3,
      score: 10,
      maxScore: 10,
      revision: {
        rootSubmissionId: 1,
        number: 2,
        remaining: 0,
        canRevise: false,
        comparison: { scoreBefore: 8, scoreAfter: 10, fixed: [slip] },
      },
    });
  });

  it('refuses when another request took the last revision first', async () => {
    const { service, prisma, tx } = setup();
    prisma.submission.findFirst.mockResolvedValue(source());
    prisma.submission.findMany.mockResolvedValue([
      chainRow(1, 'She ask for a refund.', '2026-11-11T01:00:00Z'),
    ]);
    tx.submission.count.mockResolvedValue(2);
    await expect(
      service.reviseWriting(1, 10, 'She asks for a refund.'),
    ).rejects.toThrow(ConflictException);
    expect(tx.submission.create).not.toHaveBeenCalled();
  });

  it('refuses any revision on Free, without calling the grader (403)', async () => {
    const { service, prisma, ai } = setup('FREE');
    prisma.submission.findFirst.mockResolvedValue(source());
    prisma.submission.findMany.mockResolvedValue([
      chainRow(1, 'She ask for a refund.', '2026-11-11T01:00:00Z'),
    ]);
    const attempt = service.reviseWriting(1, 10, 'She asks for a refund.');
    await expect(attempt).rejects.toThrow(ForbiddenException);
    await expect(attempt).rejects.toThrow(
      'Sửa và nộp lại là quyền lợi của gói Plus và Pro.',
    );
    expect(ai.generateStructuredJson).not.toHaveBeenCalled();
  });

  it('allows a third revision on Pro', async () => {
    const { service, prisma, tx } = setup('PRO');
    prisma.submission.findFirst.mockResolvedValue(source());
    const rows = [
      chainRow(1, 'She ask.', '2026-11-11T01:00:00Z'),
      chainRow(2, 'She asks.', '2026-11-11T02:00:00Z'),
      chainRow(3, 'She asks now.', '2026-11-11T03:00:00Z'),
    ];
    prisma.submission.findMany.mockResolvedValue(rows);
    tx.submission.count.mockResolvedValue(2);
    tx.submission.create.mockResolvedValue({ id: 4 });
    const out = await service.reviseWriting(1, 10, 'She asks for a refund.');
    expect(tx.submission.create).toHaveBeenCalled();
    expect(out.submissionId).toBe(4);
  });

  it('treats a learner whose plan cannot be read as Free', async () => {
    const { service, prisma, subscriptions } = setup();
    subscriptions.planCodeFor.mockResolvedValue('FREE');
    prisma.submission.findFirst.mockResolvedValue(source());
    prisma.submission.findMany.mockResolvedValue([
      chainRow(1, 'She ask for a refund.', '2026-11-11T01:00:00Z'),
    ]);
    await expect(
      service.reviseWriting(1, 10, 'She asks for a refund.'),
    ).rejects.toThrow(ForbiddenException);
  });
});
