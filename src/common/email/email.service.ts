import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: nodemailer.Transporter | null;

  constructor() {
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT || 587);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASSWORD;
    this.transporter =
      host && user && pass
        ? nodemailer.createTransport({
            host,
            port,
            secure: port === 465,
            auth: { user, pass },
          })
        : null;
  }

  private async send(to: string, subject: string, html: string): Promise<void> {
    const from = process.env.SMTP_FROM || process.env.SMTP_USER;
    if (!this.transporter || !from) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('SMTP is not configured');
      }
      this.logger.debug(
        `Email suppressed in non-production environment: ${subject} -> ${to}`,
      );
      return;
    }
    await this.transporter.sendMail({ from, to, subject, html });
  }

  /** Reminder that a paid plan is about to end; the HTML is escaped by the caller. */
  sendPlanExpiryReminder(
    to: string,
    subject: string,
    html: string,
  ): Promise<void> {
    return this.send(to, subject, html);
  }

  sendRegistrationOtp(to: string, otp: string): Promise<void> {
    return this.send(
      to,
      'BreadTrans - Xác thực đăng ký',
      `<p>Mã OTP của bạn là <strong>${otp}</strong>.</p><p>Mã có hiệu lực trong 5 phút.</p>`,
    );
  }

  sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
    if (
      !this.transporter ||
      !(process.env.SMTP_FROM || process.env.SMTP_USER)
    ) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('SMTP is not configured');
      }
      this.logger.debug(
        `[DEV MODE ONLY] Password reset URL for ${to}: ${resetUrl}`,
      );
      return Promise.resolve();
    }

    return this.send(
      to,
      'BreadTrans - Đặt lại mật khẩu',
      `<p>Bạn vừa yêu cầu đặt lại mật khẩu BreadTrans.</p><p><a href="${resetUrl}">Đặt lại mật khẩu</a></p><p>Liên kết có hiệu lực trong 15 phút và chỉ sử dụng được một lần.</p><p>Nếu bạn không yêu cầu, hãy bỏ qua email này.</p>`,
    );
  }
}
