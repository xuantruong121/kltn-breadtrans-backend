import { extendDoubleBanhUntil } from './market-effects';

describe('extendDoubleBanhUntil', () => {
  const now = new Date('2026-10-26T08:00:00Z');
  const hours = (d: Date) => (d.getTime() - now.getTime()) / 3_600_000;

  it('one card lasts 24 hours, as the product name says', () => {
    expect(hours(extendDoubleBanhUntil(null, 1, now))).toBe(24);
  });

  it('two cards last 48 hours', () => {
    expect(hours(extendDoubleBanhUntil(null, 2, now))).toBe(48);
  });

  it('extends a running boost instead of resetting it', () => {
    const running = new Date(now.getTime() + 10 * 3_600_000);
    expect(hours(extendDoubleBanhUntil(running, 1, now))).toBe(34);
  });

  it('starts from now when the previous boost has expired', () => {
    const expired = new Date(now.getTime() - 5 * 3_600_000);
    expect(hours(extendDoubleBanhUntil(expired, 1, now))).toBe(24);
  });
});
