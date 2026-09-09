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

  sendRegistrationOtp(to: string, otp: string): Promise<void> {
    return this.send(
      to,
      'BreadTrans - Xác thực đăng ký',
      `<p>Mã OTP của bạn là <strong>${otp}</strong>.</p><p>Mã có hiệu lực trong 5 phút.</p>`,
    );
  }

  sendPaymentActivatedEmail(
    to: string,
    data: {
      studentName: string;
      className: string;
      courseTitle: string;
      transferCode: string;
    },
  ): Promise<void> {
    return this.send(
      to,
      'BreadTrans - Kích hoạt khóa học thành công',
      `<p>Xin chào <strong>${data.studentName || 'Học viên'}</strong>,</p><p>Thanh toán cho lớp <strong>${data.className}</strong> (Khóa học: ${data.courseTitle}) với mã giao dịch <strong>${data.transferCode}</strong> đã được xác nhận và ghi danh của bạn đã được kích hoạt.</p><p>Bạn có thể vào học ngay trên BreadTrans.</p>`,
    );
  }

  sendPaymentPendingActivationEmail(
    to: string,
    data: {
      studentName: string;
      className: string;
      courseTitle: string;
      transferCode: string;
    },
  ): Promise<void> {
    return this.send(
      to,
      'BreadTrans - Thông tin xác nhận thanh toán',
      `<p>Xin chào <strong>${data.studentName || 'Học viên'}</strong>,</p><p>Thanh toán của bạn cho lớp <strong>${data.className}</strong> (Khóa học: ${data.courseTitle}) với mã giao dịch <strong>${data.transferCode}</strong> đã được xác nhận thành công.</p><p>Tuy nhiên, quyền vào lớp hiện đang chờ xử lý bổ sung. Vui lòng liên hệ trung tâm để được hỗ trợ kiểm tra chi tiết.</p>`,
    );
  }

  sendPaymentRejectedEmail(
    to: string,
    data: {
      studentName: string;
      className: string;
      courseTitle: string;
      transferCode: string;
    },
  ): Promise<void> {
    return this.send(
      to,
      'BreadTrans - Thông báo trạng thái thanh toán',
      `<p>Xin chào <strong>${data.studentName || 'Học viên'}</strong>,</p><p>Khoản thanh toán cho lớp <strong>${data.className}</strong> (Khóa học: ${data.courseTitle}) với mã giao dịch <strong>${data.transferCode}</strong> chưa thể đối soát thành công.</p><p>Vui lòng kiểm tra lại thông tin giao dịch hoặc liên hệ BreadTrans để được hỗ trợ.</p>`,
    );
  }
}
