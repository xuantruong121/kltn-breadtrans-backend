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
import { missedTimedJobs } from './timed-catch-up.logic';

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
      // A host that was off at 09:00 or at Monday 08:00 still sends the plan
      // reminder and the weekly report (owner 2026-11-20). Same keys as the
      // cron, and both jobs skip a learner who already has the notice.
      const missed = missedTimedJobs(now);
      if (missed.planExpiryDayKey)
        await this.jobs.enqueuePlanExpiryReminder(missed.planExpiryDayKey);
      if (missed.weeklyReportDayKey)
        await this.jobs.enqueueWeeklyReport(missed.weeklyReportDayKey);
      await this.jobs.enqueueDatabaseBackupR2Sync();
      // Account purge has no fixed minute to wait for: catch the day up. Its
      // own key, so a start before 02:30 does not swallow the 02:30 run.
      await this.jobs.enqueueAccountPurge(`start-${dayKey}`);
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

  // Accounts whose 7-day deletion grace period ended (owner 2026-11-16).
  @Cron('30 2 * * *', { timeZone: BUSINESS_TIMEZONE })
  async enqueueAccountPurge(): Promise<void> {
    await this.jobs.enqueueAccountPurge(getBusinessDayKey(new Date()));
  }

  // Daily off-site copy (owner 2026-11-16: daily, not hourly), two minutes
  // after the 00:00 dump; the dump takes a few seconds.
  @Cron('2 0 * * *', { timeZone: BUSINESS_TIMEZONE })
  async enqueueDatabaseBackupR2Sync(): Promise<void> {
    await this.jobs.enqueueDatabaseBackupR2Sync(
      `day-${getBusinessDayKey(new Date())}`,
    );
  }

  // A dump made after a cold start (machine off at midnight) should not wait
  // a day for R2. Local check only; R2 is called only when a file is new.
  @Cron('20 * * * *', { timeZone: BUSINESS_TIMEZONE })
  async enqueuePendingDatabaseBackupR2Sync(): Promise<void> {
    const now = new Date();
    await this.jobs.enqueueDatabaseBackupR2SyncIfPending(
      `pending-${getBusinessDayKey(now)}-${Math.floor(now.getTime() / 3_600_000)}`,
    );
  }
}
