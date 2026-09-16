import { SystemJobsService } from './system-jobs.service';
import { JOB_NAMES } from './jobs.constants';

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    quit: jest.fn().mockResolvedValue('OK'),
  }));
});

const mockJob = {
  id: 'daily-rollover-2026-09-16',
  getState: jest.fn(),
  remove: jest.fn().mockResolvedValue(undefined),
};

const mockQueue = {
  add: jest.fn().mockResolvedValue({ id: 'daily-rollover-2026-09-16' }),
  getJob: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};

jest.mock('bullmq', () => {
  return {
    Queue: jest.fn().mockImplementation(() => mockQueue),
    Worker: jest.fn().mockImplementation(() => ({
      on: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    })),
  };
});

describe('SystemJobsService', () => {
  let service: SystemJobsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SystemJobsService({} as any, {} as any, {} as any);
  });

  it('removes an existing failed job before re-adding with the same deterministic ID', async () => {
    mockJob.getState.mockResolvedValue('failed');
    mockQueue.getJob.mockResolvedValue(mockJob);

    await service.enqueueDaily('2026-09-16');

    expect(mockQueue.getJob).toHaveBeenCalledWith('daily-rollover-2026-09-16');
    expect(mockJob.getState).toHaveBeenCalled();
    expect(mockJob.remove).toHaveBeenCalled();
    expect(mockQueue.add).toHaveBeenCalledWith(
      JOB_NAMES.DAILY_ROLLOVER,
      { version: 1, dayKey: '2026-09-16' },
      { jobId: 'daily-rollover-2026-09-16', delay: undefined },
    );
  });

  it('does not remove an existing completed job', async () => {
    mockJob.getState.mockResolvedValue('completed');
    mockQueue.getJob.mockResolvedValue(mockJob);

    await service.enqueueDaily('2026-09-16');

    expect(mockQueue.getJob).toHaveBeenCalledWith('daily-rollover-2026-09-16');
    expect(mockJob.getState).toHaveBeenCalled();
    expect(mockJob.remove).not.toHaveBeenCalled();
    expect(mockQueue.add).toHaveBeenCalled();
  });
});
