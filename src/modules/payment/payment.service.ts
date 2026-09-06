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
  ADMIN_PAYMENT_SUMMARY_SELECT,
  ADMIN_PAYMENT_DETAIL_SELECT,
} from './payment.constants';
import {
  StudentPaymentSummaryDto,
  StudentPaymentDetailDto,
  BankTransferInstructionsDto,
} from './dto/payment.dto';
import {
  AdminPaymentFilterDto,
  RejectPaymentDto,
  PaginatedAdminPaymentsDto,
  AdminPaymentDetailDto,
} from './dto/payment-admin.dto';

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

  async getAdminPayments(
    query: AdminPaymentFilterDto,
  ): Promise<PaginatedAdminPaymentsDto> {
    const where: Prisma.PaymentWhereInput = {};

    if (query.status) {
      where.status = query.status;
    }

    if (query.search && query.search.trim()) {
      const term = query.search.trim();
      where.OR = [
        { transferCode: { contains: term, mode: 'insensitive' } },
        {
          enrollment: {
            user: {
              email: { contains: term, mode: 'insensitive' },
            },
          },
        },
        {
          enrollment: {
            user: {
              profile: {
                fullName: { contains: term, mode: 'insensitive' },
              },
            },
          },
        },
      ];
    }

    const page = query.page && query.page >= 1 ? query.page : 1;
    const limit =
      query.limit && query.limit >= 1 ? Math.min(query.limit, 100) : 10;
    const skip = (page - 1) * limit;

    const [payments, totalItems] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        select: ADMIN_PAYMENT_SUMMARY_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.payment.count({ where }),
    ]);

    const totalPages = Math.ceil(totalItems / limit) || 1;

    return {
      items: payments.map((p) => ({
        id: p.id,
        enrollmentId: p.enrollmentId,
        amountVnd: p.amountVnd,
        transferCode: p.transferCode,
        status: p.status,
        createdAt: p.createdAt,
        reportedAt: p.reportedAt,
        reviewedAt: p.reviewedAt,
        confirmedAt: p.confirmedAt,
        student: {
          id: p.enrollment.user.id,
          email: p.enrollment.user.email,
          fullName: p.enrollment.user.profile?.fullName || '',
        },
        class: {
          id: p.enrollment.class.id,
          name: p.enrollment.class.name,
          tuitionFeeVnd: p.enrollment.class.tuitionFeeVnd,
          course: {
            id: p.enrollment.class.course.id,
            title: p.enrollment.class.course.title,
          },
        },
        reviewedBy: p.reviewedBy
          ? {
              id: p.reviewedBy.id,
              email: p.reviewedBy.email,
              fullName: p.reviewedBy.profile?.fullName || '',
            }
          : null,
      })),
      pagination: {
        page,
        limit,
        totalItems,
        totalPages,
      },
    };
  }

  async getAdminPaymentDetail(
    paymentId: number,
  ): Promise<AdminPaymentDetailDto> {
    return this.formatAdminPaymentDetail(paymentId, this.prisma);
  }

  async rejectPayment(
    paymentId: number,
    adminId: number,
    dto: RejectPaymentDto,
  ): Promise<AdminPaymentDetailDto> {
    return await this.prisma.$transaction(async (tx) => {
      // 1. Parameterized PostgreSQL row lock
      const lockedRows = await tx.$queryRaw<
        Array<{
          id: number;
          status: PaymentStatus;
          reviewedById: number | null;
          reviewedAt: Date | null;
          adminNote: string | null;
        }>
      >`
        SELECT id, status, "reviewedById", "reviewedAt", "adminNote"
        FROM "Payment"
        WHERE id = ${paymentId}
        FOR UPDATE;
      `;

      if (!lockedRows || lockedRows.length === 0) {
        throw new NotFoundException('Thông tin thanh toán không tồn tại');
      }

      const current = lockedRows[0];

      // 2. Idempotency guard: Already REJECTED conflict
      if (current.status === PaymentStatus.REJECTED) {
        throw new ConflictException(
          'Thanh toán này đã bị từ chối trước đó, không thể thay đổi thông tin kiểm tra',
        );
      }

      // 3. Strict state transition: only REPORTED may be rejected
      if (current.status !== PaymentStatus.REPORTED) {
        throw new ConflictException(
          `Chỉ có thể từ chối thanh toán ở trạng thái CHỜ KIỂM TRA (REPORTED). Trạng thái hiện tại: ${current.status}`,
        );
      }

      // 4. Update status and review metadata (financial fields & enrollment unchanged)
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.REJECTED,
          reviewedById: adminId,
          reviewedAt: new Date(),
          adminNote: dto.reason.trim(),
        },
      });

      // 5. Re-read and return updated detail snapshot
      return this.formatAdminPaymentDetail(paymentId, tx);
    });
  }

  private async formatAdminPaymentDetail(
    paymentId: number,
    client: Prisma.TransactionClient | PrismaService,
  ): Promise<AdminPaymentDetailDto> {
    const payment = await client.payment.findUnique({
      where: { id: paymentId },
      select: ADMIN_PAYMENT_DETAIL_SELECT,
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
      updatedAt: payment.updatedAt,
      reportedAt: payment.reportedAt,
      reviewedAt: payment.reviewedAt,
      confirmedAt: payment.confirmedAt,
      adminNote: payment.adminNote,
      student: {
        id: payment.enrollment.user.id,
        email: payment.enrollment.user.email,
        fullName: payment.enrollment.user.profile?.fullName || '',
        phone: payment.enrollment.user.profile?.phone || null,
      },
      enrollment: {
        id: payment.enrollment.id,
        status: payment.enrollment.status,
        joinedAt: payment.enrollment.joinedAt,
      },
      class: {
        id: payment.enrollment.class.id,
        name: payment.enrollment.class.name,
        tuitionFeeVnd: payment.enrollment.class.tuitionFeeVnd,
        course: {
          id: payment.enrollment.class.course.id,
          title: payment.enrollment.class.course.title,
        },
      },
      bankInstructions,
      reviewedBy: payment.reviewedBy
        ? {
            id: payment.reviewedBy.id,
            email: payment.reviewedBy.email,
            fullName: payment.reviewedBy.profile?.fullName || '',
          }
        : null,
    };
  }
}
