import {
  Injectable,
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ClassStatus,
  EnrollmentStatus,
  PaymentActivationIssue,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
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
        activationIssue: p.activationIssue,
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

  async confirmPayment(
    paymentId: number,
    adminId: number,
  ): Promise<AdminPaymentDetailDto> {
    // 1. Preliminary non-locking lookup for routing identity only
    const preliminary = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        enrollmentId: true,
        enrollment: {
          select: {
            id: true,
            classId: true,
          },
        },
      },
    });

    if (!preliminary || !preliminary.enrollment) {
      throw new NotFoundException('Thông tin thanh toán không tồn tại');
    }

    const preliminaryClassId = preliminary.enrollment.classId;

    // 2. Interactive transaction with strict lock order: Class -> Payment -> Enrollment
    return await this.prisma.$transaction(async (tx) => {
      // Step 1: Lock Class FOR UPDATE
      const lockedClasses = await tx.$queryRaw<
        Array<{
          id: number;
          status: ClassStatus;
          capacity: number | null;
        }>
      >`
        SELECT id, status, capacity
        FROM "Class"
        WHERE id = ${preliminaryClassId}
        FOR UPDATE;
      `;

      if (!lockedClasses || lockedClasses.length === 0) {
        throw new NotFoundException('Lớp học không tồn tại');
      }
      const lockedClass = lockedClasses[0];

      // Step 2: Lock Payment FOR UPDATE
      const lockedPayments = await tx.$queryRaw<
        Array<{
          id: number;
          status: PaymentStatus;
          enrollmentId: number;
          confirmedAt: Date | null;
          reviewedAt: Date | null;
          reviewedById: number | null;
          activationIssue: PaymentActivationIssue | null;
        }>
      >`
        SELECT id, status, "enrollmentId", "confirmedAt", "reviewedAt", "reviewedById", "activationIssue"
        FROM "Payment"
        WHERE id = ${paymentId}
        FOR UPDATE;
      `;

      if (!lockedPayments || lockedPayments.length === 0) {
        throw new NotFoundException('Thông tin thanh toán không tồn tại');
      }
      const lockedPayment = lockedPayments[0];

      // Step 3: Lock Enrollment FOR UPDATE
      const lockedEnrollments = await tx.$queryRaw<
        Array<{
          id: number;
          status: EnrollmentStatus;
          classId: number;
        }>
      >`
        SELECT id, status, "classId"
        FROM "Enrollment"
        WHERE id = ${lockedPayment.enrollmentId}
        FOR UPDATE;
      `;

      if (!lockedEnrollments || lockedEnrollments.length === 0) {
        throw new NotFoundException('Thông tin ghi danh không tồn tại');
      }
      const lockedEnrollment = lockedEnrollments[0];

      // Step 4: Relationship Revalidation
      if (
        lockedPayment.enrollmentId !== lockedEnrollment.id ||
        lockedEnrollment.classId !== lockedClass.id ||
        lockedClass.id !== preliminaryClassId
      ) {
        throw new UnprocessableEntityException(
          'Dữ liệu thanh toán, ghi danh và lớp học không đồng nhất',
        );
      }

      // Step 5: Idempotency check: Already CONFIRMED returns existing state without mutation or retry
      if (lockedPayment.status === PaymentStatus.CONFIRMED) {
        return this.formatAdminPaymentDetail(paymentId, tx);
      }

      // Step 6: Strict state machine check: First confirmation allowed ONLY from REPORTED
      if (lockedPayment.status !== PaymentStatus.REPORTED) {
        throw new ConflictException(
          `Chỉ có thể xác nhận thanh toán ở trạng thái CHỜ KIỂM TRA (REPORTED). Trạng thái hiện tại: ${lockedPayment.status}`,
        );
      }

      // Step 7: Required First-Confirm Invariant: Enrollment MUST be PENDING_PAYMENT
      if (lockedEnrollment.status !== EnrollmentStatus.PENDING_PAYMENT) {
        throw new UnprocessableEntityException(
          `Ghi danh liên kết không ở trạng thái chờ thanh toán (PENDING_PAYMENT). Trạng thái hiện tại: ${lockedEnrollment.status}`,
        );
      }

      // Step 8: Single server timestamp & Decision logic
      const now = new Date();

      if (lockedClass.status === ClassStatus.UPCOMING) {
        // Count ONLY ACTIVE Enrollments while Class lock is held
        const activeCount = await tx.enrollment.count({
          where: {
            classId: lockedClass.id,
            status: EnrollmentStatus.ACTIVE,
          },
        });

        if (
          lockedClass.capacity === null ||
          activeCount < lockedClass.capacity
        ) {
          // Case A: Eligible + Capacity available -> Activate Enrollment & Confirm Payment
          await tx.enrollment.update({
            where: { id: lockedEnrollment.id },
            data: { status: EnrollmentStatus.ACTIVE },
          });

          await tx.payment.update({
            where: { id: paymentId },
            data: {
              status: PaymentStatus.CONFIRMED,
              confirmedAt: now,
              reviewedAt: now,
              reviewedById: adminId,
              activationIssue: null,
            },
          });
        } else {
          // Case B: UPCOMING but Full Capacity -> Payment CONFIRMED, CLASS_FULL, Enrollment remains PENDING_PAYMENT
          await tx.payment.update({
            where: { id: paymentId },
            data: {
              status: PaymentStatus.CONFIRMED,
              confirmedAt: now,
              reviewedAt: now,
              reviewedById: adminId,
              activationIssue: PaymentActivationIssue.CLASS_FULL,
            },
          });
        }
      } else {
        // Case C: Ineligible Class (ONGOING, COMPLETED, CANCELLED) -> Payment CONFIRMED, CLASS_NOT_ELIGIBLE, Enrollment remains PENDING_PAYMENT
        await tx.payment.update({
          where: { id: paymentId },
          data: {
            status: PaymentStatus.CONFIRMED,
            confirmedAt: now,
            reviewedAt: now,
            reviewedById: adminId,
            activationIssue: PaymentActivationIssue.CLASS_NOT_ELIGIBLE,
          },
        });
      }

      // Re-read and return authoritative snapshot
      return this.formatAdminPaymentDetail(paymentId, tx);
    });
  }

  async retryActivation(paymentId: number): Promise<AdminPaymentDetailDto> {
    // 1. Non-locking preliminary lookup to discover classId
    const preliminary = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        enrollmentId: true,
        enrollment: {
          select: {
            id: true,
            classId: true,
          },
        },
      },
    });

    if (!preliminary || !preliminary.enrollment) {
      throw new NotFoundException('Thông tin thanh toán không tồn tại');
    }

    const preliminaryClassId = preliminary.enrollment.classId;

    // 2. Interactive transaction with strict lock order: Class -> Payment -> Enrollment
    return await this.prisma.$transaction(async (tx) => {
      // Step 1: Lock Class FOR UPDATE
      const lockedClasses = await tx.$queryRaw<
        Array<{
          id: number;
          status: ClassStatus;
          capacity: number | null;
        }>
      >`
        SELECT id, status, capacity
        FROM "Class"
        WHERE id = ${preliminaryClassId}
        FOR UPDATE;
      `;

      if (!lockedClasses || lockedClasses.length === 0) {
        throw new NotFoundException('Lớp học không tồn tại');
      }
      const lockedClass = lockedClasses[0];

      // Step 2: Lock Payment FOR UPDATE
      const lockedPayments = await tx.$queryRaw<
        Array<{
          id: number;
          status: PaymentStatus;
          enrollmentId: number;
          activationIssue: PaymentActivationIssue | null;
        }>
      >`
        SELECT id, status, "enrollmentId", "activationIssue"
        FROM "Payment"
        WHERE id = ${paymentId}
        FOR UPDATE;
      `;

      if (!lockedPayments || lockedPayments.length === 0) {
        throw new NotFoundException('Thông tin thanh toán không tồn tại');
      }
      const lockedPayment = lockedPayments[0];

      // Step 3: Lock Enrollment FOR UPDATE
      const lockedEnrollments = await tx.$queryRaw<
        Array<{
          id: number;
          status: EnrollmentStatus;
          classId: number;
        }>
      >`
        SELECT id, status, "classId"
        FROM "Enrollment"
        WHERE id = ${lockedPayment.enrollmentId}
        FOR UPDATE;
      `;

      if (!lockedEnrollments || lockedEnrollments.length === 0) {
        throw new NotFoundException('Thông tin ghi danh không tồn tại');
      }
      const lockedEnrollment = lockedEnrollments[0];

      // Step 4: Relationship Revalidation
      if (
        lockedPayment.enrollmentId !== lockedEnrollment.id ||
        lockedEnrollment.classId !== lockedClass.id ||
        lockedClass.id !== preliminaryClassId
      ) {
        throw new UnprocessableEntityException(
          'Dữ liệu thanh toán, ghi danh và lớp học không đồng nhất',
        );
      }

      // Step 5: Status Guards
      if (lockedPayment.status !== PaymentStatus.CONFIRMED) {
        throw new ConflictException(
          `Chỉ có thể thử kích hoạt lại thanh toán ở trạng thái ĐÃ XÁC NHẬN (CONFIRMED). Trạng thái hiện tại: ${lockedPayment.status}`,
        );
      }

      // Step 6: Inconsistency Matrix
      // Case A: CONFIRMED + activationIssue === null + ACTIVE -> idempotent HTTP 200, no mutation
      if (
        lockedPayment.activationIssue === null &&
        lockedEnrollment.status === EnrollmentStatus.ACTIVE
      ) {
        return this.formatAdminPaymentDetail(paymentId, tx);
      }

      // Case B: CONFIRMED + activationIssue === null + PENDING_PAYMENT -> 422
      if (
        lockedPayment.activationIssue === null &&
        lockedEnrollment.status === EnrollmentStatus.PENDING_PAYMENT
      ) {
        throw new UnprocessableEntityException(
          'Thanh toán đã xác nhận nhưng không có ghi nhận lý do chưa kích hoạt (activationIssue)',
        );
      }

      // Case C: CONFIRMED + activationIssue !== null + ACTIVE -> 422
      if (
        lockedPayment.activationIssue !== null &&
        lockedEnrollment.status === EnrollmentStatus.ACTIVE
      ) {
        throw new UnprocessableEntityException(
          'Dữ liệu không đồng nhất: Ghi danh đã kích hoạt (ACTIVE) nhưng thanh toán vẫn còn tồn tại lỗi kích hoạt',
        );
      }

      // Case D: CONFIRMED + activationIssue !== null + (COMPLETED or DROPPED) -> 422
      if (
        lockedPayment.activationIssue !== null &&
        (lockedEnrollment.status === EnrollmentStatus.COMPLETED ||
          lockedEnrollment.status === EnrollmentStatus.DROPPED)
      ) {
        throw new UnprocessableEntityException(
          `Không thể kích hoạt lại ghi danh ở trạng thái ${lockedEnrollment.status}`,
        );
      }

      // Any other non-PENDING_PAYMENT status -> 422
      if (lockedEnrollment.status !== EnrollmentStatus.PENDING_PAYMENT) {
        throw new UnprocessableEntityException(
          `Không thể kích hoạt lại ghi danh ở trạng thái ${lockedEnrollment.status}`,
        );
      }

      // Precondition: Normal retry requires activationIssue in [CLASS_FULL, CLASS_NOT_ELIGIBLE]
      if (
        lockedPayment.activationIssue !== PaymentActivationIssue.CLASS_FULL &&
        lockedPayment.activationIssue !== PaymentActivationIssue.CLASS_NOT_ELIGIBLE
      ) {
        throw new UnprocessableEntityException(
          `Lý do kích hoạt không hợp lệ để thử lại: ${lockedPayment.activationIssue}`,
        );
      }

      // Step 7: Decision Logic & Current-State Reevaluation
      if (lockedClass.status === ClassStatus.UPCOMING) {
        const activeCount = await tx.enrollment.count({
          where: {
            classId: lockedClass.id,
            status: EnrollmentStatus.ACTIVE,
          },
        });

        if (
          lockedClass.capacity === null ||
          activeCount < lockedClass.capacity
        ) {
          // Success: Activate Enrollment & Clear issue
          await tx.enrollment.update({
            where: { id: lockedEnrollment.id },
            data: { status: EnrollmentStatus.ACTIVE },
          });

          await tx.payment.update({
            where: { id: paymentId },
            data: { activationIssue: null },
          });
        } else {
          // Still Full or transition to CLASS_FULL
          if (lockedPayment.activationIssue !== PaymentActivationIssue.CLASS_FULL) {
            await tx.payment.update({
              where: { id: paymentId },
              data: { activationIssue: PaymentActivationIssue.CLASS_FULL },
            });
          }
        }
      } else {
        // Still or now not eligible (ONGOING, COMPLETED, CANCELLED)
        if (lockedPayment.activationIssue !== PaymentActivationIssue.CLASS_NOT_ELIGIBLE) {
          await tx.payment.update({
            where: { id: paymentId },
            data: { activationIssue: PaymentActivationIssue.CLASS_NOT_ELIGIBLE },
          });
        }
      }

      // Return authoritative snapshot
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
      activationIssue: payment.activationIssue,
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
