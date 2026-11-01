import { DiagnosticSpeakingService } from './diagnostic-speaking.service';

/**
 * CP60-OPS-01: after a database restore or a Redis loss a row can wait for a
 * job that no longer exists. Job ids carry a timestamp, so liveness is read
 * from the queue by the response and its recording, not by job id.
 */
describe('Diagnostic Speaking stranded recovery', () => {
  const NOW = Date.UTC(2026, 9, 30, 12);
  const KEY = 'premium/speaking/diagnostic/1/2/3/a.wav';
  const row = (status: string) => ({ id: 7, status, audioKey: KEY });

  const make = (rows: unknown[], liveJobs: unknown[] = []) => {
    const prisma: any = {
      diagnosticSpeakingResponse: {
        findMany: jest.fn().mockResolvedValue(rows),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service: any = new DiagnosticSpeakingService(
      prisma,
      {} as any,
      {} as any,
      undefined,
      {} as any,
    );
    service.queue = {
      getJobs: jest.fn().mockResolvedValue(liveJobs),
      add: jest.fn().mockResolvedValue(undefined),
    };
    return { service, prisma };
  };

  it('looks only at unfinished recordings confirmed more than five minutes ago', async () => {
    const { service, prisma } = make([]);
    await service.recoverStrandedQueued(NOW);
    expect(
      prisma.diagnosticSpeakingResponse.findMany.mock.calls[0][0].where,
    ).toEqual({
      status: { in: ['QUEUED', 'GRADING'] },
      audioKey: { not: null },
      confirmedAt: { lt: new Date(NOW - 5 * 60_000) },
    });
    expect(service.queue.getJobs).not.toHaveBeenCalled();
  });

  it('a QUEUED row with no live job is queued again for the same recording', async () => {
    const { service } = make([row('QUEUED')]);
    expect(await service.recoverStrandedQueued(NOW)).toBe(1);
    expect(service.queue.add).toHaveBeenCalledWith(
      expect.any(String),
      { responseId: 7, audioKey: KEY },
      { jobId: expect.stringContaining('diagnostic-speaking-7-') },
    );
  });

  it('a job for an older recording does not count as live', async () => {
    const { service } = make(
      [row('QUEUED')],
      [{ data: { responseId: 7, audioKey: 'older.wav' } }],
    );
    expect(await service.recoverStrandedQueued(NOW)).toBe(1);
    expect(service.queue.add).toHaveBeenCalledTimes(1);
  });

  it.each([['QUEUED'], ['GRADING']])(
    '%s with a live job for this recording: left alone',
    async (status) => {
      const { service, prisma } = make(
        [row(status)],
        [undefined, { data: { responseId: 7, audioKey: KEY } }],
      );
      expect(await service.recoverStrandedQueued(NOW)).toBe(0);
      expect(service.queue.add).not.toHaveBeenCalled();
      expect(
        prisma.diagnosticSpeakingResponse.updateMany,
      ).not.toHaveBeenCalled();
    },
  );

  it('a GRADING row with no live job fails so the learner can retry', async () => {
    const { service, prisma } = make([row('GRADING')]);
    expect(await service.recoverStrandedQueued(NOW)).toBe(1);
    expect(service.queue.add).not.toHaveBeenCalled();
    expect(prisma.diagnosticSpeakingResponse.updateMany).toHaveBeenCalledWith({
      where: { id: 7, audioKey: KEY, status: { in: ['QUEUED', 'GRADING'] } },
      data: {
        status: 'GRADING_FAILED',
        score: null,
        failureReason: 'GRADING_LOST',
      },
    });
  });

  it('a duplicate job cannot grade twice: only the first claim wins', async () => {
    const { service, prisma } = make([]);
    prisma.diagnosticSpeakingResponse.updateMany.mockResolvedValue({
      count: 0,
    });
    await service.gradeDiagnosticSpeakingJob({
      data: { responseId: 7, audioKey: KEY },
    });
    expect(prisma.diagnosticSpeakingResponse.updateMany).toHaveBeenCalledTimes(
      1,
    );
  });

  it('without a queue it does nothing', async () => {
    const { service, prisma } = make([row('QUEUED')]);
    service.queue = undefined;
    expect(await service.recoverStrandedQueued(NOW)).toBe(0);
    expect(prisma.diagnosticSpeakingResponse.findMany).not.toHaveBeenCalled();
  });

  it('a Redis error is logged, not thrown', async () => {
    const { service } = make([row('QUEUED')]);
    service.queue.getJobs.mockRejectedValue(new Error('redis down'));
    await expect(service.recoverStrandedQueued(NOW)).resolves.toBe(0);
  });
});
