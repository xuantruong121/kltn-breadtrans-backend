import {
  accountDeletedEmail,
  accountDeletionEmail,
  passwordChangedEmail,
  passwordResetEmail,
  registrationOtpEmail,
  vnClock,
} from './email-templates';

describe('account email templates (owner 2026-11-21)', () => {
  it('password reset: a button to the reset link, how long it lasts, and what to do if it was not you', () => {
    const email = passwordResetEmail(
      'https://app.example.com/reset?token=a&b=1',
    );
    expect(email.subject).toBe('Đặt lại mật khẩu tài khoản BreadTrans');
    expect(email.html).toContain(
      'href="https://app.example.com/reset?token=a&amp;b=1"',
    );
    expect(email.html).toContain('Đặt lại mật khẩu</a>');
    expect(email.html).toContain('15 phút');
    expect(email.html).toContain('mật khẩu hiện tại vẫn giữ nguyên');
  });

  it('sign-up code: the code in a box, its lifetime, and a do-not-share note', () => {
    const email = registrationOtpEmail('482913');
    expect(email.subject).toBe('Mã xác thực đăng ký BreadTrans');
    expect(email.html).toContain('>482913</span>');
    expect(email.html).toContain('5 phút');
    expect(email.html).toContain('đừng chia sẻ mã này');
  });

  it('deletion: the account, the day, how to cancel, and a sign-in button', () => {
    const email = accountDeletionEmail({
      accountEmail: 'a<b>@example.com',
      day: '28/11/2026',
      appUrl: 'https://app.example.com/',
    });
    expect(email.subject).toBe(
      'Yêu cầu xoá tài khoản BreadTrans đã được ghi nhận',
    );
    expect(email.html).toContain('a&lt;b&gt;@example.com');
    expect(email.html).toContain('vào ngày 28/11/2026');
    expect(email.html).toContain('&quot;Huỷ yêu cầu xoá&quot;');
    expect(email.html).toContain('href="https://app.example.com/login"');
  });

  it('writes times in Vietnam time', () => {
    // 13:06Z is 20:06 in Vietnam; 17:30Z is already the next day there.
    expect(vnClock(new Date('2026-11-22T13:06:00Z'))).toBe(
      '20:06 ngày 22/11/2026',
    );
    expect(vnClock(new Date('2026-11-30T17:30:00Z'))).toBe(
      '00:30 ngày 01/12/2026',
    );
  });

  it('password changed: when, which devices were signed out, and a reset button', () => {
    const reset = passwordChangedEmail({
      changedAt: new Date('2026-11-22T13:06:00Z'),
      signedOut: 'all',
      appUrl: 'https://app.example.com/',
    });
    expect(reset.subject).toBe('Mật khẩu tài khoản BreadTrans vừa được đổi');
    expect(reset.html).toContain('vừa được đổi lúc 20:06 ngày 22/11/2026');
    expect(reset.html).toContain('đăng xuất trên mọi thiết bị');
    expect(reset.html).toContain(
      'href="https://app.example.com/forgot-password"',
    );
    expect(reset.html).toContain('Nếu không phải bạn đổi mật khẩu');

    const change = passwordChangedEmail({
      changedAt: new Date('2026-11-22T13:06:00Z'),
      signedOut: 'others',
      appUrl: 'https://app.example.com',
    });
    expect(change.html).toContain('đăng xuất trên các thiết bị khác');
    expect(change.html).not.toContain('mọi thiết bị');
  });

  it('account deleted: the account, the day, and what was kept', () => {
    const email = accountDeletedEmail({
      accountEmail: 'a<b>@example.com',
      // 00:02 on 29/11 in Vietnam.
      deletedAt: new Date('2026-11-28T17:02:00Z'),
    });
    expect(email.subject).toBe('Tài khoản BreadTrans đã được xoá');
    expect(email.html).toContain('a&lt;b&gt;@example.com');
    expect(email.html).toContain('xoá vĩnh viễn ngày 29/11/2026');
    expect(email.html).toContain('dạng ẩn danh');
    // Nothing left to sign in to: no button.
    expect(email.html).not.toContain('<a ');
  });
});
