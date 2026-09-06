import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentStatus, Prisma } from '@prisma/client';
import { getPaymentBankConfig } from '../../common/config/payment-bank.config';
import {
  STUDENT_PAYMENT_SUMMARY_SELECT,
  STUDENT_PAYMENT_DETAIL_SELECT,
} from './payment.constants';
import {
  StudentPaymentSummaryDto,
  StudentPaymentDetailDto,
  BankTransferInstructionsDto,
} from './dto/payment.dto';

export function buildVietQrUrl(params: {
  bin: string;
  accountNumber: string;
  amountVnd: number;
  transferCode: string;
  accountName: string;
}): string {
  const url = new URL(
    `https://img.vietqr.io/image/${params.bin}-${params.accountNumber}-compact2.png`,
  );
  url.searchParams.set('amount', params.amountVnd.toString());
  url.searchParams.set('addInfo', params.transferCode);
  url.searchParams.set('accountName', params.accountName);
  return url.toString();
}

@Injectable()
export class PaymentService {
  constructor(private readonly prisma: PrismaService) {}

  async getMyPayments(studentId: number): Promise<StudentPaymentSummaryDto[]> {
    const payments = await this.prisma.payment.findMany({
      where: {
        enrollment: {
          userId: studentId,
        },
      },
      select: STUDENT_PAYMENT_SUMMARY_SELECT,
      orderBy: { createdAt: 'desc' },
    });

    return payments.map((p) => ({
      id: p.id,
      enrollmentId: p.enrollmentId,
      amountVnd: p.amountVnd,
      transferCode: p.transferCode,
      status: p.status,
      createdAt: p.createdAt,
      reportedAt: p.reportedAt,
      confirmedAt: p.confirmedAt,
      class: {
        id: p.enrollment.class.id,
        name: p.enrollment.class.name,
        course: {
          id: p.enrollment.class.course.id,
          title: p.enrollment.class.course.title,
        },
      },
    }));
  }

  async getPaymentDetailById(
    paymentId: number,
    studentId: number,
  ): Promise<StudentPaymentDetailDto> {
    return this.formatPaymentDetail(paymentId, studentId, this.prisma);
  }

  async reportTransfer(
    paymentId: number,
    studentId: number,
  ): Promise<StudentPaymentDetailDto> {
    return await this.prisma.$transaction(async (tx) => {
      // 1. Lock payment row with parameterized raw query enforcing ownership
      const lockedRows = await tx.$queryRaw<
        Array<{ id: number; status: PaymentStatus; reportedAt: Date | null }>
      >`
        SELECT p.id, p.status, p."reportedAt"
        FROM "Payment" p
        JOIN "Enrollment" e ON p."enrollmentId" = e.id
        WHERE p.id = ${paymentId} AND e."userId" = ${studentId}
        FOR UPDATE OF p;
      `;

      if (!lockedRows || lockedRows.length === 0) {
        throw new NotFoundException('Thông tin thanh toán không tồn tại');
      }

      const current = lockedRows[0];

      // 2. Idempotency branch: Already REPORTED
      if (current.status === PaymentStatus.REPORTED) {
        return this.formatPaymentDetail(paymentId, studentId, tx);
      }

      // 3. Conflict branch: Any non-PENDING status
      if (current.status !== PaymentStatus.PENDING) {
        throw new ConflictException(
          `Không thể báo chuyển khoản cho thanh toán ở trạng thái ${current.status}`,
        );
      }

      // 4. Atomic transition: PENDING -> REPORTED
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.REPORTED,
          reportedAt: new Date(),
        },
      });

      return this.formatPaymentDetail(paymentId, studentId, tx);
    });
  }

  private async formatPaymentDetail(
    paymentId: number,
    studentId: number,
    client: Prisma.TransactionClient | PrismaService,
  ): Promise<StudentPaymentDetailDto> {
    const payment = await client.payment.findFirst({
      where: {
        id: paymentId,
        enrollment: {
          userId: studentId,
        },
      },
      select: STUDENT_PAYMENT_DETAIL_SELECT,
    });

    if (!payment) {
      throw new NotFoundException('Thông tin thanh toán không tồn tại');
    }

    const bankConfig = getPaymentBankConfig();
    const vietQrUrl = buildVietQrUrl({
      bin: bankConfig.bin,
      accountNumber: bankConfig.accountNumber,
      amountVnd: payment.amountVnd,
      transferCode: payment.transferCode,
      accountName: bankConfig.accountName,
    });

    const bankInstructions: BankTransferInstructionsDto = {
      bin: bankConfig.bin,
      bankName: bankConfig.bankName,
      accountNumber: bankConfig.accountNumber,
      accountName: bankConfig.accountName,
      amountVnd: payment.amountVnd,
      transferCode: payment.transferCode,
      vietQrUrl,
    };

    return {
      id: payment.id,
      enrollmentId: payment.enrollmentId,
      amountVnd: payment.amountVnd,
      transferCode: payment.transferCode,
      status: payment.status,
      createdAt: payment.createdAt,
      reportedAt: payment.reportedAt,
      confirmedAt: payment.confirmedAt,
      updatedAt: payment.updatedAt,
      class: {
        id: payment.enrollment.class.id,
        name: payment.enrollment.class.name,
        course: {
          id: payment.enrollment.class.course.id,
          title: payment.enrollment.class.course.title,
        },
      },
      bankInstructions,
    };
  }
}
