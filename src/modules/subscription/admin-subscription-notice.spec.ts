import {
  extendedNotice,
  grantedNotice,
  noticePlanName,
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

  it('names the plan, not the version label that carries a default length', () => {
    // A 1-day grant read "Bạn được tặng gói BreadTrans Pro — 30 ngày" (20/11).
    const name = noticePlanName({
      planVersion: { plan: { displayName: 'BreadTrans Pro' } },
    });
    expect(name).toBe('BreadTrans Pro');
    expect(grantedNotice(name, endsAt).title).toBe(
      'Bạn được tặng gói BreadTrans Pro',
    );
  });

  it('names the plan and never exposes the admin reason', () => {
    const notice = revokedNotice('Pro');
    expect(notice.title).toBe('Gói Pro đã bị thu hồi');
    expect(notice.type).toBe('SUBSCRIPTION_REVOKED');
  });
});
