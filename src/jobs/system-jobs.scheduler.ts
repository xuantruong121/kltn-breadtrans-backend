import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  BUSINESS_TIMEZONE,
  getBusinessDayKey,
  getBusinessDayStart,
  getBusinessFiveMinuteKey,
  getBusinessWeekKey,
  getBusinessWeekStart,
  isPastBusinessRollover,
} from '../common/time/business-time.util';
import { SystemJobsService } from './system-jobs.service';

@Injectable()
export class SystemJobsScheduler implements OnModuleInit {
  private readonly logger = new Logger(SystemJobsScheduler.name);

  constructor(private readonly jobs: SystemJobsService) {}

  async onModuleInit(): Promise<void> {
    // Catch up only the current logical period; deterministic job IDs make
    // this safe. Day and week jobs run at 00:01, never 00:00: before 00:01 the
    // catch-up waits for the cron. The weekly league catches up on any day of
    // the week, so a backend that was off on Monday still resets it once.
    try {
      const now = new Date();
      const dayKey = getBusinessDayKey(now);
      if (isPastBusinessRollover(getBusinessDayStart(dayKey), now)) {
        await this.jobs.enqueueDaily(dayKey);
      }
      if (isPastBusinessRollover(getBusinessWeekStart(now), now)) {
        await this.jobs.enqueueWeekly(getBusinessWeekKey(now), true);
      }
      await this.jobs.enqueueDatabaseBackupR2Sync();
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

  // Monday 00:01: the league week runs Monday to Sunday.
  @Cron('1 0 * * 1', { timeZone: BUSINESS_TIMEZONE })
  async enqueueWeeklyLeague(): Promise<void> {
    await this.jobs.enqueueWeekly(getBusinessWeekKey());
  }

  @Cron('0 9 * * *', { timeZone: BUSINESS_TIMEZONE })
  async enqueuePlanExpiryReminder(): Promise<void> {
    await this.jobs.enqueuePlanExpiryReminder(getBusinessDayKey());
  }

  @Cron('0 8 * * 1', { timeZone: BUSINESS_TIMEZONE })
  async enqueueWeeklyReport(): Promise<void> {
    await this.jobs.enqueueWeeklyReport(getBusinessDayKey());
  }

  @Cron('30 9 * * *', { timeZone: BUSINESS_TIMEZONE })
  async enqueueWinback(): Promise<void> {
    await this.jobs.enqueueWinback(getBusinessDayKey());
  }

  // Every hour: each learner is reminded at the hour they usually study
  // (20:00 without a habit). This replaced the fixed 20:00 streak reminder.
  @Cron('0 * * * *', { timeZone: BUSINESS_TIMEZONE })
  async enqueueStudyReminder(): Promise<void> {
    const now = new Date();
    await this.jobs.enqueueStudyReminder(
      `${getBusinessDayKey(now)}-${Math.floor(now.getTime() / 3_600_000)}`,
    );
  }

  @Cron('*/5 * * * *', { timeZone: BUSINESS_TIMEZONE })
  async enqueueVocabularyReview(): Promise<void> {
    await this.jobs.enqueueVocabularyReview(getBusinessFiveMinuteKey());
  }

  @Cron('*/5 * * * *', { timeZone: BUSINESS_TIMEZONE })
  async enqueueExamWritingGrading(): Promise<void> {
    await this.jobs.enqueueExamWritingGrading(getBusinessFiveMinuteKey());
  }

  @Cron('1 0 * * 0', { timeZone: BUSINESS_TIMEZONE })
  async enqueueR2Cleanup(): Promise<void> {
    await this.jobs.enqueueR2Cleanup(getBusinessWeekKey());
  }

  @Cron('15 * * * *', { timeZone: BUSINESS_TIMEZONE })
  async enqueueDatabaseBackupR2Sync(): Promise<void> {
    await this.jobs.enqueueDatabaseBackupR2Sync();
  }
}
