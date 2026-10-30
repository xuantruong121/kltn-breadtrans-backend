import { DiagnosticWritingService } from './diagnostic-writing.service';

/**
 * CP60-OPS-01: after a database restore, a QUEUED Writing row can expect a
 * job id the queue already finished (kept 7 days), so re-adding it is a
 * no-op. Rows whose job is not waiting or running get a new run.
 */
describe('Diagnostic Writing stranded QUEUED recovery', () => {
  const NOW = Date.UTC(2026, 9, 30, 12);

  const make = (state: string | null, moved = 1) => {
    const prisma: any = {
      diagnosticWritingResponse: {
        findMany: jest.fn().mockResolvedValue([{ id: 7, gradingAttempts: 2 }]),
        updateMany: jest.fn().mockResolvedValue({ count: moved }),
      },
    };
    const service: any = new DiagnosticWritingService(
      prisma,
      {} as any,
      {} as any,
    );
    service.queue = {
      getJob: jest
        .fn()
        .mockResolvedValue(
          state === null
            ? undefined
            : { getState: () => Promise.resolve(state) },
        ),
      add: jest.fn().mockResolvedValue(undefined),
    };
    return { service, prisma };
  };

  it('looks only at QUEUED rows submitted more than five minutes ago', async () => {
    const { service, prisma } = make('waiting');
    await service.recoverStrandedQueued(NOW);
    expect(
      prisma.diagnosticWritingResponse.findMany.mock.calls[0][0].where,
    ).toEqual({
      status: 'QUEUED',
      submittedAt: { lt: new Date(NOW - 5 * 60_000) },
    });
  });

  it.each([[null], ['completed'], ['failed'], ['unknown']])(
    'job %p: the row gets a new run and a new job',
    async (state) => {
      const { service, prisma } = make(state);
      expect(await service.recoverStrandedQueued(NOW)).toBe(1);
      expect(service.queue.getJob).toHaveBeenCalledWith(
        'diagnostic-writing-7-2',
      );
      expect(prisma.diagnosticWritingResponse.updateMany).toHaveBeenCalledWith({
        where: { id: 7, status: 'QUEUED', gradingAttempts: 2 },
        data: { gradingAttempts: 3 },
      });
      expect(service.queue.add).toHaveBeenCalledWith(
        expect.any(String),
        { responseId: 7, run: 3 },
        { jobId: 'diagnostic-writing-7-3' },
      );
    },
  );

  it.each([['waiting'], ['active'], ['delayed'], ['prioritized']])(
    'job %p: still live, left alone',
    async (state) => {
      const { service, prisma } = make(state);
      expect(await service.recoverStrandedQueued(NOW)).toBe(0);
      expect(
        prisma.diagnosticWritingResponse.updateMany,
      ).not.toHaveBeenCalled();
      expect(service.queue.add).not.toHaveBeenCalled();
    },
  );

  it('a row that changed meanwhile (retry, grading) is not requeued', async () => {
    const { service } = make('completed', 0);
    expect(await service.recoverStrandedQueued(NOW)).toBe(0);
    expect(service.queue.add).not.toHaveBeenCalled();
  });

  it('without a queue it does nothing', async () => {
    const { service, prisma } = make(null);
    service.queue = undefined;
    expect(await service.recoverStrandedQueued(NOW)).toBe(0);
    expect(prisma.diagnosticWritingResponse.findMany).not.toHaveBeenCalled();
  });
});
