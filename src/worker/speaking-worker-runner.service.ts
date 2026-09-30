import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import {
  SPEAKING_QUEUE_NAME,
  SpeakingJobPayload,
  getSpeakingWorkerConfig,
} from '../modules/speaking/speaking.constants';
import { SpeakingProcessorService } from '../modules/speaking/speaking-processor.service';

@Injectable()
export class SpeakingWorkerRunnerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SpeakingWorkerRunnerService.name);
  private connection: IORedis;
  private worker: Worker<SpeakingJobPayload, unknown, string>;

  constructor(private readonly processorService: SpeakingProcessorService) {}

  onModuleInit(): void {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    this.connection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    const { concurrency, rateLimitMax, rateLimitDurationMs, jobTimeoutMs } =
      getSpeakingWorkerConfig();

    this.logger.log(
      `[SpeakingWorkerRunner] Initializing BullMQ Worker on queue "${SPEAKING_QUEUE_NAME}"`,
    );
    this.logger.log(
      `[SpeakingWorkerRunner] Loaded Responsibilities: [BullMQ Consumer, Audio Validator, Storage Access, Pronunciation Assessment, DB Persist, Redis Event Publisher]. Zero HTTP controllers, Zero schedulers, Zero gateways.`,
    );
    this.logger.log(
      `[SpeakingWorkerRunner] Selected Configuration: Concurrency=${concurrency}, RateLimitMax=${rateLimitMax} per ${rateLimitDurationMs}ms, JobTimeout=${jobTimeoutMs}ms`,
    );

    this.worker = new Worker<SpeakingJobPayload, unknown, string>(
      SPEAKING_QUEUE_NAME,
      async (job: Job<SpeakingJobPayload>) => {
        this.logger.log(
          `[SpeakingWorkerRunner] Received job #${job.id}: submissionId=${job.data.submissionId}, traceId=${job.data.traceId}`,
        );
        await this.processorService.processJob(job.data);
      },
      {
        connection: this.connection,
        concurrency,
        limiter: {
          max: rateLimitMax,
          duration: rateLimitDurationMs,
        },
        lockDuration: 30000,
      },
    );

    this.worker.on('completed', (job) => {
      this.logger.log(
        `[SpeakingWorkerRunner] Job #${job.id} completed successfully (submissionId=${job.data?.submissionId})`,
      );
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `[SpeakingWorkerRunner] Job #${job?.id} failed: ${err.message} (attempt=${job?.attemptsMade})`,
      );
    });

    this.worker.on('error', (err) => {
      this.logger.error(`[SpeakingWorkerRunner] Worker error: ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log(`[SpeakingWorkerRunner] Shutting down worker...`);
    if (this.worker) {
      await this.worker.close();
    }
    if (this.connection) {
      await this.connection.quit();
    }
    await this.processorService.close();
    this.logger.log(`[SpeakingWorkerRunner] Worker shutdown complete`);
  }
}
