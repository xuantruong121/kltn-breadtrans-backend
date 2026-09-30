import { Test, TestingModule } from '@nestjs/testing';
import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { SpeakingQueueService } from './speaking-queue.service';
import {
  SpeakingJobPayload,
  getSpeakingJobId,
} from './speaking.constants';

describe('SpeakingQueueService (Real BullMQ/Redis Integration)', () => {
  let queueService: SpeakingQueueService;
  let testQueue: Queue<SpeakingJobPayload, unknown, string>;
  let redisConnection: IORedis;
  const testQueueName = `int-queue-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  beforeAll(async () => {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    redisConnection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [SpeakingQueueService],
    }).compile();

    queueService = module.get<SpeakingQueueService>(SpeakingQueueService);

    // Override internal queue name to an isolated integration queue to prevent interference
    (queueService as any).queueName = testQueueName;
    testQueue = new Queue<SpeakingJobPayload, unknown, string>(testQueueName, {
      connection: redisConnection,
      defaultJobOptions: {
        removeOnComplete: { age: 3600, count: 50 },
        removeOnFail: { age: 3600, count: 50 },
      },
    });
    (queueService as any).queue = testQueue;
  });

  afterAll(async () => {
    if (testQueue) {
      await testQueue.obliterate({ force: true });
      await testQueue.close();
    }
    if (redisConnection) {
      await redisConnection.quit();
    }
    await queueService.onModuleDestroy();
  });

  it('1. Adds a job using the exact production job-ID builder without colons', async () => {
    const submissionId = 555;
    const expectedJobId = getSpeakingJobId(submissionId);

    // Assert that custom job ID does NOT contain colons
    expect(expectedJobId).toBe(`speaking-assessment-${submissionId}`);
    expect(expectedJobId).not.toContain(':');

    const returnedJobId = await queueService.enqueueSubmission(
      submissionId,
      'trace-int-1',
    );
    expect(returnedJobId).toBe(expectedJobId);
  });

  it('2. Confirms Redis actually contains the job with matching payload', async () => {
    const submissionId = 555;
    const jobId = getSpeakingJobId(submissionId);

    const job = await testQueue.getJob(jobId);
    expect(job).not.toBeNull();
    expect(job?.id).toBe(jobId);
    expect(job?.data.submissionId).toBe(555);
    expect(job?.data.traceId).toBe('trace-int-1');
  });

  it('3. Adds the same submission again and confirms no second job is created (Deduplication)', async () => {
    const submissionId = 555;
    const jobId = getSpeakingJobId(submissionId);

    // Attempt second enqueue of the same submission
    const duplicateReturnId = await queueService.enqueueSubmission(
      submissionId,
      'trace-int-2-duplicate',
    );
    expect(duplicateReturnId).toBe(jobId);

    // Check count of waiting/delayed jobs in Redis queue
    const waitingJobs = await testQueue.getWaiting();
    const matchingJobs = waitingJobs.filter((j) => j.id === jobId);
    expect(matchingJobs.length).toBe(1);

    // Total waiting count is 1, not 2
    const count = await testQueue.getWaitingCount();
    expect(count).toBe(1);
  });

  it('4. Processes and completes the job using a real BullMQ Worker', async () => {
    const submissionId = 555;
    const jobId = getSpeakingJobId(submissionId);

    let processedPayload: SpeakingJobPayload | null = null;

    const worker = new Worker<SpeakingJobPayload>(
      testQueueName,
      (job: Job<SpeakingJobPayload>) => {
        processedPayload = job.data;
        return Promise.resolve({ status: 'OK' });
      },
      { connection: redisConnection },
    );

    // Wait for completed event
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Worker did not complete job in 5s')),
        5000,
      );
      worker.on('completed', (job) => {
        if (job.id === jobId) {
          clearTimeout(timeout);
          resolve();
        }
      });
      worker.on('failed', (_, err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    await worker.close();

    expect(processedPayload).not.toBeNull();
    expect(processedPayload).toEqual(
      expect.objectContaining({ submissionId }),
    );

    const completedJob = await testQueue.getJob(jobId);
    expect(completedJob).not.toBeNull();
    const state = await completedJob?.getState();
    expect(state).toBe('completed');
  });

  it('5. Removes completed job and tests safe reconciliation re-enqueueing without conflicts', async () => {
    const submissionId = 555;
    const jobId = getSpeakingJobId(submissionId);

    // Simulate retention cleanup or manual eviction
    const job = await testQueue.getJob(jobId);
    if (job) {
      await job.remove();
    }

    const jobAfterRemoval = await testQueue.getJob(jobId);
    expect(jobAfterRemoval).toBeUndefined();

    // Re-enqueue as reconciliation would do
    const restoredJobId = await queueService.enqueueSubmission(
      submissionId,
      'trace-reconcile-restored',
    );
    expect(restoredJobId).toBe(jobId);

    const restoredJob = await testQueue.getJob(jobId);
    expect(restoredJob).not.toBeNull();
    expect(restoredJob?.id).toBe(jobId);
    expect(restoredJob?.data.traceId).toBe('trace-reconcile-restored');
  });
});
