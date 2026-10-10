import {
  isLegacyCoursePaymentConfirmable,
  LEGACY_COURSE_PAYMENT_CONFIRM_GRACE_HOURS,
} from './payment.service';

describe('legacy Course payment expiry policy', () => {
  const createdAt = new Date('2026-10-09T00:00:00.000Z');

  it('uses a 24-hour server-side window', () => {
    expect(LEGACY_COURSE_PAYMENT_CONFIRM_GRACE_HOURS).toBe(24);
    expect(
      isLegacyCoursePaymentConfirmable(
        createdAt,
        new Date('2026-10-09T23:59:00.000Z'),
      ),
    ).toBe(true);
  });

  it('keeps the exact 24-hour boundary eligible', () => {
    expect(
      isLegacyCoursePaymentConfirmable(
        createdAt,
        new Date('2026-10-10T00:00:00.000Z'),
      ),
    ).toBe(true);
  });

  it('rejects one millisecond beyond the 24-hour boundary', () => {
    expect(
      isLegacyCoursePaymentConfirmable(
        createdAt,
        new Date('2026-10-10T00:00:00.001Z'),
      ),
    ).toBe(false);
  });

  it('rejects a clearly stale payment and invalid dates', () => {
    expect(
      isLegacyCoursePaymentConfirmable(
        createdAt,
        new Date('2026-11-08T00:00:00.000Z'),
      ),
    ).toBe(false);
    expect(
      isLegacyCoursePaymentConfirmable(new Date('invalid'), new Date()),
    ).toBe(false);
  });
});
