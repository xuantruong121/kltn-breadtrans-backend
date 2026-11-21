import {
  accountDeletionEmail,
  passwordResetEmail,
  registrationOtpEmail,
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
});
