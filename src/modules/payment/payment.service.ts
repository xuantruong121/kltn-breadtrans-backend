import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../common/email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
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

interface InternalPaymentTransitionEvent {
  didPaymentTransition: boolean;
  didActivateEnrollment: boolean;
  previousPaymentStatus: PaymentStatus;
  newPaymentStatus: PaymentStatus;
  previousEnrollmentStatus: EnrollmentStatus;
  newEnrollmentStatus: EnrollmentStatus;
  activationIssue: PaymentActivationIssue | null;
  paymentId: number;
  studentId: number;
  studentEmail: string;
  studentName: string;
  className: string;
  courseTitle: string;
  transferCode: string;
  amountVnd: number;
}

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

export function isReviewerForeignKeyError(error: unknown): boolean {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2003'
  ) {
    const metaStr = JSON.stringify(error.meta || {});
    const msg = error.message || '';
    return (
      metaStr.includes('reviewedById') ||
      metaStr.includes('Payment_reviewedById_fkey') ||
      metaStr.includes('PaymentReviewer') ||
      msg.includes('reviewedById') ||
      msg.includes('Payment_reviewedById_fkey') ||
      msg.includes('PaymentReviewer')
    );
  }
  return false;
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly notificationsService: NotificationsService,
  ) {}

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
      // 1. Lock payment row with parameterized raw query enforcing ownership and reading enrollment status
      const lockedRows = await tx.$queryRaw<
        Array<{
          id: number;
          status: PaymentStatus;
          reportedAt: Date | null;
          enrollmentStatus: EnrollmentStatus;
        }>
      >`
        SELECT p.id, p.status, p."reportedAt", e.status AS "enrollmentStatus"
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

      // 4. Enrollment invariant: First transition requires linked Enrollment to be PENDING_PAYMENT
      if (current.enrollmentStatus !== EnrollmentStatus.PENDING_PAYMENT) {
        throw new UnprocessableEntityException(
          'Không thể báo chuyển khoản vì trạng thái ghi danh không hợp lệ (yêu cầu PENDING_PAYMENT)',
        );
      }

      // 5. Atomic transition: PENDING -> REPORTED
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
    try {
      const { dto: resultDto, eventDescriptor } =
        await this.prisma.$transaction(async (tx) => {
          // 1. Parameterized PostgreSQL row lock reading Enrollment status
          const lockedRows = await tx.$queryRaw<
            Array<{
              id: number;
              status: PaymentStatus;
              reviewedById: number | null;
              reviewedAt: Date | null;
              adminNote: string | null;
              enrollmentStatus: EnrollmentStatus;
            }>
          >`
          SELECT p.id, p.status, p."reviewedById", p."reviewedAt", p."adminNote", e.status AS "enrollmentStatus"
          FROM "Payment" p
          JOIN "Enrollment" e ON p."enrollmentId" = e.id
          WHERE p.id = ${paymentId}
          FOR UPDATE OF p;
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

          // 4. Enrollment invariant: Rejection requires linked Enrollment to be PENDING_PAYMENT
          if (current.enrollmentStatus !== EnrollmentStatus.PENDING_PAYMENT) {
            throw new UnprocessableEntityException(
              'Không thể từ chối thanh toán vì trạng thái ghi danh không hợp lệ (yêu cầu PENDING_PAYMENT)',
            );
          }

          // 5. Update status and review metadata (financial fields & enrollment unchanged)
          await tx.payment.update({
            where: { id: paymentId },
            data: {
              status: PaymentStatus.REJECTED,
              reviewedById: adminId,
              reviewedAt: new Date(),
              adminNote: dto.reason.trim(),
            },
          });

          // 6. Re-read and return updated detail snapshot
          const detailDto = await this.formatAdminPaymentDetail(paymentId, tx);
          return {
            dto: detailDto,
            eventDescriptor: {
              didPaymentTransition: true,
              didActivateEnrollment: false,
              previousPaymentStatus: current.status,
              newPaymentStatus: PaymentStatus.REJECTED,
              previousEnrollmentStatus: current.enrollmentStatus,
              newEnrollmentStatus: current.enrollmentStatus,
              activationIssue: null,
              paymentId: detailDto.id,
              studentId: detailDto.student.id,
              studentEmail: detailDto.student.email,
              studentName: detailDto.student.fullName,
              className: detailDto.class.name,
              courseTitle: detailDto.class.course.title,
              transferCode: detailDto.transferCode,
              amountVnd: detailDto.amountVnd,
            },
          };
        });

      // Post-Commit Notification Dispatch
      if (eventDescriptor.didPaymentTransition) {
        await this.dispatchRejectionNotification(eventDescriptor);
      }

      return resultDto;
    } catch (error) {
      if (isReviewerForeignKeyError(error)) {
        throw new ConflictException(
          'Tài khoản người duyệt không còn tồn tại hoặc đã bị xóa trong quá trình xử lý.',
        );
      }
      throw error;
    }
  }

  async confirmPayment(
    paymentId: number,
    adminId: number,
  ): Promise<AdminPaymentDetailDto> {
    try {
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
      const { dto: resultDto, eventDescriptor } =
        await this.prisma.$transaction(async (tx) => {
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
            const detailDto = await this.formatAdminPaymentDetail(
              paymentId,
              tx,
            );
            return {
              dto: detailDto,
              eventDescriptor: {
                didPaymentTransition: false,
                didActivateEnrollment: false,
                previousPaymentStatus: lockedPayment.status,
                newPaymentStatus: lockedPayment.status,
                previousEnrollmentStatus: lockedEnrollment.status,
                newEnrollmentStatus: lockedEnrollment.status,
                activationIssue: lockedPayment.activationIssue,
                paymentId: detailDto.id,
                studentId: detailDto.student.id,
                studentEmail: detailDto.student.email,
                studentName: detailDto.student.fullName,
                className: detailDto.class.name,
                courseTitle: detailDto.class.course.title,
                transferCode: detailDto.transferCode,
                amountVnd: detailDto.amountVnd,
              },
            };
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
          let didActivateEnrollment = false;
          let newEnrollmentStatus: EnrollmentStatus = lockedEnrollment.status;
          let finalActivationIssue: PaymentActivationIssue | null = null;

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

              didActivateEnrollment = true;
              newEnrollmentStatus = EnrollmentStatus.ACTIVE;
              finalActivationIssue = null;
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

              didActivateEnrollment = false;
              newEnrollmentStatus = lockedEnrollment.status;
              finalActivationIssue = PaymentActivationIssue.CLASS_FULL;
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

            didActivateEnrollment = false;
            newEnrollmentStatus = lockedEnrollment.status;
            finalActivationIssue = PaymentActivationIssue.CLASS_NOT_ELIGIBLE;
          }

          // Re-read and return authoritative snapshot
          const detailDto = await this.formatAdminPaymentDetail(paymentId, tx);
          return {
            dto: detailDto,
            eventDescriptor: {
              didPaymentTransition: true,
              didActivateEnrollment,
              previousPaymentStatus: lockedPayment.status,
              newPaymentStatus: PaymentStatus.CONFIRMED,
              previousEnrollmentStatus: lockedEnrollment.status,
              newEnrollmentStatus,
              activationIssue: finalActivationIssue,
              paymentId: detailDto.id,
              studentId: detailDto.student.id,
              studentEmail: detailDto.student.email,
              studentName: detailDto.student.fullName,
              className: detailDto.class.name,
              courseTitle: detailDto.class.course.title,
              transferCode: detailDto.transferCode,
              amountVnd: detailDto.amountVnd,
            },
          };
        });

      // Post-Commit Notification Dispatch
      if (eventDescriptor.didActivateEnrollment) {
        await this.tryClaimAndDispatchActivation(eventDescriptor);
      } else if (
        eventDescriptor.didPaymentTransition &&
        (eventDescriptor.activationIssue ===
          PaymentActivationIssue.CLASS_FULL ||
          eventDescriptor.activationIssue ===
            PaymentActivationIssue.CLASS_NOT_ELIGIBLE)
      ) {
        await this.dispatchPendingActivationNotification(eventDescriptor);
      }

      return resultDto;
    } catch (error) {
      if (isReviewerForeignKeyError(error)) {
        throw new ConflictException(
          'Tài khoản người duyệt không còn tồn tại hoặc đã bị xóa trong quá trình xử lý.',
        );
      }
      throw error;
    }
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
    const { dto: resultDto, eventDescriptor } = await this.prisma.$transaction(
      async (tx) => {
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
          const detailDto = await this.formatAdminPaymentDetail(paymentId, tx);
          return {
            dto: detailDto,
            eventDescriptor: {
              didPaymentTransition: false,
              didActivateEnrollment: false,
              previousPaymentStatus: lockedPayment.status,
              newPaymentStatus: lockedPayment.status,
              previousEnrollmentStatus: lockedEnrollment.status,
              newEnrollmentStatus: lockedEnrollment.status,
              activationIssue: null,
              paymentId: detailDto.id,
              studentId: detailDto.student.id,
              studentEmail: detailDto.student.email,
              studentName: detailDto.student.fullName,
              className: detailDto.class.name,
              courseTitle: detailDto.class.course.title,
              transferCode: detailDto.transferCode,
              amountVnd: detailDto.amountVnd,
            },
          };
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
          lockedPayment.activationIssue !==
            PaymentActivationIssue.CLASS_NOT_ELIGIBLE
        ) {
          throw new UnprocessableEntityException(
            `Lý do kích hoạt không hợp lệ để thử lại: ${lockedPayment.activationIssue}`,
          );
        }

        // Step 7: Decision Logic & Current-State Reevaluation
        let didActivateEnrollment = false;
        let newEnrollmentStatus: EnrollmentStatus = lockedEnrollment.status;
        let finalActivationIssue: PaymentActivationIssue | null =
          lockedPayment.activationIssue;

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

            didActivateEnrollment = true;
            newEnrollmentStatus = EnrollmentStatus.ACTIVE;
            finalActivationIssue = null;
          } else {
            // Still Full or transition to CLASS_FULL
            if (
              lockedPayment.activationIssue !==
              PaymentActivationIssue.CLASS_FULL
            ) {
              await tx.payment.update({
                where: { id: paymentId },
                data: { activationIssue: PaymentActivationIssue.CLASS_FULL },
              });
            }
            didActivateEnrollment = false;
            finalActivationIssue = PaymentActivationIssue.CLASS_FULL;
          }
        } else {
          // Still or now not eligible (ONGOING, COMPLETED, CANCELLED)
          if (
            lockedPayment.activationIssue !==
            PaymentActivationIssue.CLASS_NOT_ELIGIBLE
          ) {
            await tx.payment.update({
              where: { id: paymentId },
              data: {
                activationIssue: PaymentActivationIssue.CLASS_NOT_ELIGIBLE,
              },
            });
          }
          didActivateEnrollment = false;
          finalActivationIssue = PaymentActivationIssue.CLASS_NOT_ELIGIBLE;
        }

        // Return authoritative snapshot
        const detailDto = await this.formatAdminPaymentDetail(paymentId, tx);
        return {
          dto: detailDto,
          eventDescriptor: {
            didPaymentTransition: false,
            didActivateEnrollment,
            previousPaymentStatus: lockedPayment.status,
            newPaymentStatus: lockedPayment.status,
            previousEnrollmentStatus: lockedEnrollment.status,
            newEnrollmentStatus,
            activationIssue: finalActivationIssue,
            paymentId: detailDto.id,
            studentId: detailDto.student.id,
            studentEmail: detailDto.student.email,
            studentName: detailDto.student.fullName,
            className: detailDto.class.name,
            courseTitle: detailDto.class.course.title,
            transferCode: detailDto.transferCode,
            amountVnd: detailDto.amountVnd,
          },
        };
      },
    );

    // Post-Commit Notification Dispatch
    if (eventDescriptor.didActivateEnrollment) {
      await this.tryClaimAndDispatchActivation(eventDescriptor);
    }

    return resultDto;
  }

  // ==========================================
  // PHASE 3C-8 NOTIFICATION DISPATCH HELPERS
  // ==========================================

  private async tryClaimAndDispatchActivation(
    event: InternalPaymentTransitionEvent,
  ): Promise<void> {
    try {
      const claimedRows = await this.prisma.$queryRaw<Array<{ id: number }>>`
        UPDATE "Payment" p
        SET "activationNotifiedAt" = NOW()
        WHERE p.id = ${event.paymentId}
          AND p.status = 'CONFIRMED'
          AND p."activationNotifiedAt" IS NULL
          AND EXISTS (
            SELECT 1
            FROM "Enrollment" e
            WHERE e.id = p."enrollmentId"
              AND e.status = 'ACTIVE'
          )
        RETURNING p.id;
      `;

      if (claimedRows && claimedRows.length === 1) {
        await this.dispatchActivationNotification(event);
      } else {
        this.logger.debug(
          `[PaymentNotification] Payment #${event.paymentId} activation claim not acquired (already claimed or condition mismatch).`,
        );
      }
    } catch (error) {
      this.logger.error(
        `[PaymentNotification] Failed to execute atomic activation claim for payment #${event.paymentId}:`,
        error,
      );
    }
  }

  private async dispatchActivationNotification(
    event: InternalPaymentTransitionEvent,
  ): Promise<void> {
    const emailPromise = this.emailService.sendPaymentActivatedEmail(
      event.studentEmail,
      {
        studentName: event.studentName,
        className: event.className,
        courseTitle: event.courseTitle,
        transferCode: event.transferCode,
      },
    );

    const pushPromise = this.notificationsService.sendPushToUser(
      event.studentId,
      {
        title: 'BreadTrans - Kích hoạt khóa học thành công',
        body: `Thanh toán cho lớp ${event.className} đã được xác nhận và ghi danh của bạn đã được kích hoạt. Bạn có thể vào học ngay trên BreadTrans.`,
        url: '/my-courses',
      },
    );

    const [emailResult, pushResult] = await Promise.allSettled([
      emailPromise,
      pushPromise,
    ]);

    if (emailResult.status === 'rejected') {
      this.logger.error(
        `[PaymentNotification] Activation email failed for student #${event.studentId} (Payment #${event.paymentId}):`,
        emailResult.reason,
      );
    }

    if (pushResult.status === 'rejected') {
      this.logger.warn(
        `[PaymentNotification] Activation push rejected for student #${event.studentId} (Payment #${event.paymentId}):`,
        pushResult.reason,
      );
    } else if (pushResult.value && pushResult.value.failed > 0) {
      this.logger.warn(
        `[PaymentNotification] Activation push partially failed for student #${event.studentId}: ${pushResult.value.failed} failed subscriptions`,
      );
    }
  }

  private async dispatchPendingActivationNotification(
    event: InternalPaymentTransitionEvent,
  ): Promise<void> {
    try {
      await this.emailService.sendPaymentPendingActivationEmail(
        event.studentEmail,
        {
          studentName: event.studentName,
          className: event.className,
          courseTitle: event.courseTitle,
          transferCode: event.transferCode,
        },
      );
    } catch (error) {
      this.logger.error(
        `[PaymentNotification] Pending-activation email failed for student #${event.studentId} (Payment #${event.paymentId}):`,
        error,
      );
    }
  }

  private async dispatchRejectionNotification(
    event: InternalPaymentTransitionEvent,
  ): Promise<void> {
    const emailPromise = this.emailService.sendPaymentRejectedEmail(
      event.studentEmail,
      {
        studentName: event.studentName,
        className: event.className,
        courseTitle: event.courseTitle,
        transferCode: event.transferCode,
      },
    );

    const pushPromise = this.notificationsService.sendPushToUser(
      event.studentId,
      {
        title: 'BreadTrans - Thông báo thanh toán',
        body: `Khoản thanh toán cho lớp ${event.className} chưa thể đối soát thành công. Vui lòng kiểm tra lại thông tin giao dịch hoặc liên hệ BreadTrans để được hỗ trợ.`,
        url: '/my-courses',
      },
    );

    const [emailResult, pushResult] = await Promise.allSettled([
      emailPromise,
      pushPromise,
    ]);

    if (emailResult.status === 'rejected') {
      this.logger.error(
        `[PaymentNotification] Rejection email failed for student #${event.studentId} (Payment #${event.paymentId}):`,
        emailResult.reason,
      );
    }

    if (pushResult.status === 'rejected') {
      this.logger.warn(
        `[PaymentNotification] Rejection push rejected for student #${event.studentId} (Payment #${event.paymentId}):`,
        pushResult.reason,
      );
    } else if (pushResult.value && pushResult.value.failed > 0) {
      this.logger.warn(
        `[PaymentNotification] Rejection push partially failed for student #${event.studentId}: ${pushResult.value.failed} failed subscriptions`,
      );
    }
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
