import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import {
  SPEAKING_QUEUE_NAME,
  SPEAKING_JOB_NAME,
  SpeakingJobPayload,
  getSpeakingJobId,
  getSpeakingWorkerConfig,
} from './speaking.constants';

@Injectable()
export class SpeakingQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SpeakingQueueService.name);
  private connection: IORedis;
  private queue: Queue<SpeakingJobPayload, unknown, string>;

  onModuleInit(): void {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    this.connection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    const { jobTimeoutMs } = getSpeakingWorkerConfig();

    this.queue = new Queue<SpeakingJobPayload, unknown, string>(
      SPEAKING_QUEUE_NAME,
      {
        connection: this.connection,
        defaultJobOptions: {
          attempts: 4,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { age: 30 * 86400, count: 500 },
          removeOnFail: { age: 7 * 86400, count: 500 },
        },
      },
    );

    this.logger.log(
      `Initialized BullMQ queue "${SPEAKING_QUEUE_NAME}" (Default timeout: ${jobTimeoutMs}ms)`,
    );
  }

  async enqueueSubmission(
    submissionId: number,
    traceId: string,
  ): Promise<string> {
    const jobId = getSpeakingJobId(submissionId);

    const job = await this.queue.add(
      SPEAKING_JOB_NAME,
      { submissionId, traceId },
      {
        jobId,
        // Deterministic jobId ensures idempotency: duplicate adds with same jobId are no-ops
      },
    );

    this.logger.log(
      `[SpeakingQueue] Enqueued job: jobId=${job.id} submissionId=${submissionId} traceId=${traceId}`,
    );

    return job.id || jobId;
  }

  getQueue(): Queue<SpeakingJobPayload, unknown, string> {
    return this.queue;
  }

  getConnection(): IORedis {
    return this.connection;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
    }
    if (this.connection) {
      await this.connection.quit();
    }
    this.logger.log(`Closed BullMQ queue "${SPEAKING_QUEUE_NAME}" connection`);
  }
}
