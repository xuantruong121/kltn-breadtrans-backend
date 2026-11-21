import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

import {
  isSkippedRecipient,
  parseSkipDomains,
  recipientDomain,
} from './email-recipient.logic';
import {
  type RenderedEmail,
  passwordResetEmail,
  registrationOtpEmail,
} from './email-templates';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: nodemailer.Transporter | null;
  /** EMAIL_SKIP_DOMAINS: test domains nobody owns; mail there only bounces. */
  private readonly skipDomains = parseSkipDomains(
    process.env.EMAIL_SKIP_DOMAINS,
  );

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
    if (isSkippedRecipient(to, this.skipDomains)) {
      // The in-app notification is still created by the caller; only the mail is dropped.
      this.logger.log(
        `email_skipped_test_domain domain=${recipientDomain(to)} subject="${subject}"`,
      );
      return;
    }
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

  /** The account will be deleted on a date; signing in before it cancels (accountDeletionEmail). */
  sendAccountDeletionScheduled(
    to: string,
    email: RenderedEmail,
  ): Promise<void> {
    return this.send(to, email.subject, email.html);
  }

  /** A personal win-back discount, a few days after a paid plan ended. */
  sendWinbackOffer(to: string, subject: string, html: string): Promise<void> {
    return this.send(to, subject, html);
  }

  sendRegistrationOtp(to: string, otp: string): Promise<void> {
    const email = registrationOtpEmail(otp);
    return this.send(to, email.subject, email.html);
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

    const email = passwordResetEmail(resetUrl);
    return this.send(to, email.subject, email.html);
  }
}
