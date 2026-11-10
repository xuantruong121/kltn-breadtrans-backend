import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { OnEvent } from '@nestjs/event-emitter';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { LearnerProgressService } from '../learning-path/learner-progress.service';
import { GamificationListener } from './gamification.listener';
import { getTodayDateKey } from './gamification.service';

export const LEARNING_EFFECTS_QUEUE = 'breadtrans-learning-effects';
/** Submissions whose rewards are worked on at once; the rest wait their turn. */
export const LEARNING_EFFECTS_CONCURRENCY = 2;
const ENQUEUE_TIMEOUT_MS = 2_000;

export type QuizSubmittedPayload = Parameters<
  GamificationListener['handleQuizSubmittedEvent']
>[0] &
  Parameters<LearnerProgressService['onQuizSubmitted']>[0];

/**
 * What a submission sets off — XP, pet, Bánh Mì, badges, daily quests, skill
 * level — runs from a queue, at most two submissions at a time, instead of
 * all at once in the request's process. It costs 75-100 ms of CPU per
 * submission; when 1000 learners submitted within 30 s, running it all
 * immediately slowed every request to 12 s (capacity run 2026-11-09). Now a
 * rush waits in the queue and rewards arrive a little later.
 *
 * One attempt per job, as before: daily quest progress is a counter, so a
 * retried job would count twice. The quest day is the day the learner
 * submitted, even if the job runs after midnight. If the queue cannot be
 * reached the effects run at once, as before. LEARNING_EFFECTS_MODE=inline
 * (the default under NODE_ENV=test) always runs them at once.
 */
@Injectable()
export class LearningEffectsQueueService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(LearningEffectsQueueService.name);
  private queue?: Queue<QuizSubmittedPayload>;
  private worker?: Worker<QuizSubmittedPayload>;
  private queueConnection?: IORedis;
  private workerConnection?: IORedis;

  constructor(
    private readonly listener: GamificationListener,
    private readonly moduleRef: ModuleRef,
  ) {}

  static mode(): 'queue' | 'inline' {
    const set = process.env.LEARNING_EFFECTS_MODE;
    if (set === 'inline' || set === 'queue') return set;
    return process.env.NODE_ENV === 'test' ? 'inline' : 'queue';
  }

  onModuleInit(): void {
    if (LearningEffectsQueueService.mode() === 'inline') return;
    // Only the API runs the queue. The speaking worker process loads this
    // module too, but has no skill-progress service and never submits quizzes.
    if (!this.progress()) return;
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    this.queueConnection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    this.workerConnection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    this.queue = new Queue<QuizSubmittedPayload>(LEARNING_EFFECTS_QUEUE, {
      connection: this.queueConnection,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { age: 86400, count: 1000 },
        removeOnFail: { age: 7 * 86400, count: 1000 },
      },
    });
    this.worker = new Worker<QuizSubmittedPayload>(
      LEARNING_EFFECTS_QUEUE,
      async (job) => this.run(job.data),
      {
        connection: this.workerConnection,
        concurrency: LEARNING_EFFECTS_CONCURRENCY,
      },
    );
    this.worker.on('failed', (job, error) =>
      this.logger.error(
        `Learning effects failed for user ${job?.data.userId} (submission ${job?.data.submissionId}): ${error.message}`,
      ),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    await this.workerConnection?.quit();
    await this.queueConnection?.quit();
  }

  @OnEvent('quiz.submitted')
  async onQuizSubmitted(payload: QuizSubmittedPayload): Promise<void> {
    const job = {
      ...payload,
      dateKey: payload.dateKey ?? getTodayDateKey('Asia/Ho_Chi_Minh'),
    };
    if (this.queue) {
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          this.queue.add('quiz.submitted', job),
          new Promise((_, fail) => {
            timer = setTimeout(
              () => fail(new Error('enqueue timed out')),
              ENQUEUE_TIMEOUT_MS,
            );
          }),
        ]);
        return;
      } catch (error) {
        this.logger.warn(
          `Learning effects queue unavailable (${error instanceof Error ? error.message : String(error)}); running them now`,
        );
      } finally {
        clearTimeout(timer);
      }
    }
    await this.run(job);
  }

  private progress(): LearnerProgressService | null {
    try {
      return this.moduleRef.get(LearnerProgressService, { strict: false });
    } catch {
      return null;
    }
  }

  /** Both effects; one failing does not stop the other. */
  async run(payload: QuizSubmittedPayload): Promise<void> {
    try {
      await this.listener.handleQuizSubmittedEvent(payload);
    } catch (error) {
      this.logger.error(
        `Rewards failed for user ${payload.userId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    try {
      await this.progress()?.onQuizSubmitted(payload);
    } catch (error) {
      this.logger.error(
        `Skill progress failed for user ${payload.userId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
