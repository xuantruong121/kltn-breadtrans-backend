import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import { CronTime } from 'cron';
import { SystemJobsScheduler } from '../../jobs/system-jobs.scheduler';
import { PaymentReconciliationScheduler } from '../../modules/subscription/payment-reconciliation.scheduler';
import { StalePurchaseScheduler } from '../../modules/subscription/stale-purchase.scheduler';
import { BUSINESS_TIMEZONE } from './business-time.util';

/**
 * Nothing runs at 00:00 Asia/Ho_Chi_Minh (owner 2026-11-27). A job that
 * repeats through the day keeps its rhythm and moves its 00:00 run to 00:02.
 */
type CronOptions = { cronTime: string; timeZone?: string };
type SchedulerClass = { prototype: object; name: string };

const SCHEDULERS: SchedulerClass[] = [
  SystemJobsScheduler,
  PaymentReconciliationScheduler,
  StalePurchaseScheduler,
];

function cronMethods(cls: SchedulerClass) {
  const proto = cls.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => typeof proto[name] === 'function')
    .map((name) => ({
      name,
      options: Reflect.getMetadata(
        SCHEDULE_CRON_OPTIONS,
        proto[name] as object,
      ) as CronOptions | undefined,
    }))
    .filter((m): m is { name: string; options: CronOptions } =>
      Boolean(m.options),
    );
}

/** Local "HH:mm" of every run in the next 24 hours, for one or more schedules. */
function runsInADay(...expressions: string[]): Set<string> {
  const out = new Set<string>();
  for (const expression of expressions) {
    const runs = new CronTime(expression, BUSINESS_TIMEZONE).sendAt(400);
    const first = runs[0].toMillis();
    for (const run of runs) {
      if (run.toMillis() - first >= 86_400_000) break;
      out.add(run.setZone(BUSINESS_TIMEZONE).toFormat('HH:mm'));
    }
  }
  return out;
}

const cronOf = (cls: SchedulerClass, method: string) =>
  cronMethods(cls).find((m) => m.name === method)!.options.cronTime;

describe('no scheduled job runs at 00:00 (owner 2026-11-27)', () => {
  it.each(SCHEDULERS.map((cls) => [cls.name, cls] as const))(
    '%s: every @Cron is on business time and never fires at 00:00',
    (_name, cls) => {
      const methods = cronMethods(cls);
      expect(methods.length).toBeGreaterThan(0);
      for (const { name, options } of methods) {
        expect({ name, timeZone: options.timeZone }).toEqual({
          name,
          timeZone: BUSINESS_TIMEZONE,
        });
        expect({
          name,
          midnight: runsInADay(options.cronTime).has('00:00'),
        }).toEqual({
          name,
          midnight: false,
        });
      }
    },
  );

  it('keeps the hourly study reminder at every hour, 00:00 moved to 00:02', () => {
    const runs = runsInADay(
      cronOf(SystemJobsScheduler, 'enqueueStudyReminder'),
      cronOf(SystemJobsScheduler, 'enqueueStudyReminderAfterMidnight'),
    );
    const expected = new Set(['00:02']);
    for (let h = 1; h < 24; h++)
      expected.add(`${String(h).padStart(2, '0')}:00`);
    expect(runs).toEqual(expected);
  });

  it.each([
    [SystemJobsScheduler, 'enqueueVocabularyReview'],
    [SystemJobsScheduler, 'enqueueExamWritingGrading'],
    [PaymentReconciliationScheduler, 'reconcileRecentTransactions'],
    [StalePurchaseScheduler, 'sweep'],
  ] as const)(
    '%p.%s keeps every five minutes, 00:00 moved to 00:02',
    (cls, method) => {
      const runs = runsInADay(
        cronOf(cls, method),
        cronOf(cls, `${method}AfterMidnight`),
      );
      const expected = new Set<string>();
      for (let m = 0; m < 24 * 60; m += 5) {
        expected.add(
          `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`,
        );
      }
      expected.delete('00:00');
      expected.add('00:02');
      expect(runs).toEqual(expected);
    },
  );
});
