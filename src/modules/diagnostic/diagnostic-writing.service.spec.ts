/**
 * DiagnosticWritingService - the first dedicated tests for this service.
 *
 * Persistence is an in-memory DiagnosticWritingResponse table that applies the
 * same conditional where-clauses the service relies on (id + status + run),
 * so stale, duplicate and concurrent assertions exercise behaviour. The
 * grader is a fake; the queue records what was added.
 */
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type {
  DiagnosticRubricGrader,
  RubricGradeRequest,
} from './diagnostic-productive';
import { DiagnosticWritingService } from './diagnostic-writing.service';

const RUBRIC = {
  id: 2,
  skill: 'WRITING',
  rubricVersion: 'WRT_RUBRIC_V3',
  criteria: ['task_achievement', 'organisation', 'vocabulary', 'grammar'].map(
    (criterionKey) => ({
      criterionKey,
      scoreMin: 0,
      scoreMax: 4,
      description: criterionKey,
      anchors: [],
    }),
  ),
};
const writingTask = (id: number, wordMin: number, wordMax: number) => ({
  id,
  assessmentId: 2,
  skill: 'Writing',
  question: `Writing task ${id}`,
  instructions: `Write ${wordMin}-${wordMax} words.`,
  options: {
    values: [],
    section: 'WRITING',
    questionType: 'OPEN_TEXT',
    stableKey: `WRT_${id}`,
  },
  correctIndex: -1,
  order: id,
  taskType: 'WRITING_RESPONSE',
  rubricId: 2,
  wordMin,
  wordMax,
});
const QUESTIONS: any[] = [
  writingTask(20, 60, 90),
  writingTask(21, 90, 130),
  {
    id: 22,
    assessmentId: 2,
    skill: 'Speaking',
    question: 'Speak',
    options: { values: [], section: 'SPEAKING', questionType: 'OPEN_TEXT' },
    correctIndex: -1,
    order: 22,
    taskType: 'SPEAKING_RESPONSE',
    rubricId: 1,
  },
];
const words = (n: number) =>
  Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

function matches(row: any, where: any) {
  return Object.entries(where).every(([k, v]: [string, any]) =>
    v && typeof v === 'object' && Array.isArray(v.in)
      ? v.in.includes(row[k])
      : row[k] === v,
  );
}

function setup(opts: { owner?: number } = {}) {
  const rows: any[] = [];
  let nextId = 1;
  const table = {
    findUnique: jest.fn(({ where }: any) => {
      if (where.id !== undefined)
        return Promise.resolve(rows.find((r) => r.id === where.id) ?? null);
      const k = where.attemptId_questionId;
      return Promise.resolve(
        rows.find(
          (r) => r.attemptId === k.attemptId && r.questionId === k.questionId,
        ) ?? null,
      );
    }),
    findMany: jest.fn(({ where }: any) =>
      Promise.resolve(
        rows
          .filter((r) => matches(r, where))
          .sort((a, b) => a.questionId - b.questionId),
      ),
    ),
    create: jest.fn(({ data }: any) => {
      if (
        rows.some(
          (r) =>
            r.attemptId === data.attemptId && r.questionId === data.questionId,
        )
      )
        return Promise.reject(
          new Prisma.PrismaClientKnownRequestError('unique', {
            code: 'P2002',
            clientVersion: 'test',
          }),
        );
      const row = {
        id: nextId++,
        score: null,
        scoreMetadata: null,
        provider: null,
        failureReason: null,
        gradedAt: null,
        ...data,
      };
      rows.push(row);
      return Promise.resolve({ ...row });
    }),
    updateMany: jest.fn(({ where, data }: any) => {
      const hit = rows.filter((r) => matches(r, where));
      for (const r of hit) Object.assign(r, data);
      return Promise.resolve({ count: hit.length });
    }),
  };
  const prisma: any = {
    diagnosticWritingResponse: table,
    diagnosticAttempt: {
      findUnique: jest.fn(() =>
        Promise.resolve({ id: 4, userId: opts.owner ?? 7, assessmentId: 2 }),
      ),
    },
    diagnosticQuestion: {
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(QUESTIONS.find((q) => q.id === where.id) ?? null),
      ),
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(QUESTIONS.find((q) => q.id === where.id) ?? null),
      ),
    },
    diagnosticRubric: { findUnique: jest.fn(() => Promise.resolve(RUBRIC)) },
  };
  const calls: RubricGradeRequest[] = [];
  let behaviour: Array<(r: RubricGradeRequest) => Promise<unknown>> = [];
  const grader: DiagnosticRubricGrader = {
    provider: 'fake',
    providerVersion: 'fake-1',
    mode: 'mock',
    grade: (request) => {
      calls.push(request);
      const next = behaviour.shift();
      return next
        ? next(request)
        : Promise.resolve({
            submissionRef: request.submissionRef,
            rubricVersion: request.rubric.version,
            criteria: {
              task_achievement: 3,
              organisation: 3,
              vocabulary: 2,
              grammar: 2,
            },
            criterionFeedback: {
              task_achievement: 'All parts covered.',
              organisation: 'Logical order.',
              vocabulary: 'Adequate range.',
              grammar: 'Some slips.',
            },
            feedback: 'Email rõ ràng, đáp ứng đủ yêu cầu của đề.',
            suggestions: ['Add a closing line.'],
            evidenceQuotes: [
              (request.responseText ?? '').trim().split(/\s+/u)[0],
            ],
          });
    },
  };
  const service = new DiagnosticWritingService(prisma, {} as any, grader);
  const queued: any[] = [];
  const jobIds = new Set<string>();
  (service as any).queue = {
    add: jest.fn((_n: string, data: any, o: { jobId: string }) => {
      // BullMQ ignores an add whose jobId already exists.
      if (!jobIds.has(o.jobId)) {
        jobIds.add(o.jobId);
        queued.push(data);
      }
      return Promise.resolve({});
    }),
  };
  return {
    service,
    rows,
    calls,
    queued,
    setGrader: (b: typeof behaviour) => (behaviour = b),
  };
}

const attempt = (answers: Record<string, unknown>) => ({
  id: 4,
  userId: 7,
  assessmentId: 2,
  answers,
});

describe('Writing submission persistence', () => {
  it('stores each Writing answer against its own task with the server word count and rubric', async () => {
    const s = setup();
    await s.service.enqueueForAttempt(
      attempt({ '20': ` ${words(70)} `, '21': words(100), '22': 'SKIPPED' }),
      QUESTIONS,
    );
    expect(
      s.rows.map((r) => [r.questionId, r.status, r.wordCount, r.rubricVersion]),
    ).toEqual([
      [20, 'QUEUED', 70, 'WRT_RUBRIC_V3'],
      [21, 'QUEUED', 100, 'WRT_RUBRIC_V3'],
    ]);
    // Trimmed, never truncated.
    expect(s.rows[0].responseText).toBe(words(70));
    expect(s.queued).toEqual([
      { responseId: 1, run: 1 },
      { responseId: 2, run: 1 },
    ]);
  });

  it('does not reject a response outside the guidance range: the rubric grades length', async () => {
    const s = setup();
    await s.service.enqueueForAttempt(
      attempt({ '20': words(30), '21': words(200) }),
      QUESTIONS,
    );
    expect(s.rows.map((r) => r.wordCount)).toEqual([30, 200]);
    await s.service.process({ data: s.queued[0] });
    expect(s.calls[0].writingLength).toMatchObject({
      wordCount: 30,
      belowTwoThirdsMinimum: true,
    });
  });

  it('skips empty and whitespace-only answers', async () => {
    const s = setup();
    await s.service.enqueueForAttempt(
      attempt({ '20': '   \n  ', '21': '' }),
      QUESTIONS,
    );
    expect(s.rows).toHaveLength(0);
    expect(s.queued).toHaveLength(0);
  });

  it('a replayed completion queues nothing more', async () => {
    const s = setup();
    const a = attempt({ '20': words(70), '21': words(100) });
    await s.service.enqueueForAttempt(a, QUESTIONS);
    await s.service.enqueueForAttempt(a, QUESTIONS);
    expect(s.rows).toHaveLength(2);
    expect(s.queued).toHaveLength(2);
  });

  it('two concurrent completions create one row and one job per task', async () => {
    const s = setup();
    const a = attempt({ '20': words(70), '21': words(100) });
    await Promise.all([
      s.service.enqueueForAttempt(a, QUESTIONS),
      s.service.enqueueForAttempt(a, QUESTIONS),
    ]);
    expect(s.rows).toHaveLength(2);
    expect(s.queued).toHaveLength(2);
  });
});

describe('Writing grading worker', () => {
  async function queued() {
    const s = setup();
    await s.service.enqueueForAttempt(
      attempt({ '20': words(70), '21': words(100) }),
      QUESTIONS,
    );
    return s;
  }

  it('grades with the Writing rubric and persists validated criteria, feedback and a percentage', async () => {
    const s = await queued();
    await s.service.process({ data: s.queued[0] });
    const row = s.rows[0];
    expect(s.calls[0]).toMatchObject({
      skill: 'WRITING',
      submissionRef: 'writing:1:1',
      responseText: words(70),
    });
    expect(s.calls[0].rubric.version).toBe('WRT_RUBRIC_V3');
    expect(row.status).toBe('GRADED');
    expect(row.score).toBeCloseTo((10 / 16) * 100);
    expect(row.scoreMetadata).toMatchObject({
      validated: true,
      criteria: {
        task_achievement: 3,
        organisation: 3,
        vocabulary: 2,
        grammar: 2,
      },
      feedback: 'Email rõ ràng, đáp ứng đủ yêu cầu của đề.',
      criterionFeedback: { grammar: 'Some slips.' },
    });
    const [feedback] = await s.service.listFeedback(4);
    expect(feedback).toMatchObject({
      status: 'GRADED',
      scoreScale: 'PERCENT_0_100',
      wordCount: 70,
      feedback: 'Email rõ ràng, đáp ứng đủ yêu cầu của đề.',
      criterionFeedback: { grammar: 'Some slips.' },
    });
  });

  it('a duplicate delivery of the same job grades once', async () => {
    const s = await queued();
    await Promise.all([
      s.service.process({ data: s.queued[0] }),
      s.service.process({ data: s.queued[0] }),
    ]);
    expect(s.calls).toHaveLength(1);
  });

  it('malformed output twice leaves GRADING_FAILED with no score and no invented feedback', async () => {
    const s = await queued();
    s.setGrader([
      () => Promise.resolve('garbage'),
      (r) => Promise.resolve({ submissionRef: r.submissionRef, criteria: {} }),
    ]);
    await s.service.process({ data: s.queued[0] });
    expect(s.rows[0]).toMatchObject({ status: 'GRADING_FAILED', score: null });
    const [feedback] = await s.service.listFeedback(4);
    expect(feedback.feedback).toBeNull();
    expect(feedback.score).toBeNull();
  });

  it('empty provider feedback is rejected, not replaced with a stock sentence', async () => {
    const s = await queued();
    const blank = (r: RubricGradeRequest) =>
      Promise.resolve({
        submissionRef: r.submissionRef,
        rubricVersion: r.rubric.version,
        criteria: {
          task_achievement: 4,
          organisation: 4,
          vocabulary: 4,
          grammar: 4,
        },
        criterionFeedback: {
          task_achievement: 'All parts covered.',
          organisation: 'Logical order.',
          vocabulary: 'Adequate range.',
          grammar: 'Some slips.',
        },
        feedback: '',
      });
    s.setGrader([blank, blank]);
    await s.service.process({ data: s.queued[0] });
    expect(s.rows[0].status).toBe('GRADING_FAILED');
    expect(s.rows[0].failureReason).toBe(
      'INVALID_GRADER_OUTPUT:FEEDBACK_MISSING',
    );
  });

  it('a provider timeout is retried within the job', async () => {
    const s = await queued();
    s.setGrader([() => Promise.reject(new Error('timeout'))]);
    await s.service.process({ data: s.queued[0] });
    expect(s.rows[0].status).toBe('GRADED');
  });

  it('fails closed on a missing or wrong-skill rubric without calling the grader', async () => {
    const s = await queued();
    s.rows[0].rubricId = null;
    await s.service.process({ data: s.queued[0] });
    expect(s.rows[0].failureReason).toBe('RUBRIC_MISSING');
    expect(s.calls).toHaveLength(0);
  });
});

describe('Writing retry, stale runs and ownership', () => {
  async function failed() {
    const s = setup();
    await s.service.enqueueForAttempt(attempt({ '20': words(70) }), QUESTIONS);
    s.setGrader([
      () => Promise.reject(new Error('down')),
      () => Promise.reject(new Error('down')),
    ]);
    await s.service.process({ data: s.queued[0] });
    expect(s.rows[0].status).toBe('GRADING_FAILED');
    return s;
  }

  it('retry re-queues the same text as a new run and grades it', async () => {
    const s = await failed();
    await expect(s.service.retry(7, 2, 4, 20)).resolves.toEqual({
      questionId: 20,
      status: 'QUEUED',
    });
    expect(s.queued[1]).toEqual({ responseId: 1, run: 2 });
    await s.service.process({ data: s.queued[1] });
    expect(s.rows[0]).toMatchObject({
      status: 'GRADED',
      gradingAttempts: 2,
      responseText: words(70),
    });
  });

  it('a stale job from the failed run cannot claim or overwrite the retried run', async () => {
    const s = await failed();
    await s.service.retry(7, 2, 4, 20);
    const before = s.calls.length;
    await s.service.process({ data: s.queued[0] }); // run 1, stale
    expect(s.calls.length).toBe(before);
    expect(s.rows[0].status).toBe('QUEUED');
  });

  it('two concurrent retries queue exactly one run', async () => {
    const s = await failed();
    const results = await Promise.allSettled([
      s.service.retry(7, 2, 4, 20),
      s.service.retry(7, 2, 4, 20),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      (results.find((r) => r.status === 'rejected') as PromiseRejectedResult)
        .reason,
    ).toBeInstanceOf(ConflictException);
    expect(s.queued).toHaveLength(2);
  });

  it('refuses retry while a run is queued or graded', async () => {
    const s = setup();
    await s.service.enqueueForAttempt(attempt({ '20': words(70) }), QUESTIONS);
    await expect(s.service.retry(7, 2, 4, 20)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await s.service.process({ data: s.queued[0] });
    await expect(s.service.retry(7, 2, 4, 20)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("refuses another learner's retry, a wrong assessment, a non-Writing task and a missing response", async () => {
    const other = setup({ owner: 99 });
    await expect(other.service.retry(7, 2, 4, 20)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    const s = await failed();
    await expect(s.service.retry(7, 3, 4, 20)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(s.service.retry(7, 2, 4, 22)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(s.service.retry(7, 2, 4, 21)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('a crashed or stalled run is marked failed and becomes retryable; an older run cannot touch a newer one', async () => {
    const s = setup();
    await s.service.enqueueForAttempt(attempt({ '20': words(70) }), QUESTIONS);
    s.rows[0].status = 'GRADING';
    await (s.service as any).markRunFailed(
      { responseId: 1, run: 1 },
      'WORKER_FAILED: stalled',
    );
    expect(s.rows[0].status).toBe('GRADING_FAILED');
    await s.service.retry(7, 2, 4, 20);
    await (s.service as any).markRunFailed(
      { responseId: 1, run: 1 },
      'WORKER_FAILED: late',
    );
    expect(s.rows[0].status).toBe('QUEUED');
  });

  it('pending and failed are reported as such, never as a zero score', async () => {
    const s = setup();
    await s.service.enqueueForAttempt(
      attempt({ '20': words(70), '21': words(100) }),
      QUESTIONS,
    );
    s.setGrader([
      () => Promise.reject(new Error('x')),
      () => Promise.reject(new Error('x')),
    ]);
    await s.service.process({ data: s.queued[0] });
    const feedback = await s.service.listFeedback(4);
    expect(feedback.map((f) => [f.status, f.score])).toEqual([
      ['GRADING_FAILED', null],
      ['QUEUED', null],
    ]);
  });
});
