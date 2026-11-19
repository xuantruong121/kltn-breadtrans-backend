import * as nodemailer from 'nodemailer';

import { EmailService } from './email.service';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

describe('EmailService test domains', () => {
  const sendMail = jest.fn().mockResolvedValue({});
  const saved = { ...process.env };

  beforeEach(() => {
    sendMail.mockClear();
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
    process.env.SMTP_HOST = 'smtp.example.net';
    process.env.SMTP_USER = 'sender@gmail.com';
    process.env.SMTP_PASSWORD = 'x';
    process.env.EMAIL_SKIP_DOMAINS = 'breadtrans.com';
  });
  afterAll(() => {
    process.env = saved;
  });

  it('does not send to a test domain, so no bounce comes back', async () => {
    await new EmailService().sendPlanExpiryReminder(
      'student3@breadtrans.com',
      'Gói Plus còn 3 ngày',
      '<p>x</p>',
    );
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('still sends to a real address', async () => {
    await new EmailService().sendPlanExpiryReminder(
      'learner@gmail.com',
      'Gói Plus còn 3 ngày',
      '<p>x</p>',
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'learner@gmail.com' }),
    );
  });

  it('skips a test domain on the password reset path too', async () => {
    await new EmailService().sendPasswordResetEmail(
      'student1@breadtrans.com',
      'https://x/reset',
    );
    expect(sendMail).not.toHaveBeenCalled();
  });
});
