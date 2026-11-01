import {
  extendedNotice,
  grantedNotice,
  revokedNotice,
} from './admin-subscription-notice';

describe('admin subscription notices', () => {
  const endsAt = new Date('2026-12-01T17:30:00.000Z');

  it('states the end date in Vietnam time', () => {
    expect(grantedNotice('Plus', endsAt).body).toBe(
      'Gói có hiệu lực đến 2/12/2026.',
    );
    expect(extendedNotice('Plus', endsAt).body).toBe(
      'Gói có hiệu lực đến 2/12/2026.',
    );
  });

  it('names the plan and never exposes the admin reason', () => {
    const notice = revokedNotice('Pro');
    expect(notice.title).toBe('Gói Pro đã bị thu hồi');
    expect(notice.type).toBe('SUBSCRIPTION_REVOKED');
  });
});
