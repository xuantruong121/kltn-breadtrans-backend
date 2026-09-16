import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  BUSINESS_TIMEZONE,
  getBusinessDayKey,
  getBusinessFiveMinuteKey,
  getBusinessWeekday,
  getBusinessWeekKey,
} from '../common/time/business-time.util';
import { SystemJobsService } from './system-jobs.service';

@Injectable()
export class SystemJobsScheduler implements OnModuleInit {
  private readonly logger = new Logger(SystemJobsScheduler.name);

  constructor(private readonly jobs: SystemJobsService) {}

  async onModuleInit(): Promise<void> {
    // Catch up only the current logical period; deterministic job IDs make this safe.
    try {
      await this.jobs.enqueueDaily(getBusinessDayKey());
      if (getBusinessWeekday() === 0) {
        await this.jobs.enqueueWeekly(getBusinessWeekKey());
      }
    } catch (error) {
      this.logger.warn(
        `system_job_startup_recovery_unavailable: ${(error as Error).message}`,
      );
    }
  }

  @Cron('1 0 * * *', { timeZone: BUSINESS_TIMEZONE })
  async enqueueDailyRollover(): Promise<void> {
    await this.jobs.enqueueDaily(getBusinessDayKey());
  }

  @Cron('0 0 * * 0', { timeZone: BUSINESS_TIMEZONE })
  async enqueueWeeklyLeague(): Promise<void> {
    await this.jobs.enqueueWeekly(getBusinessWeekKey());
  }

  @Cron('0 20 * * *', { timeZone: BUSINESS_TIMEZONE })
  async enqueueStreakReminder(): Promise<void> {
    await this.jobs.enqueueStreakReminder(getBusinessDayKey());
  }

  @Cron('*/5 * * * *', { timeZone: BUSINESS_TIMEZONE })
  async enqueueVocabularyReview(): Promise<void> {
    await this.jobs.enqueueVocabularyReview(getBusinessFiveMinuteKey());
  }

  @Cron('0 0 * * 0', { timeZone: BUSINESS_TIMEZONE })
  async enqueueR2Cleanup(): Promise<void> {
    await this.jobs.enqueueR2Cleanup(getBusinessWeekKey());
  }
}
