import * as fs from 'fs';
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
  getLeaseTimeoutMs,
  getSpeakingPipelineMode,
} from '../modules/speaking/speaking.constants';
import { SpeakingProcessorService } from '../modules/speaking/speaking-processor.service';

const HEARTBEAT_FILE =
  process.env.WORKER_HEARTBEAT_FILE || '/tmp/worker-heartbeat';

@Injectable()
export class SpeakingWorkerRunnerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SpeakingWorkerRunnerService.name);
  private connection: IORedis;
  private worker: Worker<SpeakingJobPayload, unknown, string>;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(private readonly processorService: SpeakingProcessorService) {}

  onModuleInit(): void {
    if (getSpeakingPipelineMode() !== 'bullmq') {
      throw new Error(
        'Standalone speaking worker requires SPEAKING_PIPELINE_MODE=bullmq',
      );
    }
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    this.connection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    const { concurrency, rateLimitMax, rateLimitDurationMs, jobTimeoutMs } =
      getSpeakingWorkerConfig();
    const leaseTimeoutMs = getLeaseTimeoutMs(jobTimeoutMs);

    this.logger.log(
      `[SpeakingWorkerRunner] Initializing BullMQ Worker on queue "${SPEAKING_QUEUE_NAME}"`,
    );
    this.logger.log(
      `[SpeakingWorkerRunner] Loaded Responsibilities: [BullMQ Consumer, Audio Validator, Storage Access, Pronunciation Assessment, DB Persist, Redis Event Publisher]. Zero HTTP controllers, Zero schedulers, Zero gateways.`,
    );
    this.logger.log(
      `[SpeakingWorkerRunner] Selected Configuration: Concurrency=${concurrency}, RateLimitMax=${rateLimitMax} per ${rateLimitDurationMs}ms, JobTimeout=${jobTimeoutMs}ms, LeaseTimeout=${leaseTimeoutMs}ms`,
    );

    this.worker = new Worker<SpeakingJobPayload, unknown, string>(
      SPEAKING_QUEUE_NAME,
      async (job: Job<SpeakingJobPayload>) => {
        this.logger.log(
          `[SpeakingWorkerRunner] Received job #${job.id}: submissionId=${job.data.submissionId}, traceId=${job.data.traceId}`,
        );
        await this.processorService.processJob(
          job.data,
          job.attemptsMade + 1,
          job.opts.attempts ?? 4,
        );
      },
      {
        connection: this.connection,
        concurrency,
        limiter: {
          max: rateLimitMax,
          duration: rateLimitDurationMs,
        },
        lockDuration: leaseTimeoutMs,
        stalledInterval: leaseTimeoutMs,
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

    // Start functional healthcheck heartbeat
    this.writeHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.writeHeartbeat();
    }, 5000);
  }

  private writeHeartbeat(): void {
    try {
      fs.writeFileSync(HEARTBEAT_FILE, String(Date.now()), 'utf8');
    } catch (err: any) {
      this.logger.warn(
        `[SpeakingWorkerRunner] Heartbeat write failed: ${err.message}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log(`[SpeakingWorkerRunner] Shutting down worker...`);
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    try {
      if (fs.existsSync(HEARTBEAT_FILE)) {
        fs.unlinkSync(HEARTBEAT_FILE);
      }
    } catch {
      // ignore
    }
    if (this.worker) {
      await this.worker.close();
    }
    if (this.connection && this.connection.status !== 'end') {
      try {
        await this.connection.quit();
      } catch {
        // ignore already closed
      }
    }
    await this.processorService.close();
    this.logger.log(`[SpeakingWorkerRunner] Worker shutdown complete`);
  }
}
