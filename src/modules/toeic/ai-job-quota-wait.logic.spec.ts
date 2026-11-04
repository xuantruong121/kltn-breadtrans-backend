import { MAX_QUOTA_WAITS, quotaWaitResumeAt } from './ai-job-quota-wait.logic';

const now = new Date('2026-11-04T15:22:00.000Z');
const minutes = (n: number) => new Date(now.getTime() + n * 60_000);

describe('quotaWaitResumeAt', () => {
  it('resumes 5 minutes after the earliest recorded reset', () => {
    expect(
      quotaWaitResumeAt({
        isOutage: true,
        spentUntil: [new Date('2026-11-05T00:00:00.000Z'), minutes(60), null],
        waitsSoFar: 0,
        now,
      }),
    ).toEqual(minutes(65));
  });

  it('with no reset known, tries again in 30 minutes', () => {
    expect(
      quotaWaitResumeAt({
        isOutage: true,
        spentUntil: [null],
        waitsSoFar: 1,
        now,
      }),
    ).toEqual(minutes(30));
  });

  it('a reset already past is ignored', () => {
    expect(
      quotaWaitResumeAt({
        isOutage: true,
        spentUntil: [minutes(-10)],
        waitsSoFar: 0,
        now,
      }),
    ).toEqual(minutes(30));
  });

  it('a content error never waits, and after the last wait the job fails', () => {
    expect(
      quotaWaitResumeAt({
        isOutage: false,
        spentUntil: [minutes(60)],
        waitsSoFar: 0,
        now,
      }),
    ).toBeNull();
    expect(
      quotaWaitResumeAt({
        isOutage: true,
        spentUntil: [minutes(60)],
        waitsSoFar: MAX_QUOTA_WAITS,
        now,
      }),
    ).toBeNull();
  });
});
