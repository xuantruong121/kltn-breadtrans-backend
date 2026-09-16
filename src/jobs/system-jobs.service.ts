import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Worker, Queue, Job } from 'bullmq';
import IORedis from 'ioredis';
import { GamificationService } from '../modules/gamification/gamification.service';
import { NotificationsCronService } from '../modules/notifications/notifications.cron';
import { R2CleanupService } from '../modules/upload/r2-cleanup.service';
import {
  JOB_NAMES,
  SYSTEM_QUEUE_NAME,
  SystemJobPayload,
  SystemJobName,
} from './jobs.constants';

@Injectable()
export class SystemJobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SystemJobsService.name);
  private readonly connection: IORedis;
  private readonly queue: Queue<SystemJobPayload, unknown, SystemJobName>;
  private worker?: Worker<SystemJobPayload, unknown, SystemJobName>;

  constructor(
    private readonly gamification: GamificationService,
    private readonly notifications: NotificationsCronService,
    private readonly r2Cleanup: R2CleanupService,
  ) {
    this.connection = new IORedis(
      process.env.REDIS_URL || 'redis://localhost:6379',
      { maxRetriesPerRequest: null, enableReadyCheck: false },
    );
    this.queue = new Queue<SystemJobPayload, unknown, SystemJobName>(
      SYSTEM_QUEUE_NAME,
      {
        connection: this.connection,
        defaultJobOptions: {
          attempts: 4,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: { age: 30 * 86400, count: 500 },
          removeOnFail: { age: 7 * 86400, count: 500 },
        },
      },
    );
  }

  onModuleInit(): void {
    this.worker = new Worker<SystemJobPayload, unknown, SystemJobName>(
      SYSTEM_QUEUE_NAME,
      async (job) => this.process(job),
      { connection: this.connection, concurrency: 1 },
    );
    this.worker.on('completed', (job) =>
      this.logger.log(`system_job_completed jobId=${job.id} name=${job.name}`),
    );
    this.worker.on('failed', (job, error) =>
      this.logger.error(
        `system_job_failed jobId=${job?.id} name=${job?.name} attempt=${job?.attemptsMade}: ${error.message}`,
      ),
    );
    this.worker.on('error', (error) =>
      this.logger.error(`system_worker_error: ${error.message}`),
    );
  }

  async enqueueDaily(dayKey: string): Promise<void> {
    await this.enqueue(
      JOB_NAMES.DAILY_ROLLOVER,
      { version: 1, dayKey },
      { jobId: `daily-rollover-${dayKey}` },
    );
  }

  async enqueueWeekly(weekKey: string): Promise<void> {
    await this.enqueue(
      JOB_NAMES.WEEKLY_LEAGUE,
      {
        version: 1,
        weekKey,
      },
      { jobId: `weekly-league-${weekKey}` },
    );
  }

  async enqueueStreakReminder(dayKey: string): Promise<void> {
    await this.enqueue(
      JOB_NAMES.STREAK_REMINDER,
      { version: 1, dayKey },
      { jobId: `streak-reminder-${dayKey}` },
    );
  }

  async enqueueVocabularyReview(bucketKey: string): Promise<void> {
    await this.enqueue(
      JOB_NAMES.VOCABULARY_REVIEW,
      { version: 1 },
      { jobId: `vocabulary-review-${bucketKey}` },
    );
  }

  async enqueueR2Cleanup(weekKey: string): Promise<void> {
    await this.enqueue(
      JOB_NAMES.R2_AUDIO_CLEANUP,
      { version: 1, weekKey },
      { jobId: `r2-audio-cleanup-${weekKey}` },
    );
  }

  async enqueue(
    name: SystemJobName,
    payload: SystemJobPayload,
    options?: { jobId?: string; delay?: number },
  ): Promise<string> {
    if (options?.jobId) {
      try {
        const existing = await this.queue.getJob(options.jobId);
        if (existing) {
          const state = await existing.getState();
          if (state === 'failed') {
            await existing.remove();
          }
        }
      } catch (err) {
        this.logger.warn(
          `Failed to inspect or remove existing failed job ${options.jobId}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    const job = await this.queue.add(name, payload, {
      jobId: options?.jobId,
      delay: options?.delay,
    });
    return String(job.id);
  }

  private async process(
    job: Job<SystemJobPayload, unknown, SystemJobName>,
  ): Promise<unknown> {
    this.logger.log(
      `system_job_started jobId=${job.id} name=${job.name} attempt=${job.attemptsMade + 1}`,
    );
    switch (job.name) {
      case JOB_NAMES.DAILY_ROLLOVER:
        return this.gamification.triggerDailyCron(job.data.dayKey);
      case JOB_NAMES.WEEKLY_LEAGUE:
        return this.gamification.triggerWeeklyCron(false, job.data.weekKey);
      case JOB_NAMES.STREAK_REMINDER:
        return this.notifications.runDailyStreakReminder(job.data.dayKey);
      case JOB_NAMES.VOCABULARY_REVIEW:
        return this.notifications.runVocabSpacedReview();
      case JOB_NAMES.R2_AUDIO_CLEANUP:
        return this.r2Cleanup.runCleanup();
      default:
        throw new Error('Unknown system job');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
    await this.connection.quit();
  }
}
