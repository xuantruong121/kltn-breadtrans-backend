import {
  buildDashboardBuckets,
  normalizeDashboardRange,
} from './admin.service';

describe('dashboard range helpers', () => {
  const now = new Date(2026, 9, 21, 12, 0, 0);

  it('uses the established six-month view for an absent or unsupported range', () => {
    expect(normalizeDashboardRange()).toBe('6m');
    expect(normalizeDashboardRange('unsupported')).toBe('6m');
  });

  it('builds one complete bucket for each of the last 30 days', () => {
    const buckets = buildDashboardBuckets('30d', now);

    expect(buckets).toHaveLength(30);
    expect(buckets[0].start).toEqual(new Date(2026, 8, 22, 0, 0, 0, 0));
    expect(buckets.at(-1)?.end).toEqual(new Date(2026, 9, 21, 23, 59, 59, 999));
  });

  it('builds six or twelve complete month buckets in chronological order', () => {
    const sixMonths = buildDashboardBuckets('6m', now);
    const twelveMonths = buildDashboardBuckets('12m', now);

    expect(sixMonths).toHaveLength(6);
    expect(sixMonths[0].label).toBe('T5');
    expect(sixMonths.at(-1)?.label).toBe('T10');
    expect(twelveMonths).toHaveLength(12);
    expect(twelveMonths[0].label).toBe('T11');
    expect(twelveMonths.at(-1)?.label).toBe('T10');
  });
});
