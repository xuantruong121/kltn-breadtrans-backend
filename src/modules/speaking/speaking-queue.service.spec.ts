import { SpeakingQueueService } from './speaking-queue.service';
import {
  SPEAKING_JOB_NAME,
  getSpeakingJobId,
  getSpeakingWorkerConfig,
} from './speaking.constants';

describe('SpeakingQueueService & Config', () => {
  let service: SpeakingQueueService;
  let mockQueue: any;

  beforeEach(() => {
    service = new SpeakingQueueService();
    mockQueue = {
      add: jest.fn().mockImplementation((name, data, opts) => ({
        id: opts.jobId,
        name,
        data,
      })),
      close: jest.fn().mockResolvedValue(undefined),
    };
    (service as any).queue = mockQueue;
    (service as any).connection = {
      quit: jest.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  it('1. Deterministic job ID helper returns expected format', () => {
    expect(getSpeakingJobId(1234)).toBe('speaking-assessment:1234');
    expect(getSpeakingJobId(1)).toBe('speaking-assessment:1');
  });

  it('2. Enqueues job with deterministic ID preventing duplicate jobs', async () => {
    const jobId = await service.enqueueSubmission(42, 'trace-abc');

    expect(jobId).toBe('speaking-assessment:42');
    expect(mockQueue.add).toHaveBeenCalledWith(
      SPEAKING_JOB_NAME,
      { submissionId: 42, traceId: 'trace-abc' },
      { jobId: 'speaking-assessment:42' },
    );
  });

  it('3. Bounded worker configuration defaults and clamps values', () => {
    delete process.env.SPEAKING_WORKER_CONCURRENCY;
    delete process.env.SPEAKING_WORKER_RATE_LIMIT_MAX;
    delete process.env.SPEAKING_WORKER_RATE_LIMIT_DURATION_MS;
    delete process.env.SPEAKING_JOB_TIMEOUT_MS;

    const defaultConfig = getSpeakingWorkerConfig();
    expect(defaultConfig.concurrency).toBe(1);
    expect(defaultConfig.rateLimitMax).toBe(1);
    expect(defaultConfig.rateLimitDurationMs).toBe(1000);
    expect(defaultConfig.jobTimeoutMs).toBe(20000);

    // Clamping invalid / out-of-range values
    process.env.SPEAKING_WORKER_CONCURRENCY = '999'; // exceeds max 20
    process.env.SPEAKING_WORKER_RATE_LIMIT_MAX = '-5'; // negative
    process.env.SPEAKING_WORKER_RATE_LIMIT_DURATION_MS = '10'; // below min 100ms
    process.env.SPEAKING_JOB_TIMEOUT_MS = '1000'; // below min 5000ms

    const clampedConfig = getSpeakingWorkerConfig();
    expect(clampedConfig.concurrency).toBe(1);
    expect(clampedConfig.rateLimitMax).toBe(1);
    expect(clampedConfig.rateLimitDurationMs).toBe(1000);
    expect(clampedConfig.jobTimeoutMs).toBe(20000);

    // Valid custom config
    process.env.SPEAKING_WORKER_CONCURRENCY = '5';
    process.env.SPEAKING_WORKER_RATE_LIMIT_MAX = '5';
    process.env.SPEAKING_WORKER_RATE_LIMIT_DURATION_MS = '2000';
    process.env.SPEAKING_JOB_TIMEOUT_MS = '30000';

    const validConfig = getSpeakingWorkerConfig();
    expect(validConfig.concurrency).toBe(5);
    expect(validConfig.rateLimitMax).toBe(5);
    expect(validConfig.rateLimitDurationMs).toBe(2000);
    expect(validConfig.jobTimeoutMs).toBe(30000);
  });
});
