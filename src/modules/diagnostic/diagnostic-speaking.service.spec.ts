/**
 * DiagnosticSpeakingService - recording contract, lifecycle and rubric grading.
 *
 * Persistence is an in-memory store that applies the same conditional
 * `where` semantics the service relies on (id + audioKey + status), so the
 * stale-job and duplicate-retry assertions test behaviour, not call shapes.
 * The audio normalizer and the grader are fakes; real decoding is covered by
 * diagnostic-speaking-audio-normalizer.spec.ts and the isolated C2 run.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import {
  DiagnosticGraderUnavailableError,
  type DiagnosticRubricGrader,
  type RubricGradeRequest,
} from './diagnostic-productive';
import { DiagnosticSpeakingService } from './diagnostic-speaking.service';

const RUBRIC = {
  id: 1,
  skill: 'SPEAKING',
  rubricVersion: 'SPK_RUBRIC_V3',
  criteria: [
    'task_fulfilment',
    'intelligibility',
    'fluency',
    'language_use',
  ].map((criterionKey) => ({
    criterionKey,
    scoreMin: 0,
    scoreMax: 4,
    description: criterionKey,
    anchors: [],
  })),
};

const task = (id: number, responseSeconds: number | null) => ({
  id,
  assessmentId: 2,
  skill: 'Speaking',
  question: `Speaking task ${id}`,
  instructions: 'Speak.',
  options: {
    values: [],
    section: 'SPEAKING',
    questionType: 'OPEN_TEXT',
    stableKey: `SPK_${id}`,
  },
  correctIndex: -1,
  order: id,
  taskType: 'SPEAKING_RESPONSE',
  rubricId: 1,
  prepSeconds: 15,
  responseSeconds,
});
const TASKS: Record<number, any> = {
  10: task(10, 45),
  11: task(11, 60),
  12: task(12, null),
  13: {
    ...task(13, 45),
    taskType: 'WRITING_RESPONSE',
    options: { values: [], section: 'WRITING', questionType: 'OPEN_TEXT' },
  },
};

type Row = Record<string, any>;

function matches(row: Row, where: Row) {
  return Object.entries(where).every(([k, v]) =>
    v && typeof v === 'object' && Array.isArray(v.in)
      ? v.in.includes(row[k])
      : row[k] === v,
  );
}

function setup(
  opts: {
    attemptStatus?: string;
    statusInsideLock?: string;
    owner?: number;
  } = {},
) {
  const rows: Row[] = [];
  let nextId = 1;
  const attempt = {
    id: 4,
    userId: opts.owner ?? 7,
    assessmentId: 2,
    status: opts.attemptStatus ?? 'IN_PROGRESS',
  };
  const speakingResponse = {
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
      Promise.resolve(rows.filter((r) => matches(r, where))),
    ),
    upsert: jest.fn(({ where, create, update }: any) => {
      const k = where.attemptId_questionId;
      const found = rows.find(
        (r) => r.attemptId === k.attemptId && r.questionId === k.questionId,
      );
      if (found) {
        Object.assign(found, update);
        return Promise.resolve({ ...found });
      }
      const row = { id: nextId++, gradingAttempts: 0, ...create };
      rows.push(row);
      return Promise.resolve({ ...row });
    }),
    updateMany: jest.fn(({ where, data }: any) => {
      const hit = rows.filter((r) => matches(r, where));
      for (const r of hit)
        for (const [key, value] of Object.entries(data))
          r[key] =
            value && typeof value === 'object' && 'increment' in (value as any)
              ? (r[key] ?? 0) + (value as any).increment
              : value;
      return Promise.resolve({ count: hit.length });
    }),
  };
  let lockReads = 0;
  const prisma: any = {
    diagnosticAttempt: {
      findUnique: jest.fn(() => {
        // The first read is loadContext; any read inside the transaction can
        // be made to see a later status, to model a submission racing upload.
        lockReads += 1;
        const status =
          lockReads > 1 && opts.statusInsideLock
            ? opts.statusInsideLock
            : attempt.status;
        return Promise.resolve({ ...attempt, status, speakingResponses: rows });
      }),
    },
    diagnosticQuestion: {
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(TASKS[where.id] ?? null),
      ),
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(TASKS[where.id] ?? null),
      ),
    },
    diagnosticRubric: { findUnique: jest.fn(() => Promise.resolve(RUBRIC)) },
    diagnosticSpeakingResponse: speakingResponse,
    $executeRaw: jest.fn().mockResolvedValue(0),
    $transaction: jest.fn((cb: (tx: any) => unknown) => cb(prisma)),
  };
  const objects = new Map<string, Buffer>();
  const upload: any = {
    putPrivateObjectAtKey: jest.fn((key: string, buf: Buffer) => {
      objects.set(key, buf);
      return Promise.resolve();
    }),
    deleteFile: jest.fn((key: string) => {
      objects.delete(key);
      return Promise.resolve();
    }),
    downloadPrivateFileBuffer: jest.fn((key: string) =>
      objects.has(key)
        ? Promise.resolve(objects.get(key))
        : Promise.reject(new Error('no object')),
    ),
    getPrivatePresignedDownloadUrl: jest.fn((key: string) =>
      Promise.resolve(`https://signed/${key}`),
    ),
  };
  /** Decodes to whatever duration the buffer's first 4 bytes encode. */
  const normalizer: any = {
    normalize: jest.fn((buf: Buffer) => {
      if (buf.length < 4 || buf.readUInt32LE(0) === 0xffffffff)
        return Promise.reject(new Error('invalid media'));
      return Promise.resolve({
        buffer: Buffer.from('wav'),
        durationMs: buf.readUInt32LE(0),
      });
    }),
  };
  const calls: RubricGradeRequest[] = [];
  let behaviour: Array<() => Promise<unknown>> = [];
  const grader: DiagnosticRubricGrader = {
    provider: 'fake',
    providerVersion: 'fake-1',
    mode: 'mock',
    grade: (request) => {
      calls.push(request);
      const next = behaviour.shift();
      return next
        ? next()
        : Promise.resolve({
            submissionRef: request.submissionRef,
            rubricVersion: request.rubric.version,
            criteria: {
              task_fulfilment: 3,
              intelligibility: 2,
              fluency: 4,
              language_use: 3,
            },
            criterionFeedback: {
              task_fulfilment: 'Answers the prompt.',
              intelligibility: 'Mostly clear.',
              fluency: 'Flows well.',
              language_use: 'Simple and correct.',
            },
            feedback: 'Clear answer that stays on the topic.',
            evidenceQuotes: ['visit the park'],
            transcript: 'I visit the park.',
            speechEvidence: { mode: 'FAKE' },
          });
    },
  };
  const service = new DiagnosticSpeakingService(
    prisma,
    upload,
    {} as any,
    normalizer,
    grader,
  );
  const queued: any[] = [];
  (service as any).queue = {
    add: jest.fn(
      (_n: string, data: unknown) => (queued.push(data), Promise.resolve({})),
    ),
  };
  return {
    service,
    prisma,
    rows,
    objects,
    upload,
    normalizer,
    calls,
    queued,
    setGrader: (b: Array<() => Promise<unknown>>) => (behaviour = b),
  };
}

const recording = (durationMs: number, mimetype = 'audio/webm') => {
  const buffer = Buffer.alloc(64, 1);
  buffer.writeUInt32LE(durationMs >>> 0, 0);
  return { buffer, size: buffer.length, mimetype } as any;
};
const MALFORMED = (() => {
  const b = Buffer.alloc(64, 1);
  b.writeUInt32LE(0xffffffff, 0);
  return { buffer: b, size: b.length, mimetype: 'audio/webm' } as any;
})();

describe('Speaking duration - enforced per task from the decoded audio', () => {
  it('accepts a full 45-second recording on the 45-second task', async () => {
    const s = setup();
    const out = await s.service.confirmRecording(
      7,
      2,
      4,
      10,
      recording(45_000),
      45_100,
    );
    expect(out.status).toBe('QUEUED');
    expect(out.durationMs).toBe(45_000);
  });

  it('accepts a full 60-second recording on the 60-second task', async () => {
    const s = setup();
    const out = await s.service.confirmRecording(
      7,
      2,
      4,
      11,
      recording(60_000),
      60_000,
    );
    expect(out.status).toBe('QUEUED');
  });

  it('rejects 50 seconds on the 45-second task, although the generic 90-second limit allowed it', async () => {
    const s = setup();
    await expect(
      s.service.confirmRecording(7, 2, 4, 10, recording(50_000), 50_000),
    ).rejects.toThrow('Bản ghi dài hơn thời gian cho phép của nhiệm vụ');
  });

  it('allows the measured codec and stop allowance, and nothing beyond it', async () => {
    const s = setup();
    await expect(
      s.service.confirmRecording(7, 2, 4, 10, recording(45_550), 45_550),
    ).resolves.toBeDefined();
    await expect(
      s.service.confirmRecording(7, 2, 4, 10, recording(45_551), 45_551),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a recording below the supported minimum', async () => {
    const s = setup();
    await expect(
      s.service.confirmRecording(7, 2, 4, 10, recording(200), 200),
    ).rejects.toThrow('Bản ghi quá ngắn');
  });

  it('judges the decoded duration: a client that under-reports cannot extend the limit', async () => {
    const s = setup();
    // Claims 44 s; the audio really is 70 s.
    await expect(
      s.service.confirmRecording(7, 2, 4, 10, recording(70_000), 44_000),
    ).rejects.toThrow('Bản ghi dài hơn thời gian cho phép của nhiệm vụ');
  });

  it('rejects a client duration that contradicts the audio', async () => {
    const s = setup();
    await expect(
      s.service.confirmRecording(7, 2, 4, 10, recording(20_000), 40_000),
    ).rejects.toThrow('Thời lượng bản ghi không khớp với nội dung âm thanh');
  });

  it('persists the measured duration, never the client one', async () => {
    const s = setup();
    await s.service.confirmRecording(7, 2, 4, 10, recording(30_000), 31_000);
    expect(s.rows[0].durationMs).toBe(30_000);
  });

  it('refuses a speaking task with no configured response time', async () => {
    const s = setup();
    await expect(
      s.service.confirmRecording(7, 2, 4, 12, recording(10_000), 10_000),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects malformed media without storing anything', async () => {
    const s = setup();
    await expect(
      s.service.confirmRecording(7, 2, 4, 10, MALFORMED, 1000),
    ).rejects.toThrow('Không đọc được nội dung bản ghi âm');
    expect(s.objects.size).toBe(0);
    expect(s.rows).toHaveLength(0);
  });

  it('rejects an unsupported audio format before decoding or storing', async () => {
    const s = setup();
    await expect(
      s.service.confirmRecording(
        7,
        2,
        4,
        10,
        recording(10_000, 'application/octet-stream'),
        10_000,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(s.normalizer.normalize).not.toHaveBeenCalled();
    expect(s.objects.size).toBe(0);
  });
});

describe('Speaking recording ownership and lifecycle', () => {
  it("refuses another learner's attempt", async () => {
    const s = setup({ owner: 99 });
    await expect(
      s.service.confirmRecording(7, 2, 4, 10, recording(10_000), 10_000),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses the attempt under a different assessment', async () => {
    const s = setup();
    await expect(
      s.service.confirmRecording(7, 3, 4, 10, recording(10_000), 10_000),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a question that is not a Speaking task', async () => {
    const s = setup();
    await expect(
      s.service.confirmRecording(7, 2, 4, 13, recording(10_000), 10_000),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      s.service.confirmRecording(7, 2, 4, 999, recording(10_000), 10_000),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses a recording once the attempt is completed', async () => {
    const s = setup({ attemptStatus: 'COMPLETED' });
    await expect(
      s.service.confirmRecording(7, 2, 4, 10, recording(10_000), 10_000),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a recording delayed past the final submission cannot replace the submitted one, and leaves no object', async () => {
    const s = setup({ statusInsideLock: 'COMPLETED' });
    await expect(
      s.service.confirmRecording(7, 2, 4, 10, recording(10_000), 10_000),
    ).rejects.toThrow('Phiên kiểm tra đã hoàn tất');
    expect(s.rows).toHaveLength(0);
    expect(s.objects.size).toBe(0);
  });

  it('a re-recording replaces the response, deletes the old object, and makes the old job stale', async () => {
    const s = setup();
    await s.service.confirmRecording(7, 2, 4, 10, recording(10_000), 10_000);
    const firstJob = s.queued[0];
    await s.service.confirmRecording(7, 2, 4, 10, recording(20_000), 20_000);
    expect(s.rows).toHaveLength(1);
    expect(s.objects.has(firstJob.audioKey)).toBe(false);
    expect(s.objects.size).toBe(1);
    // The first recording's job arrives late: it must not grade anything.
    await s.service.processGradingJob({ data: firstJob });
    expect(s.calls).toHaveLength(0);
    expect(s.rows[0].status).toBe('QUEUED');
    await s.service.processGradingJob({ data: s.queued[1] });
    expect(s.rows[0].status).toBe('GRADED');
    expect(s.calls).toHaveLength(1);
  });

  it('delivering the same job twice grades once', async () => {
    const s = setup();
    await s.service.confirmRecording(7, 2, 4, 10, recording(10_000), 10_000);
    await s.service.processGradingJob({ data: s.queued[0] });
    await s.service.processGradingJob({ data: s.queued[0] });
    expect(s.calls).toHaveLength(1);
  });

  it('skip is recorded without a score, and a queued job for the skipped task goes stale', async () => {
    const s = setup();
    await s.service.confirmRecording(7, 2, 4, 10, recording(10_000), 10_000);
    const skipped = await s.service.skip(7, 2, 4, 10);
    expect(skipped.status).toBe('SKIPPED');
    expect(skipped.score).toBeNull();
    await s.service.processGradingJob({ data: s.queued[0] });
    expect(s.calls).toHaveLength(0);
    expect(s.rows[0].status).toBe('SKIPPED');
  });

  it('never exposes the storage key; audio is reached only by its owner', async () => {
    const s = setup();
    const out: any = await s.service.confirmRecording(
      7,
      2,
      4,
      10,
      recording(10_000),
      10_000,
    );
    expect(JSON.stringify(out)).not.toContain('premium/speaking');
    expect(out).not.toHaveProperty('audioKey');
    await expect(s.service.audio(8, out.id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(s.service.audio(7, out.id)).resolves.toEqual({
      url: expect.stringContaining('https://signed/'),
    });
  });
});

describe('Speaking rubric grading', () => {
  async function confirmed() {
    const s = setup();
    await s.service.confirmRecording(7, 2, 4, 10, recording(30_000), 30_000);
    return s;
  }

  it('grades with the task rubric and persists validated criteria and a percentage', async () => {
    const s = await confirmed();
    await s.service.processGradingJob({ data: s.queued[0] });
    const row = s.rows[0];
    expect(s.calls[0].rubric.version).toBe('SPK_RUBRIC_V3');
    expect(s.calls[0].skill).toBe('SPEAKING');
    expect(s.calls[0].durationMs).toBe(30_000);
    expect(row.status).toBe('GRADED');
    expect(row.score).toBeCloseTo(((3 + 2 + 4 + 3) / 16) * 100);
    expect(row.scoreMetadata.criteria).toEqual({
      task_fulfilment: 3,
      intelligibility: 2,
      fluency: 4,
      language_use: 3,
    });
    expect(row.rubricVersion).toBe('SPK_RUBRIC_V3');
    expect(row.provider).toBe('fake');
  });

  it('rejects malformed output and retries once, then fails without inventing a score', async () => {
    const s = await confirmed();
    s.setGrader([
      () =>
        Promise.resolve({
          submissionRef: s.calls[0]?.submissionRef,
          criteria: { fluency: 9 },
        }),
      () => Promise.resolve('not json at all'),
    ]);
    await s.service.processGradingJob({ data: s.queued[0] });
    expect(s.calls).toHaveLength(2);
    expect(s.rows[0].status).toBe('GRADING_FAILED');
    expect(s.rows[0].score).toBeNull();
    expect(s.rows[0].failureReason).toMatch(/^INVALID_GRADER_OUTPUT:/);
  });

  it('rejects output that grades a different submission', async () => {
    const s = await confirmed();
    const wrong = () =>
      Promise.resolve({
        submissionRef: 'speaking:999:other',
        criteria: {
          task_fulfilment: 4,
          intelligibility: 4,
          fluency: 4,
          language_use: 4,
        },
        feedback: 'x',
      });
    s.setGrader([wrong, wrong]);
    await s.service.processGradingJob({ data: s.queued[0] });
    expect(s.rows[0].status).toBe('GRADING_FAILED');
    expect(s.rows[0].failureReason).toContain('DIFFERENT_SUBMISSION');
  });

  it('recovers from a transient provider error on the second call', async () => {
    const s = await confirmed();
    s.setGrader([() => Promise.reject(new Error('timeout'))]);
    await s.service.processGradingJob({ data: s.queued[0] });
    expect(s.rows[0].status).toBe('GRADED');
    expect(s.rows[0].gradingAttempts).toBe(2);
  });

  it('fails a permanently failing provider after the retry budget, with a reason', async () => {
    const s = await confirmed();
    s.setGrader([
      () => Promise.reject(new Error('500')),
      () => Promise.reject(new Error('500')),
    ]);
    await s.service.processGradingJob({ data: s.queued[0] });
    expect(s.rows[0].status).toBe('GRADING_FAILED');
    expect(s.rows[0].failureReason).toBe('GRADER_ERROR:500');
    expect(s.rows[0].score).toBeNull();
  });

  it('does not retry an unavailable grader', async () => {
    const s = await confirmed();
    s.setGrader([
      () =>
        Promise.reject(
          new DiagnosticGraderUnavailableError(
            'SPEAKING_RUBRIC_GRADER_NOT_CONFIGURED',
          ),
        ),
    ]);
    await s.service.processGradingJob({ data: s.queued[0] });
    expect(s.calls).toHaveLength(1);
    expect(s.rows[0].failureReason).toBe(
      'SPEAKING_RUBRIC_GRADER_NOT_CONFIGURED',
    );
  });

  it('does not call the grader when normalization fails', async () => {
    const s = await confirmed();
    s.normalizer.normalize.mockRejectedValueOnce(new Error('invalid media'));
    await s.service.processGradingJob({ data: s.queued[0] });
    expect(s.calls).toHaveLength(0);
    expect(s.rows[0].status).toBe('GRADING_FAILED');
    expect(s.rows[0].failureReason).toBe('invalid media');
  });

  it('fails closed when the task has no rubric or a rubric of the wrong skill', async () => {
    const s = await confirmed();
    s.prisma.diagnosticRubric.findUnique.mockResolvedValueOnce({
      ...RUBRIC,
      skill: 'WRITING',
    });
    await s.service.processGradingJob({ data: s.queued[0] });
    expect(s.calls).toHaveLength(0);
    expect(s.rows[0].failureReason).toBe('RUBRIC_SKILL_MISMATCH');
  });
});

describe('Speaking retry and worker failure', () => {
  async function failed() {
    const s = setup();
    await s.service.confirmRecording(7, 2, 4, 10, recording(30_000), 30_000);
    s.setGrader([
      () => Promise.reject(new Error('down')),
      () => Promise.reject(new Error('down')),
    ]);
    await s.service.processGradingJob({ data: s.queued[0] });
    expect(s.rows[0].status).toBe('GRADING_FAILED');
    return s;
  }

  it('re-queues a failed recording with the same audio and grades it', async () => {
    const s = await failed();
    const out = await s.service.retry(7, 2, 4, 10);
    expect(out.status).toBe('QUEUED');
    expect(s.queued[1].audioKey).toBe(s.queued[0].audioKey);
    await s.service.processGradingJob({ data: s.queued[1] });
    expect(s.rows[0].status).toBe('GRADED');
  });

  it('two concurrent retries queue one run', async () => {
    const s = await failed();
    const results = await Promise.allSettled([
      s.service.retry(7, 2, 4, 10),
      s.service.retry(7, 2, 4, 10),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      (results.find((r) => r.status === 'rejected') as PromiseRejectedResult)
        .reason,
    ).toBeInstanceOf(ConflictException);
    expect(s.queued).toHaveLength(2);
  });

  it('refuses retry of a response that did not fail', async () => {
    const s = setup();
    await s.service.confirmRecording(7, 2, 4, 10, recording(30_000), 30_000);
    await expect(s.service.retry(7, 2, 4, 10)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('refuses retry by another learner', async () => {
    const s = await failed();
    await expect(s.service.retry(8, 2, 4, 10)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('a crashed or stalled job leaves its run GRADING_FAILED and retryable, never stuck in GRADING', async () => {
    const s = setup();
    await s.service.confirmRecording(7, 2, 4, 10, recording(30_000), 30_000);
    s.rows[0].status = 'GRADING';
    await (s.service as any).markRunFailed(
      s.queued[0],
      'WORKER_FAILED: stalled',
    );
    expect(s.rows[0].status).toBe('GRADING_FAILED');
    await expect(s.service.retry(7, 2, 4, 10)).resolves.toMatchObject({
      status: 'QUEUED',
    });
  });

  it('a stalled OLD run cannot fail a newer recording', async () => {
    const s = setup();
    await s.service.confirmRecording(7, 2, 4, 10, recording(10_000), 10_000);
    const stale = s.queued[0];
    await s.service.confirmRecording(7, 2, 4, 10, recording(20_000), 20_000);
    await (s.service as any).markRunFailed(stale, 'WORKER_FAILED: stalled');
    expect(s.rows[0].status).toBe('QUEUED');
  });
});
