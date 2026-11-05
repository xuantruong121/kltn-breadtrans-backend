import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import { SystemJobsScheduler } from './system-jobs.scheduler';

/**
 * Day and week jobs run at 00:01 Asia/Ho_Chi_Minh, never 00:00, and the
 * startup catch-up keeps to the same minute.
 */
describe('SystemJobsScheduler', () => {
  const cronOf = (method: keyof SystemJobsScheduler) =>
    (
      Reflect.getMetadata(
        SCHEDULE_CRON_OPTIONS,
        SystemJobsScheduler.prototype[method],
      ) as { cronTime: string; timeZone?: string }
    ).cronTime;

  it('runs every day and week job at minute 1 past midnight', () => {
    expect(cronOf('enqueueDailyRollover')).toBe('1 0 * * *');
    expect(cronOf('enqueueWeeklyLeague')).toBe('1 0 * * 1');
    expect(cronOf('enqueueR2Cleanup')).toBe('1 0 * * 0');
  });

  describe('startup catch-up', () => {
    const jobs = () => ({
      enqueueDaily: jest.fn(),
      enqueueWeekly: jest.fn(),
      enqueueDatabaseBackupR2Sync: jest.fn(),
    });
    const startAt = async (iso: string) => {
      jest.useFakeTimers().setSystemTime(new Date(iso));
      const fake = jobs();
      await new SystemJobsScheduler(fake as never).onModuleInit();
      jest.useRealTimers();
      return fake;
    };

    it('leaves the new day and week to the 00:01 cron when started at 00:00:30', async () => {
      // Monday 2026-11-09 00:00:30 in Ho Chi Minh City.
      const fake = await startAt('2026-11-08T17:00:30.000Z');

      expect(fake.enqueueDaily).not.toHaveBeenCalled();
      expect(fake.enqueueWeekly).not.toHaveBeenCalled();
      expect(fake.enqueueDatabaseBackupR2Sync).toHaveBeenCalled();
    });

    it('catches up the day and the league week from 00:01', async () => {
      // Monday 2026-11-09 00:01:30.
      const fake = await startAt('2026-11-08T17:01:30.000Z');

      expect(fake.enqueueDaily).toHaveBeenCalledWith('2026-11-09');
      expect(fake.enqueueWeekly).toHaveBeenCalledWith('2026-W46', true);
    });

    it('checks the league on any day of the week, as a catch-up only', async () => {
      // Thursday 2026-11-05 13:00.
      const fake = await startAt('2026-11-05T06:00:00.000Z');

      expect(fake.enqueueDaily).toHaveBeenCalledWith('2026-11-05');
      expect(fake.enqueueWeekly).toHaveBeenCalledWith('2026-W45', true);
    });
  });
});
