import { Test, TestingModule } from '@nestjs/testing';
import {
  PaymentService,
  buildVietQrUrl,
  isReviewerForeignKeyError,
} from './payment.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../common/email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  PaymentStatus,
  EnrollmentStatus,
  ClassStatus,
  PaymentActivationIssue,
  Prisma,
} from '@prisma/client';
import {
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  STUDENT_PAYMENT_SUMMARY_SELECT,
  STUDENT_PAYMENT_DETAIL_SELECT,
  ADMIN_PAYMENT_SUMMARY_SELECT,
  ADMIN_PAYMENT_DETAIL_SELECT,
} from './payment.constants';
import { AdminPaymentFilterDto } from './dto/payment-admin.dto';

type MockPrismaService = {
  payment: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
    count: jest.Mock;
  };
  enrollment: {
    update: jest.Mock;
    count: jest.Mock;
  };
  $transaction: jest.Mock;
  $queryRaw: jest.Mock;
};

type MockEmailService = {
  sendRegistrationOtp: jest.Mock;
  sendTeacherActivation: jest.Mock;
  sendPaymentActivatedEmail: jest.Mock;
  sendPaymentPendingActivationEmail: jest.Mock;
  sendPaymentRejectedEmail: jest.Mock;
};

type MockNotificationsService = {
  sendPushToUser: jest.Mock;
  sendPushToMultipleUsers: jest.Mock;
};

describe('PaymentService', () => {
  let service: PaymentService;
  let prisma: MockPrismaService;
  let emailService: MockEmailService;
  let notificationsService: MockNotificationsService;
  const originalEnv = { ...process.env };

  beforeAll(() => {
    process.env.PAYMENT_BANK_BIN = '970436';
    process.env.PAYMENT_BANK_NAME = 'Test Bank';
    process.env.PAYMENT_BANK_ACCOUNT_NUMBER = '1234567890';
    process.env.PAYMENT_BANK_ACCOUNT_NAME = 'BREADTRANS TEST CENTER';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  beforeEach(async () => {
    const mockPrisma: MockPrismaService = {
      payment: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      enrollment: {
        update: jest.fn(),
        count: jest.fn(),
      },
      $transaction: jest.fn((input: unknown): unknown => {
        if (typeof input === 'function') {
          const transaction = input as (client: unknown) => unknown;
          return transaction(mockPrisma);
        }
        return input;
      }),
      $queryRaw: jest.fn(),
    };

    const mockEmailService: MockEmailService = {
      sendRegistrationOtp: jest.fn().mockResolvedValue(undefined),
      sendTeacherActivation: jest.fn().mockResolvedValue(undefined),
      sendPaymentActivatedEmail: jest.fn().mockResolvedValue(undefined),
      sendPaymentPendingActivationEmail: jest.fn().mockResolvedValue(undefined),
      sendPaymentRejectedEmail: jest.fn().mockResolvedValue(undefined),
    };

    const mockNotificationsService: MockNotificationsService = {
      sendPushToUser: jest.fn().mockResolvedValue({ sent: 1, failed: 0 }),
      sendPushToMultipleUsers: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailService, useValue: mockEmailService },
        { provide: NotificationsService, useValue: mockNotificationsService },
      ],
    }).compile();

    service = module.get<PaymentService>(PaymentService);
    prisma = module.get<PrismaService>(
      PrismaService,
    ) as unknown as MockPrismaService;
    emailService = module.get<EmailService>(
      EmailService,
    ) as unknown as MockEmailService;
    notificationsService = module.get<NotificationsService>(
      NotificationsService,
    ) as unknown as MockNotificationsService;
  });

  describe('buildVietQrUrl', () => {
    it('generates a valid, deterministic VietQR QuickLink URL using URLSearchParams', () => {
      const url = buildVietQrUrl({
        bin: '970436',
        accountNumber: '1234567890',
        amountVnd: 1500000,
        transferCode: 'BT-45',
        accountName: 'BREADTRANS TEST CENTER',
      });

      expect(url).toBe(
        'https://img.vietqr.io/image/970436-1234567890-compact2.png?amount=1500000&addInfo=BT-45&accountName=BREADTRANS+TEST+CENTER',
      );
    });
  });

  describe('getMyPayments', () => {
    it('queries with STUDENT_PAYMENT_SUMMARY_SELECT, filters by studentId, and orders by createdAt desc', async () => {
      const studentId = 10;
      const fakeCreatedAt = new Date();
      prisma.payment.findMany.mockResolvedValue([
        {
          id: 1,
          enrollmentId: 2,
          amountVnd: 500000,
          transferCode: 'BT-2',
          status: PaymentStatus.PENDING,
          createdAt: fakeCreatedAt,
          reportedAt: null,
          confirmedAt: null,
          enrollment: {
            class: {
              id: 3,
              name: 'Class A',
              course: { id: 4, title: 'Course A' },
            },
          },
        },
      ]);

      const result = await service.getMyPayments(studentId);

      expect(prisma.payment.findMany).toHaveBeenCalledWith({
        where: {
          enrollment: {
            userId: studentId,
          },
        },
        select: STUDENT_PAYMENT_SUMMARY_SELECT,
        orderBy: { createdAt: 'desc' },
      });

      expect(result).toEqual([
        {
          id: 1,
          enrollmentId: 2,
          amountVnd: 500000,
          transferCode: 'BT-2',
          status: PaymentStatus.PENDING,
          createdAt: fakeCreatedAt,
          reportedAt: null,
          confirmedAt: null,
          class: {
            id: 3,
            name: 'Class A',
            course: { id: 4, title: 'Course A' },
          },
        },
      ]);

      // Verify internal fields are not queried in select whitelist
      expect(
        (STUDENT_PAYMENT_SUMMARY_SELECT as any).reviewedById,
      ).toBeUndefined();
      expect((STUDENT_PAYMENT_SUMMARY_SELECT as any).adminNote).toBeUndefined();
      expect(
        (STUDENT_PAYMENT_SUMMARY_SELECT as any).activationIssue,
      ).toBeUndefined();
      expect(
        (STUDENT_PAYMENT_SUMMARY_SELECT as any).activationNotifiedAt,
      ).toBeUndefined();
    });
  });

  describe('getPaymentDetailById', () => {
    it('returns student payment detail with bank instructions and VietQR using snapshot values', async () => {
      const paymentId = 1;
      const studentId = 10;
      const fakeCreatedAt = new Date();
      const fakeUpdatedAt = new Date();

      prisma.payment.findFirst.mockResolvedValue({
        id: paymentId,
        enrollmentId: 20,
        amountVnd: 1200000,
        transferCode: 'BT-20',
        status: PaymentStatus.PENDING,
        createdAt: fakeCreatedAt,
        reportedAt: null,
        confirmedAt: null,
        updatedAt: fakeUpdatedAt,
        enrollment: {
          class: {
            id: 5,
            name: 'Class B',
            course: { id: 6, title: 'Course B' },
          },
        },
      });

      const result = await service.getPaymentDetailById(paymentId, studentId);

      expect(prisma.payment.findFirst).toHaveBeenCalledWith({
        where: {
          id: paymentId,
          enrollment: {
            userId: studentId,
          },
        },
        select: STUDENT_PAYMENT_DETAIL_SELECT,
      });

      expect(result.amountVnd).toBe(1200000);
      expect(result.transferCode).toBe('BT-20');
      expect(result.bankInstructions).toEqual({
        bin: '970436',
        bankName: 'Test Bank',
        accountNumber: '1234567890',
        accountName: 'BREADTRANS TEST CENTER',
        amountVnd: 1200000,
        transferCode: 'BT-20',
        vietQrUrl:
          'https://img.vietqr.io/image/970436-1234567890-compact2.png?amount=1200000&addInfo=BT-20&accountName=BREADTRANS+TEST+CENTER',
      });
    });

    it('throws NotFoundException when payment is missing or belongs to another student (IDOR)', async () => {
      prisma.payment.findFirst.mockResolvedValue(null);

      await expect(service.getPaymentDetailById(999, 10)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('reportTransfer', () => {
    it('transitions PENDING to REPORTED and sets reportedAt', async () => {
      const paymentId = 1;
      const studentId = 10;
      const fakeReportedAt = new Date();

      prisma.$queryRaw.mockResolvedValue([
        {
          id: paymentId,
          status: PaymentStatus.PENDING,
          reportedAt: null,
          enrollmentStatus: EnrollmentStatus.PENDING_PAYMENT,
        },
      ]);
      prisma.payment.update.mockResolvedValue({});
      prisma.payment.findFirst.mockResolvedValue({
        id: paymentId,
        enrollmentId: 20,
        amountVnd: 1200000,
        transferCode: 'BT-20',
        status: PaymentStatus.REPORTED,
        createdAt: new Date(),
        reportedAt: fakeReportedAt,
        confirmedAt: null,
        updatedAt: new Date(),
        enrollment: {
          class: {
            id: 5,
            name: 'Class B',
            course: { id: 6, title: 'Course B' },
          },
        },
      });

      const result = await service.reportTransfer(paymentId, studentId);

      expect(prisma.$queryRaw).toHaveBeenCalled();
      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.REPORTED,
          reportedAt: expect.any(Date),
        },
      });
      expect(result.status).toBe(PaymentStatus.REPORTED);
      expect(result.reportedAt).toBe(fakeReportedAt);
    });

    it('is idempotent when payment is already REPORTED, keeping reportedAt stable without updating', async () => {
      const paymentId = 1;
      const studentId = 10;
      const stableReportedAt = new Date('2026-09-06T10:00:00.000Z');

      prisma.$queryRaw.mockResolvedValue([
        {
          id: paymentId,
          status: PaymentStatus.REPORTED,
          reportedAt: stableReportedAt,
        },
      ]);
      prisma.payment.findFirst.mockResolvedValue({
        id: paymentId,
        enrollmentId: 20,
        amountVnd: 1200000,
        transferCode: 'BT-20',
        status: PaymentStatus.REPORTED,
        createdAt: new Date(),
        reportedAt: stableReportedAt,
        confirmedAt: null,
        updatedAt: new Date(),
        enrollment: {
          class: {
            id: 5,
            name: 'Class B',
            course: { id: 6, title: 'Course B' },
          },
        },
      });

      const result = await service.reportTransfer(paymentId, studentId);

      expect(prisma.payment.update).not.toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.REPORTED);
      expect(result.reportedAt).toBe(stableReportedAt);
    });

    it('throws ConflictException when payment status is CONFIRMED', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { id: 1, status: PaymentStatus.CONFIRMED, reportedAt: new Date() },
      ]);

      await expect(service.reportTransfer(1, 10)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.payment.update).not.toHaveBeenCalled();
    });

    it('throws ConflictException when payment status is REJECTED', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { id: 1, status: PaymentStatus.REJECTED, reportedAt: null },
      ]);

      await expect(service.reportTransfer(1, 10)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.payment.update).not.toHaveBeenCalled();
    });

    it('throws ConflictException when payment status is REVIEW_REQUIRED', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { id: 1, status: PaymentStatus.REVIEW_REQUIRED, reportedAt: null },
      ]);

      await expect(service.reportTransfer(1, 10)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.payment.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when locking query returns no row (IDOR / not owned)', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await expect(service.reportTransfer(1, 10)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.payment.update).not.toHaveBeenCalled();
    });
  });

  describe('getAdminPayments', () => {
    it('applies status filter, search query, and deterministic order [{ createdAt: "desc" }, { id: "desc" }]', async () => {
      const mockItems = [
        {
          id: 10,
          enrollmentId: 2,
          amountVnd: 500000,
          transferCode: 'BT-10',
          status: PaymentStatus.REPORTED,
          createdAt: new Date('2026-09-06T09:00:00.000Z'),
          reportedAt: new Date('2026-09-06T09:30:00.000Z'),
          reviewedAt: null,
          confirmedAt: null,
          enrollment: {
            user: {
              id: 5,
              email: 'student@test.com',
              profile: { fullName: 'Nguyen Van A' },
            },
            class: {
              id: 12,
              name: 'Class React',
              tuitionFeeVnd: 600000,
              course: { id: 3, title: 'React Pro' },
            },
          },
          reviewedBy: null,
        },
      ];

      prisma.payment.findMany.mockResolvedValue(mockItems);
      prisma.payment.count.mockResolvedValue(25);

      const result = await service.getAdminPayments({
        status: PaymentStatus.REPORTED,
        search: 'student@test.com',
        page: 2,
        limit: 10,
      });

      expect(prisma.payment.findMany).toHaveBeenCalledWith({
        where: {
          status: PaymentStatus.REPORTED,
          OR: [
            {
              transferCode: {
                contains: 'student@test.com',
                mode: 'insensitive',
              },
            },
            {
              enrollment: {
                user: {
                  email: { contains: 'student@test.com', mode: 'insensitive' },
                },
              },
            },
            {
              enrollment: {
                user: {
                  profile: {
                    fullName: {
                      contains: 'student@test.com',
                      mode: 'insensitive',
                    },
                  },
                },
              },
            },
          ],
        },
        select: ADMIN_PAYMENT_SUMMARY_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 10,
        take: 10,
      });

      expect(result.items.length).toBe(1);
      expect(result.items[0].transferCode).toBe('BT-10');
      expect(result.pagination).toEqual({
        page: 2,
        limit: 10,
        totalItems: 25,
        totalPages: 3,
      });
    });

    it('verifies summary select excludes student.phone and adminNote', () => {
      // Data minimization check: summary select must not expose phone or adminNote
      const selectObj = ADMIN_PAYMENT_SUMMARY_SELECT as any;
      expect(selectObj.adminNote).toBeUndefined();
      expect(
        selectObj.enrollment.select.user.select.profile.select.phone,
      ).toBeUndefined();
    });

    it('defaults pagination to page 1, limit 10 when not provided', async () => {
      prisma.payment.findMany.mockResolvedValue([]);
      prisma.payment.count.mockResolvedValue(0);

      const result = await service.getAdminPayments(
        {} as AdminPaymentFilterDto,
      );

      expect(prisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 10,
        }),
      );
      expect(result.pagination).toEqual({
        page: 1,
        limit: 10,
        totalItems: 0,
        totalPages: 1,
      });
    });
  });

  describe('getAdminPaymentDetail', () => {
    it('returns full admin-safe detail including student phone and class tuition reference', async () => {
      const paymentId = 77;
      const fakePayment = {
        id: paymentId,
        enrollmentId: 10,
        amountVnd: 750000,
        transferCode: 'BT-77',
        status: PaymentStatus.REPORTED,
        createdAt: new Date('2026-09-06T08:00:00.000Z'),
        updatedAt: new Date('2026-09-06T08:15:00.000Z'),
        reportedAt: new Date('2026-09-06T08:10:00.000Z'),
        reviewedAt: null,
        confirmedAt: null,
        adminNote: null,
        enrollment: {
          id: 10,
          status: 'PENDING_PAYMENT',
          joinedAt: new Date('2026-09-06T08:00:00.000Z'),
          user: {
            id: 8,
            email: 'learner@breadtrans.vn',
            profile: { fullName: 'Tran Thi B', phone: '0901234567' },
          },
          class: {
            id: 22,
            name: 'Class Vue',
            tuitionFeeVnd: 750000,
            course: { id: 4, title: 'Vue.js Mastery' },
          },
        },
        reviewedBy: null,
      };

      prisma.payment.findUnique.mockResolvedValue(fakePayment);

      const result = await service.getAdminPaymentDetail(paymentId);

      expect(prisma.payment.findUnique).toHaveBeenCalledWith({
        where: { id: paymentId },
        select: ADMIN_PAYMENT_DETAIL_SELECT,
      });
      expect(result.id).toBe(paymentId);
      expect(result.student.phone).toBe('0901234567');
      expect(result.enrollment.status).toBe('PENDING_PAYMENT');
      expect(result.bankInstructions.transferCode).toBe('BT-77');
    });

    it('throws NotFoundException if payment id does not exist', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);

      await expect(service.getAdminPaymentDetail(999)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('rejectPayment', () => {
    const paymentId = 55;
    const adminId = 9;
    const rejectDto = {
      reason: 'Biên lai mờ, không rõ mã giao dịch, yêu cầu kiểm tra lại',
    };

    it('locks payment row, updates status to REJECTED, records reviewedById and adminNote', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          id: paymentId,
          status: PaymentStatus.REPORTED,
          reviewedById: null,
          reviewedAt: null,
          adminNote: null,
          enrollmentStatus: EnrollmentStatus.PENDING_PAYMENT,
        },
      ]);

      const fakeUpdatedPayment = {
        id: paymentId,
        enrollmentId: 12,
        amountVnd: 1500000,
        transferCode: 'BT-55',
        status: PaymentStatus.REJECTED,
        createdAt: new Date('2026-09-06T08:00:00.000Z'),
        updatedAt: new Date('2026-09-06T08:25:00.000Z'),
        reportedAt: new Date('2026-09-06T08:10:00.000Z'),
        reviewedAt: new Date('2026-09-06T08:25:00.000Z'),
        confirmedAt: null,
        adminNote: rejectDto.reason,
        enrollment: {
          id: 12,
          status: 'PENDING_PAYMENT',
          joinedAt: new Date('2026-09-06T08:00:00.000Z'),
          user: {
            id: 7,
            email: 'student@example.com',
            profile: { fullName: 'Le Van C', phone: '0987654321' },
          },
          class: {
            id: 18,
            name: 'Class Node',
            tuitionFeeVnd: 1500000,
            course: { id: 5, title: 'Node.js Backend' },
          },
        },
        reviewedBy: {
          id: adminId,
          email: 'admin@breadtrans.vn',
          profile: { fullName: 'Admin User' },
        },
      };

      prisma.payment.findUnique.mockResolvedValue(fakeUpdatedPayment);

      const result = await service.rejectPayment(paymentId, adminId, rejectDto);

      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.REJECTED,
          reviewedById: adminId,
          reviewedAt: expect.any(Date),
          adminNote: rejectDto.reason,
        },
      });
      expect(result.status).toBe(PaymentStatus.REJECTED);
      expect(result.reviewedBy?.id).toBe(adminId);
      expect(result.adminNote).toBe(rejectDto.reason);
      expect(result.amountVnd).toBe(1500000); // Financial snapshot unchanged
      expect(result.transferCode).toBe('BT-55'); // Financial snapshot unchanged
      expect(result.enrollment.status).toBe('PENDING_PAYMENT'); // Enrollment invariant
    });

    it('throws NotFoundException when locking query returns no row', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await expect(
        service.rejectPayment(paymentId, adminId, rejectDto),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.payment.update).not.toHaveBeenCalled();
    });

    it('throws ConflictException when payment status is PENDING', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          id: paymentId,
          status: PaymentStatus.PENDING,
          reviewedById: null,
          reviewedAt: null,
          adminNote: null,
        },
      ]);

      await expect(
        service.rejectPayment(paymentId, adminId, rejectDto),
      ).rejects.toThrow(ConflictException);
      expect(prisma.payment.update).not.toHaveBeenCalled();
    });

    it('throws ConflictException when payment status is CONFIRMED', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          id: paymentId,
          status: PaymentStatus.CONFIRMED,
          reviewedById: null,
          reviewedAt: null,
          adminNote: null,
        },
      ]);

      await expect(
        service.rejectPayment(paymentId, adminId, rejectDto),
      ).rejects.toThrow(ConflictException);
      expect(prisma.payment.update).not.toHaveBeenCalled();
    });

    it('throws ConflictException when payment status is REVIEW_REQUIRED', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          id: paymentId,
          status: PaymentStatus.REVIEW_REQUIRED,
          reviewedById: null,
          reviewedAt: null,
          adminNote: null,
        },
      ]);

      await expect(
        service.rejectPayment(paymentId, adminId, rejectDto),
      ).rejects.toThrow(ConflictException);
      expect(prisma.payment.update).not.toHaveBeenCalled();
    });

    it('throws ConflictException on duplicate reject and does not overwrite initial review metadata', async () => {
      const initialReviewedAt = new Date('2026-09-06T08:00:00.000Z');
      prisma.$queryRaw.mockResolvedValue([
        {
          id: paymentId,
          status: PaymentStatus.REJECTED,
          reviewedById: 99,
          reviewedAt: initialReviewedAt,
          adminNote: 'Original reason from first admin',
        },
      ]);

      await expect(
        service.rejectPayment(paymentId, adminId, {
          reason: 'Different reason from second admin',
        }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.payment.update).not.toHaveBeenCalled();
    });
  });

  describe('confirmPayment', () => {
    const paymentId = 100;
    const adminId = 1;
    const enrollmentId = 50;
    const classId = 20;

    const preliminarySuccess = {
      id: paymentId,
      enrollmentId,
      enrollment: {
        id: enrollmentId,
        classId,
      },
    };

    const buildDetail = (overrides: Record<string, any> = {}) => ({
      id: paymentId,
      enrollmentId,
      amountVnd: 1500000,
      transferCode: 'BT-100',
      status: PaymentStatus.CONFIRMED,
      activationIssue: null,
      createdAt: new Date('2026-09-06T08:00:00.000Z'),
      updatedAt: new Date('2026-09-06T08:30:00.000Z'),
      reportedAt: new Date('2026-09-06T08:15:00.000Z'),
      reviewedAt: new Date('2026-09-06T08:30:00.000Z'),
      confirmedAt: new Date('2026-09-06T08:30:00.000Z'),
      adminNote: null,
      enrollment: {
        id: enrollmentId,
        status: EnrollmentStatus.ACTIVE,
        joinedAt: new Date('2026-09-06T08:00:00.000Z'),
        user: {
          id: 7,
          email: 'student@example.com',
          profile: { fullName: 'Student C', phone: '0912345678' },
        },
        class: {
          id: classId,
          name: 'Class Node',
          tuitionFeeVnd: 1500000,
          course: { id: 5, title: 'Node Course' },
        },
      },
      reviewedBy: {
        id: adminId,
        email: 'admin@breadtrans.vn',
        profile: { fullName: 'Admin User' },
      },
      ...overrides,
    });

    it('successfully confirms payment and activates enrollment when UPCOMING and capacity available (Case A)', async () => {
      prisma.payment.findUnique
        .mockResolvedValueOnce(preliminarySuccess) // Preliminary lookup
        .mockResolvedValueOnce(buildDetail()); // formatAdminPaymentDetail

      // Lock sequence: 1. Class, 2. Payment, 3. Enrollment
      prisma.$queryRaw
        .mockResolvedValueOnce([
          { id: classId, status: ClassStatus.UPCOMING, capacity: 20 },
        ])
        .mockResolvedValueOnce([
          {
            id: paymentId,
            status: PaymentStatus.REPORTED,
            enrollmentId,
            confirmedAt: null,
            reviewedAt: null,
            reviewedById: null,
            activationIssue: null,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: enrollmentId,
            status: EnrollmentStatus.PENDING_PAYMENT,
            classId,
          },
        ]);

      prisma.enrollment.count.mockResolvedValue(5); // activeCount < capacity

      const result = await service.confirmPayment(paymentId, adminId);

      expect(prisma.enrollment.update).toHaveBeenCalledWith({
        where: { id: enrollmentId },
        data: { status: EnrollmentStatus.ACTIVE },
      });
      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.CONFIRMED,
          confirmedAt: expect.any(Date),
          reviewedAt: expect.any(Date),
          reviewedById: adminId,
          activationIssue: null,
        },
      });
      expect(result.status).toBe(PaymentStatus.CONFIRMED);
      expect(result.activationIssue).toBeNull();
      expect(result.enrollment.status).toBe(EnrollmentStatus.ACTIVE);
    });

    it('confirms payment with CLASS_FULL and leaves enrollment PENDING_PAYMENT when class is full (Case B)', async () => {
      prisma.payment.findUnique
        .mockResolvedValueOnce(preliminarySuccess)
        .mockResolvedValueOnce(
          buildDetail({
            activationIssue: PaymentActivationIssue.CLASS_FULL,
            enrollment: {
              id: enrollmentId,
              status: EnrollmentStatus.PENDING_PAYMENT,
              joinedAt: new Date(),
              user: { id: 7, email: 'student@example.com', profile: null },
              class: {
                id: classId,
                name: 'Full Class',
                tuitionFeeVnd: 1500000,
                course: { id: 5, title: 'Node' },
              },
            },
          }),
        );

      prisma.$queryRaw
        .mockResolvedValueOnce([
          { id: classId, status: ClassStatus.UPCOMING, capacity: 10 },
        ])
        .mockResolvedValueOnce([
          {
            id: paymentId,
            status: PaymentStatus.REPORTED,
            enrollmentId,
            confirmedAt: null,
            reviewedAt: null,
            reviewedById: null,
            activationIssue: null,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: enrollmentId,
            status: EnrollmentStatus.PENDING_PAYMENT,
            classId,
          },
        ]);

      prisma.enrollment.count.mockResolvedValue(10); // activeCount >= capacity

      const result = await service.confirmPayment(paymentId, adminId);

      expect(prisma.enrollment.update).not.toHaveBeenCalled();
      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.CONFIRMED,
          confirmedAt: expect.any(Date),
          reviewedAt: expect.any(Date),
          reviewedById: adminId,
          activationIssue: PaymentActivationIssue.CLASS_FULL,
        },
      });
      expect(result.status).toBe(PaymentStatus.CONFIRMED);
      expect(result.activationIssue).toBe(PaymentActivationIssue.CLASS_FULL);
      expect(result.enrollment.status).toBe(EnrollmentStatus.PENDING_PAYMENT);
    });

    it('confirms payment with CLASS_NOT_ELIGIBLE when class status is ONGOING (Case C)', async () => {
      prisma.payment.findUnique
        .mockResolvedValueOnce(preliminarySuccess)
        .mockResolvedValueOnce(
          buildDetail({
            activationIssue: PaymentActivationIssue.CLASS_NOT_ELIGIBLE,
            enrollment: {
              id: enrollmentId,
              status: EnrollmentStatus.PENDING_PAYMENT,
              joinedAt: new Date(),
              user: { id: 7, email: 's@ex.com', profile: null },
              class: {
                id: classId,
                name: 'Ongoing Class',
                tuitionFeeVnd: 1500000,
                course: { id: 5, title: 'Node' },
              },
            },
          }),
        );

      prisma.$queryRaw
        .mockResolvedValueOnce([
          { id: classId, status: ClassStatus.ONGOING, capacity: 20 },
        ])
        .mockResolvedValueOnce([
          {
            id: paymentId,
            status: PaymentStatus.REPORTED,
            enrollmentId,
            confirmedAt: null,
            reviewedAt: null,
            reviewedById: null,
            activationIssue: null,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: enrollmentId,
            status: EnrollmentStatus.PENDING_PAYMENT,
            classId,
          },
        ]);

      const result = await service.confirmPayment(paymentId, adminId);

      expect(prisma.enrollment.update).not.toHaveBeenCalled();
      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.CONFIRMED,
          confirmedAt: expect.any(Date),
          reviewedAt: expect.any(Date),
          reviewedById: adminId,
          activationIssue: PaymentActivationIssue.CLASS_NOT_ELIGIBLE,
        },
      });
      expect(result.status).toBe(PaymentStatus.CONFIRMED);
      expect(result.activationIssue).toBe(
        PaymentActivationIssue.CLASS_NOT_ELIGIBLE,
      );
      expect(result.enrollment.status).toBe(EnrollmentStatus.PENDING_PAYMENT);
    });

    it('confirms payment with CLASS_NOT_ELIGIBLE when class status is COMPLETED (Case C)', async () => {
      prisma.payment.findUnique
        .mockResolvedValueOnce(preliminarySuccess)
        .mockResolvedValueOnce(
          buildDetail({
            activationIssue: PaymentActivationIssue.CLASS_NOT_ELIGIBLE,
            enrollment: {
              id: enrollmentId,
              status: EnrollmentStatus.PENDING_PAYMENT,
              joinedAt: new Date(),
              user: { id: 7, email: 's@ex.com', profile: null },
              class: {
                id: classId,
                name: 'Completed Class',
                tuitionFeeVnd: 1500000,
                course: { id: 5, title: 'Node' },
              },
            },
          }),
        );

      prisma.$queryRaw
        .mockResolvedValueOnce([
          { id: classId, status: ClassStatus.COMPLETED, capacity: 20 },
        ])
        .mockResolvedValueOnce([
          {
            id: paymentId,
            status: PaymentStatus.REPORTED,
            enrollmentId,
            confirmedAt: null,
            reviewedAt: null,
            reviewedById: null,
            activationIssue: null,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: enrollmentId,
            status: EnrollmentStatus.PENDING_PAYMENT,
            classId,
          },
        ]);

      const result = await service.confirmPayment(paymentId, adminId);

      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: paymentId },
        data: expect.objectContaining({
          status: PaymentStatus.CONFIRMED,
          activationIssue: PaymentActivationIssue.CLASS_NOT_ELIGIBLE,
        }),
      });
      expect(result.activationIssue).toBe(
        PaymentActivationIssue.CLASS_NOT_ELIGIBLE,
      );
    });

    it('confirms payment with CLASS_NOT_ELIGIBLE when class status is CANCELLED (Case C)', async () => {
      prisma.payment.findUnique
        .mockResolvedValueOnce(preliminarySuccess)
        .mockResolvedValueOnce(
          buildDetail({
            activationIssue: PaymentActivationIssue.CLASS_NOT_ELIGIBLE,
            enrollment: {
              id: enrollmentId,
              status: EnrollmentStatus.PENDING_PAYMENT,
              joinedAt: new Date(),
              user: { id: 7, email: 's@ex.com', profile: null },
              class: {
                id: classId,
                name: 'Cancelled Class',
                tuitionFeeVnd: 1500000,
                course: { id: 5, title: 'Node' },
              },
            },
          }),
        );

      prisma.$queryRaw
        .mockResolvedValueOnce([
          { id: classId, status: ClassStatus.CANCELLED, capacity: 20 },
        ])
        .mockResolvedValueOnce([
          {
            id: paymentId,
            status: PaymentStatus.REPORTED,
            enrollmentId,
            confirmedAt: null,
            reviewedAt: null,
            reviewedById: null,
            activationIssue: null,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: enrollmentId,
            status: EnrollmentStatus.PENDING_PAYMENT,
            classId,
          },
        ]);

      const result = await service.confirmPayment(paymentId, adminId);

      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: paymentId },
        data: expect.objectContaining({
          status: PaymentStatus.CONFIRMED,
          activationIssue: PaymentActivationIssue.CLASS_NOT_ELIGIBLE,
        }),
      });
      expect(result.activationIssue).toBe(
        PaymentActivationIssue.CLASS_NOT_ELIGIBLE,
      );
    });

    it('throws ConflictException when payment status is PENDING', async () => {
      prisma.payment.findUnique.mockResolvedValueOnce(preliminarySuccess);
      prisma.$queryRaw
        .mockResolvedValueOnce([
          { id: classId, status: ClassStatus.UPCOMING, capacity: 20 },
        ])
        .mockResolvedValueOnce([
          {
            id: paymentId,
            status: PaymentStatus.PENDING,
            enrollmentId,
            confirmedAt: null,
            reviewedAt: null,
            reviewedById: null,
            activationIssue: null,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: enrollmentId,
            status: EnrollmentStatus.PENDING_PAYMENT,
            classId,
          },
        ]);

      await expect(service.confirmPayment(paymentId, adminId)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.payment.update).not.toHaveBeenCalled();
      expect(prisma.enrollment.update).not.toHaveBeenCalled();
    });

    it('throws ConflictException when payment status is REJECTED', async () => {
      prisma.payment.findUnique.mockResolvedValueOnce(preliminarySuccess);
      prisma.$queryRaw
        .mockResolvedValueOnce([
          { id: classId, status: ClassStatus.UPCOMING, capacity: 20 },
        ])
        .mockResolvedValueOnce([
          {
            id: paymentId,
            status: PaymentStatus.REJECTED,
            enrollmentId,
            confirmedAt: null,
            reviewedAt: null,
            reviewedById: null,
            activationIssue: null,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: enrollmentId,
            status: EnrollmentStatus.PENDING_PAYMENT,
            classId,
          },
        ]);

      await expect(service.confirmPayment(paymentId, adminId)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.payment.update).not.toHaveBeenCalled();
      expect(prisma.enrollment.update).not.toHaveBeenCalled();
    });

    it('throws ConflictException when payment status is REVIEW_REQUIRED', async () => {
      prisma.payment.findUnique.mockResolvedValueOnce(preliminarySuccess);
      prisma.$queryRaw
        .mockResolvedValueOnce([
          { id: classId, status: ClassStatus.UPCOMING, capacity: 20 },
        ])
        .mockResolvedValueOnce([
          {
            id: paymentId,
            status: PaymentStatus.REVIEW_REQUIRED,
            enrollmentId,
            confirmedAt: null,
            reviewedAt: null,
            reviewedById: null,
            activationIssue: null,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: enrollmentId,
            status: EnrollmentStatus.PENDING_PAYMENT,
            classId,
          },
        ]);

      await expect(service.confirmPayment(paymentId, adminId)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.payment.update).not.toHaveBeenCalled();
      expect(prisma.enrollment.update).not.toHaveBeenCalled();
    });

    it('returns existing state idempotently for already CONFIRMED active payment without re-running activation', async () => {
      const existingConfirmedAt = new Date('2026-09-06T08:00:00.000Z');
      prisma.payment.findUnique
        .mockResolvedValueOnce(preliminarySuccess)
        .mockResolvedValueOnce(
          buildDetail({
            confirmedAt: existingConfirmedAt,
            reviewedAt: existingConfirmedAt,
            reviewedById: adminId,
          }),
        );

      prisma.$queryRaw
        .mockResolvedValueOnce([
          { id: classId, status: ClassStatus.UPCOMING, capacity: 20 },
        ])
        .mockResolvedValueOnce([
          {
            id: paymentId,
            status: PaymentStatus.CONFIRMED,
            enrollmentId,
            confirmedAt: existingConfirmedAt,
            reviewedAt: existingConfirmedAt,
            reviewedById: adminId,
            activationIssue: null,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: enrollmentId,
            status: EnrollmentStatus.ACTIVE,
            classId,
          },
        ]);

      const result = await service.confirmPayment(paymentId, adminId);

      expect(prisma.payment.update).not.toHaveBeenCalled();
      expect(prisma.enrollment.update).not.toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.CONFIRMED);
      expect(result.confirmedAt).toEqual(existingConfirmedAt);
    });

    it('returns existing state idempotently for already CONFIRMED CLASS_FULL without retrying activation even if capacity is free', async () => {
      const existingConfirmedAt = new Date('2026-09-06T08:00:00.000Z');
      prisma.payment.findUnique
        .mockResolvedValueOnce(preliminarySuccess)
        .mockResolvedValueOnce(
          buildDetail({
            activationIssue: PaymentActivationIssue.CLASS_FULL,
            enrollment: {
              id: enrollmentId,
              status: EnrollmentStatus.PENDING_PAYMENT,
              joinedAt: new Date(),
              user: { id: 7, email: 's@ex.com', profile: null },
              class: {
                id: classId,
                name: 'Node',
                tuitionFeeVnd: 1500000,
                course: { id: 5, title: 'Node' },
              },
            },
            confirmedAt: existingConfirmedAt,
          }),
        );

      prisma.$queryRaw
        .mockResolvedValueOnce([
          { id: classId, status: ClassStatus.UPCOMING, capacity: 20 },
        ])
        .mockResolvedValueOnce([
          {
            id: paymentId,
            status: PaymentStatus.CONFIRMED,
            enrollmentId,
            confirmedAt: existingConfirmedAt,
            reviewedAt: existingConfirmedAt,
            reviewedById: adminId,
            activationIssue: PaymentActivationIssue.CLASS_FULL,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: enrollmentId,
            status: EnrollmentStatus.PENDING_PAYMENT,
            classId,
          },
        ]);

      const result = await service.confirmPayment(paymentId, adminId);

      expect(prisma.payment.update).not.toHaveBeenCalled();
      expect(prisma.enrollment.update).not.toHaveBeenCalled();
      expect(result.activationIssue).toBe(PaymentActivationIssue.CLASS_FULL);
      expect(result.enrollment.status).toBe(EnrollmentStatus.PENDING_PAYMENT);
    });

    it('returns existing state idempotently for already CONFIRMED CLASS_NOT_ELIGIBLE without retrying activation', async () => {
      const existingConfirmedAt = new Date('2026-09-06T08:00:00.000Z');
      prisma.payment.findUnique
        .mockResolvedValueOnce(preliminarySuccess)
        .mockResolvedValueOnce(
          buildDetail({
            activationIssue: PaymentActivationIssue.CLASS_NOT_ELIGIBLE,
            enrollment: {
              id: enrollmentId,
              status: EnrollmentStatus.PENDING_PAYMENT,
              joinedAt: new Date(),
              user: { id: 7, email: 's@ex.com', profile: null },
              class: {
                id: classId,
                name: 'Node',
                tuitionFeeVnd: 1500000,
                course: { id: 5, title: 'Node' },
              },
            },
            confirmedAt: existingConfirmedAt,
          }),
        );

      prisma.$queryRaw
        .mockResolvedValueOnce([
          { id: classId, status: ClassStatus.UPCOMING, capacity: 20 },
        ])
        .mockResolvedValueOnce([
          {
            id: paymentId,
            status: PaymentStatus.CONFIRMED,
            enrollmentId,
            confirmedAt: existingConfirmedAt,
            reviewedAt: existingConfirmedAt,
            reviewedById: adminId,
            activationIssue: PaymentActivationIssue.CLASS_NOT_ELIGIBLE,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: enrollmentId,
            status: EnrollmentStatus.PENDING_PAYMENT,
            classId,
          },
        ]);

      const result = await service.confirmPayment(paymentId, adminId);

      expect(prisma.payment.update).not.toHaveBeenCalled();
      expect(prisma.enrollment.update).not.toHaveBeenCalled();
      expect(result.activationIssue).toBe(
        PaymentActivationIssue.CLASS_NOT_ELIGIBLE,
      );
    });

    it('throws UnprocessableEntityException when REPORTED payment points to an already ACTIVE enrollment (Invariant Check)', async () => {
      prisma.payment.findUnique.mockResolvedValueOnce(preliminarySuccess);
      prisma.$queryRaw
        .mockResolvedValueOnce([
          { id: classId, status: ClassStatus.UPCOMING, capacity: 20 },
        ])
        .mockResolvedValueOnce([
          {
            id: paymentId,
            status: PaymentStatus.REPORTED,
            enrollmentId,
            confirmedAt: null,
            reviewedAt: null,
            reviewedById: null,
            activationIssue: null,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: enrollmentId,
            status: EnrollmentStatus.ACTIVE,
            classId,
          },
        ]);

      await expect(service.confirmPayment(paymentId, adminId)).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(prisma.payment.update).not.toHaveBeenCalled();
      expect(prisma.enrollment.update).not.toHaveBeenCalled();
    });

    it('throws UnprocessableEntityException when REPORTED payment points to a COMPLETED enrollment (Invariant Check)', async () => {
      prisma.payment.findUnique.mockResolvedValueOnce(preliminarySuccess);
      prisma.$queryRaw
        .mockResolvedValueOnce([
          { id: classId, status: ClassStatus.UPCOMING, capacity: 20 },
        ])
        .mockResolvedValueOnce([
          {
            id: paymentId,
            status: PaymentStatus.REPORTED,
            enrollmentId,
            confirmedAt: null,
            reviewedAt: null,
            reviewedById: null,
            activationIssue: null,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: enrollmentId,
            status: EnrollmentStatus.COMPLETED,
            classId,
          },
        ]);

      await expect(service.confirmPayment(paymentId, adminId)).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(prisma.payment.update).not.toHaveBeenCalled();
      expect(prisma.enrollment.update).not.toHaveBeenCalled();
    });

    it('throws UnprocessableEntityException when REPORTED payment points to a DROPPED enrollment (Invariant Check)', async () => {
      prisma.payment.findUnique.mockResolvedValueOnce(preliminarySuccess);
      prisma.$queryRaw
        .mockResolvedValueOnce([
          { id: classId, status: ClassStatus.UPCOMING, capacity: 20 },
        ])
        .mockResolvedValueOnce([
          {
            id: paymentId,
            status: PaymentStatus.REPORTED,
            enrollmentId,
            confirmedAt: null,
            reviewedAt: null,
            reviewedById: null,
            activationIssue: null,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: enrollmentId,
            status: EnrollmentStatus.DROPPED,
            classId,
          },
        ]);

      await expect(service.confirmPayment(paymentId, adminId)).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(prisma.payment.update).not.toHaveBeenCalled();
      expect(prisma.enrollment.update).not.toHaveBeenCalled();
    });

    it('throws UnprocessableEntityException when payment enrollmentId does not match locked enrollment id', async () => {
      prisma.payment.findUnique.mockResolvedValueOnce(preliminarySuccess);
      prisma.$queryRaw
        .mockResolvedValueOnce([
          { id: classId, status: ClassStatus.UPCOMING, capacity: 20 },
        ])
        .mockResolvedValueOnce([
          {
            id: paymentId,
            status: PaymentStatus.REPORTED,
            enrollmentId: 9999, // Mismatched
            confirmedAt: null,
            reviewedAt: null,
            reviewedById: null,
            activationIssue: null,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: enrollmentId,
            status: EnrollmentStatus.PENDING_PAYMENT,
            classId,
          },
        ]);

      await expect(service.confirmPayment(paymentId, adminId)).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(prisma.payment.update).not.toHaveBeenCalled();
      expect(prisma.enrollment.update).not.toHaveBeenCalled();
    });

    it('throws UnprocessableEntityException when enrollment classId does not match locked class id', async () => {
      prisma.payment.findUnique.mockResolvedValueOnce(preliminarySuccess);
      prisma.$queryRaw
        .mockResolvedValueOnce([
          { id: classId, status: ClassStatus.UPCOMING, capacity: 20 },
        ])
        .mockResolvedValueOnce([
          {
            id: paymentId,
            status: PaymentStatus.REPORTED,
            enrollmentId,
            confirmedAt: null,
            reviewedAt: null,
            reviewedById: null,
            activationIssue: null,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: enrollmentId,
            status: EnrollmentStatus.PENDING_PAYMENT,
            classId: 8888, // Mismatched class
          },
        ]);

      await expect(service.confirmPayment(paymentId, adminId)).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(prisma.payment.update).not.toHaveBeenCalled();
      expect(prisma.enrollment.update).not.toHaveBeenCalled();
    });

    it('preserves financial immutability (amountVnd and transferCode remain unchanged)', async () => {
      prisma.payment.findUnique
        .mockResolvedValueOnce(preliminarySuccess)
        .mockResolvedValueOnce(buildDetail());

      prisma.$queryRaw
        .mockResolvedValueOnce([
          { id: classId, status: ClassStatus.UPCOMING, capacity: 20 },
        ])
        .mockResolvedValueOnce([
          {
            id: paymentId,
            status: PaymentStatus.REPORTED,
            enrollmentId,
            confirmedAt: null,
            reviewedAt: null,
            reviewedById: null,
            activationIssue: null,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: enrollmentId,
            status: EnrollmentStatus.PENDING_PAYMENT,
            classId,
          },
        ]);

      prisma.enrollment.count.mockResolvedValue(1);

      const result = await service.confirmPayment(paymentId, adminId);

      expect(result.amountVnd).toBe(1500000);
      expect(result.transferCode).toBe('BT-100');
    });

    it('throws NotFoundException when preliminary payment lookup returns null', async () => {
      prisma.payment.findUnique.mockResolvedValueOnce(null);

      await expect(service.confirmPayment(999, adminId)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('retryActivation', () => {
    const paymentId = 100;
    const enrollmentId = 50;
    const classId = 20;

    const preliminarySuccess = {
      id: paymentId,
      enrollmentId,
      enrollment: {
        id: enrollmentId,
        classId,
      },
    };

    const buildDetail = (overrides: Record<string, any> = {}) => ({
      id: paymentId,
      enrollmentId,
      amountVnd: 1500000,
      transferCode: 'BT-100',
      status: PaymentStatus.CONFIRMED,
      activationIssue: null,
      createdAt: new Date('2026-09-06T08:00:00.000Z'),
      updatedAt: new Date('2026-09-06T08:30:00.000Z'),
      reportedAt: new Date('2026-09-06T08:15:00.000Z'),
      reviewedAt: new Date('2026-09-06T08:30:00.000Z'),
      confirmedAt: new Date('2026-09-06T08:30:00.000Z'),
      adminNote: null,
      enrollment: {
        id: enrollmentId,
        status: EnrollmentStatus.ACTIVE,
        joinedAt: new Date('2026-09-06T08:00:00.000Z'),
        user: {
          id: 7,
          email: 'student@example.com',
          profile: { fullName: 'Student C', phone: '0912345678' },
        },
        class: {
          id: classId,
          name: 'Class Node',
          tuitionFeeVnd: 1500000,
          course: { id: 5, title: 'Node Course' },
        },
      },
      reviewedBy: {
        id: 9,
        email: 'admin@breadtrans.vn',
        profile: { fullName: 'Admin User' },
      },
      ...overrides,
    });

    it('successfully activates enrollment and clears issue when CLASS_FULL and capacity now available', async () => {
      prisma.payment.findUnique
        .mockResolvedValueOnce(preliminarySuccess)
        .mockResolvedValueOnce(
          buildDetail({
            activationIssue: null,
            enrollment: {
              id: enrollmentId,
              status: EnrollmentStatus.ACTIVE,
              joinedAt: new Date(),
              user: { id: 7, email: 'student@example.com', profile: null },
              class: {
                id: classId,
                name: 'Class Node',
                tuitionFeeVnd: 1500000,
                course: { id: 5, title: 'Node Course' },
              },
            },
          }),
        );

      prisma.$queryRaw
        .mockResolvedValueOnce([
          { id: classId, status: ClassStatus.UPCOMING, capacity: 10 },
        ])
        .mockResolvedValueOnce([
          {
            id: paymentId,
            status: PaymentStatus.CONFIRMED,
            enrollmentId,
            activationIssue: PaymentActivationIssue.CLASS_FULL,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: enrollmentId,
            status: EnrollmentStatus.PENDING_PAYMENT,
            classId,
          },
        ]);

      prisma.enrollment.count.mockResolvedValue(5); // 5 < 10

      const result = await service.retryActivation(paymentId);

      expect(prisma.enrollment.update).toHaveBeenCalledWith({
        where: { id: enrollmentId },
        data: { status: EnrollmentStatus.ACTIVE },
      });
      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: paymentId },
        data: { activationIssue: null },
      });
      expect(result.activationIssue).toBeNull();
      expect(result.enrollment.status).toBe(EnrollmentStatus.ACTIVE);
    });

    it('successfully activates enrollment and clears issue when CLASS_NOT_ELIGIBLE and class now UPCOMING with capacity', async () => {
      prisma.payment.findUnique
        .mockResolvedValueOnce(preliminarySuccess)
        .mockResolvedValueOnce(
          buildDetail({
            activationIssue: null,
            enrollment: {
              id: enrollmentId,
              status: EnrollmentStatus.ACTIVE,
              joinedAt: new Date(),
              user: { id: 7, email: 'student@example.com', profile: null },
              class: {
                id: classId,
                name: 'Class Node',
                tuitionFeeVnd: 1500000,
                course: { id: 5, title: 'Node Course' },
              },
            },
          }),
        );

      prisma.$queryRaw
        .mockResolvedValueOnce([
          { id: classId, status: ClassStatus.UPCOMING, capacity: 20 },
        ])
        .mockResolvedValueOnce([
          {
            id: paymentId,
            status: PaymentStatus.CONFIRMED,
            enrollmentId,
            activationIssue: PaymentActivationIssue.CLASS_NOT_ELIGIBLE,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: enrollmentId,
            status: EnrollmentStatus.PENDING_PAYMENT,
            classId,
          },
        ]);

      prisma.enrollment.count.mockResolvedValue(2);

      const result = await service.retryActivation(paymentId);

      expect(prisma.enrollment.update).toHaveBeenCalledWith({
        where: { id: enrollmentId },
        data: { status: EnrollmentStatus.ACTIVE },
      });
      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: paymentId },
        data: { activationIssue: null },
      });
      expect(result.activationIssue).toBeNull();
      expect(result.enrollment.status).toBe(EnrollmentStatus.ACTIVE);
    });

    it('keeps CLASS_FULL and PENDING_PAYMENT when class is still at full capacity', async () => {
      prisma.payment.findUnique
        .mockResolvedValueOnce(preliminarySuccess)
        .mockResolvedValueOnce(
          buildDetail({
            activationIssue: PaymentActivationIssue.CLASS_FULL,
            enrollment: {
              id: enrollmentId,
              status: EnrollmentStatus.PENDING_PAYMENT,
              joinedAt: new Date(),
              user: { id: 7, email: 'student@example.com', profile: null },
              class: {
                id: classId,
                name: 'Class Node',
                tuitionFeeVnd: 1500000,
                course: { id: 5, title: 'Node Course' },
              },
            },
          }),
        );

      prisma.$queryRaw
        .mockResolvedValueOnce([
          { id: classId, status: ClassStatus.UPCOMING, capacity: 10 },
        ])
        .mockResolvedValueOnce([
          {
            id: paymentId,
            status: PaymentStatus.CONFIRMED,
            enrollmentId,
            activationIssue: PaymentActivationIssue.CLASS_FULL,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: enrollmentId,
            status: EnrollmentStatus.PENDING_PAYMENT,
            classId,
          },
        ]);

      prisma.enrollment.count.mockResolvedValue(10); // 10 >= 10 (still full)

      const result = await service.retryActivation(paymentId);

      expect(prisma.enrollment.update).not.toHaveBeenCalled();
      expect(prisma.payment.update).not.toHaveBeenCalled();
      expect(result.activationIssue).toBe(PaymentActivationIssue.CLASS_FULL);
      expect(result.enrollment.status).toBe(EnrollmentStatus.PENDING_PAYMENT);
    });

    it('keeps CLASS_NOT_ELIGIBLE and PENDING_PAYMENT when class is still ONGOING', async () => {
      prisma.payment.findUnique
        .mockResolvedValueOnce(preliminarySuccess)
        .mockResolvedValueOnce(
          buildDetail({
            activationIssue: PaymentActivationIssue.CLASS_NOT_ELIGIBLE,
            enrollment: {
              id: enrollmentId,
              status: EnrollmentStatus.PENDING_PAYMENT,
              joinedAt: new Date(),
              user: { id: 7, email: 'student@example.com', profile: null },
              class: {
                id: classId,
                name: 'Class Node',
                tuitionFeeVnd: 1500000,
                course: { id: 5, title: 'Node Course' },
              },
            },
          }),
        );

      prisma.$queryRaw
        .mockResolvedValueOnce([
          { id: classId, status: ClassStatus.ONGOING, capacity: 20 },
        ])
        .mockResolvedValueOnce([
          {
            id: paymentId,
            status: PaymentStatus.CONFIRMED,
            enrollmentId,
            activationIssue: PaymentActivationIssue.CLASS_NOT_ELIGIBLE,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: enrollmentId,
            status: EnrollmentStatus.PENDING_PAYMENT,
            classId,
          },
        ]);

      const result = await service.retryActivation(paymentId);

      expect(prisma.enrollment.update).not.toHaveBeenCalled();
      expect(prisma.payment.update).not.toHaveBeenCalled();
      expect(result.activationIssue).toBe(
        PaymentActivationIssue.CLASS_NOT_ELIGIBLE,
      );
      expect(result.enrollment.status).toBe(EnrollmentStatus.PENDING_PAYMENT);
    });

    it('transitions CLASS_NOT_ELIGIBLE -> CLASS_FULL when class is now UPCOMING but full', async () => {
      prisma.payment.findUnique
        .mockResolvedValueOnce(preliminarySuccess)
        .mockResolvedValueOnce(
          buildDetail({
            activationIssue: PaymentActivationIssue.CLASS_FULL,
            enrollment: {
              id: enrollmentId,
              status: EnrollmentStatus.PENDING_PAYMENT,
              joinedAt: new Date(),
              user: { id: 7, email: 'student@example.com', profile: null },
              class: {
                id: classId,
                name: 'Class Node',
                tuitionFeeVnd: 1500000,
                course: { id: 5, title: 'Node Course' },
              },
            },
          }),
        );

      prisma.$queryRaw
        .mockResolvedValueOnce([
          { id: classId, status: ClassStatus.UPCOMING, capacity: 10 },
        ])
        .mockResolvedValueOnce([
          {
            id: paymentId,
            status: PaymentStatus.CONFIRMED,
            enrollmentId,
            activationIssue: PaymentActivationIssue.CLASS_NOT_ELIGIBLE,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: enrollmentId,
            status: EnrollmentStatus.PENDING_PAYMENT,
            classId,
          },
        ]);

      prisma.enrollment.count.mockResolvedValue(10); // Full

      const result = await service.retryActivation(paymentId);

      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: paymentId },
        data: { activationIssue: PaymentActivationIssue.CLASS_FULL },
      });
      expect(prisma.enrollment.update).not.toHaveBeenCalled();
      expect(result.activationIssue).toBe(PaymentActivationIssue.CLASS_FULL);
    });

    it('transitions CLASS_FULL -> CLASS_NOT_ELIGIBLE when class is now ONGOING', async () => {
      prisma.payment.findUnique
        .mockResolvedValueOnce(preliminarySuccess)
        .mockResolvedValueOnce(
          buildDetail({
            activationIssue: PaymentActivationIssue.CLASS_NOT_ELIGIBLE,
            enrollment: {
              id: enrollmentId,
              status: EnrollmentStatus.PENDING_PAYMENT,
              joinedAt: new Date(),
              user: { id: 7, email: 'student@example.com', profile: null },
              class: {
                id: classId,
                name: 'Class Node',
                tuitionFeeVnd: 1500000,
                course: { id: 5, title: 'Node Course' },
              },
            },
          }),
        );

      prisma.$queryRaw
        .mockResolvedValueOnce([
          { id: classId, status: ClassStatus.ONGOING, capacity: 10 },
        ])
        .mockResolvedValueOnce([
          {
            id: paymentId,
            status: PaymentStatus.CONFIRMED,
            enrollmentId,
            activationIssue: PaymentActivationIssue.CLASS_FULL,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: enrollmentId,
            status: EnrollmentStatus.PENDING_PAYMENT,
            classId,
          },
        ]);

      const result = await service.retryActivation(paymentId);

      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: paymentId },
        data: { activationIssue: PaymentActivationIssue.CLASS_NOT_ELIGIBLE },
      });
      expect(prisma.enrollment.update).not.toHaveBeenCalled();
      expect(result.activationIssue).toBe(
        PaymentActivationIssue.CLASS_NOT_ELIGIBLE,
      );
    });

    it('returns existing state idempotently for CONFIRMED + ACTIVE + issue null without mutation (Case A)', async () => {
      prisma.payment.findUnique
        .mockResolvedValueOnce(preliminarySuccess)
        .mockResolvedValueOnce(buildDetail());

      prisma.$queryRaw
        .mockResolvedValueOnce([
          { id: classId, status: ClassStatus.UPCOMING, capacity: 10 },
        ])
        .mockResolvedValueOnce([
          {
            id: paymentId,
            status: PaymentStatus.CONFIRMED,
            enrollmentId,
            activationIssue: null,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: enrollmentId,
            status: EnrollmentStatus.ACTIVE,
            classId,
          },
        ]);

      const result = await service.retryActivation(paymentId);

      expect(prisma.payment.update).not.toHaveBeenCalled();
      expect(prisma.enrollment.update).not.toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.CONFIRMED);
      expect(result.activationIssue).toBeNull();
    });

    it('throws UnprocessableEntityException for CONFIRMED + PENDING_PAYMENT + issue null (Case B)', async () => {
      prisma.payment.findUnique.mockResolvedValueOnce(preliminarySuccess);
      prisma.$queryRaw
        .mockResolvedValueOnce([
          { id: classId, status: ClassStatus.UPCOMING, capacity: 10 },
        ])
        .mockResolvedValueOnce([
          {
            id: paymentId,
            status: PaymentStatus.CONFIRMED,
            enrollmentId,
            activationIssue: null,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: enrollmentId,
            status: EnrollmentStatus.PENDING_PAYMENT,
            classId,
          },
        ]);

      await expect(service.retryActivation(paymentId)).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(prisma.payment.update).not.toHaveBeenCalled();
      expect(prisma.enrollment.update).not.toHaveBeenCalled();
    });

    it('throws UnprocessableEntityException for CONFIRMED + ACTIVE + issue non-null (Case C)', async () => {
      prisma.payment.findUnique.mockResolvedValueOnce(preliminarySuccess);
      prisma.$queryRaw
        .mockResolvedValueOnce([
          { id: classId, status: ClassStatus.UPCOMING, capacity: 10 },
        ])
        .mockResolvedValueOnce([
          {
            id: paymentId,
            status: PaymentStatus.CONFIRMED,
            enrollmentId,
            activationIssue: PaymentActivationIssue.CLASS_FULL,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: enrollmentId,
            status: EnrollmentStatus.ACTIVE,
            classId,
          },
        ]);

      await expect(service.retryActivation(paymentId)).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(prisma.payment.update).not.toHaveBeenCalled();
      expect(prisma.enrollment.update).not.toHaveBeenCalled();
    });

    it('throws UnprocessableEntityException for CONFIRMED + COMPLETED enrollment (Case D)', async () => {
      prisma.payment.findUnique.mockResolvedValueOnce(preliminarySuccess);
      prisma.$queryRaw
        .mockResolvedValueOnce([
          { id: classId, status: ClassStatus.UPCOMING, capacity: 10 },
        ])
        .mockResolvedValueOnce([
          {
            id: paymentId,
            status: PaymentStatus.CONFIRMED,
            enrollmentId,
            activationIssue: PaymentActivationIssue.CLASS_FULL,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: enrollmentId,
            status: EnrollmentStatus.COMPLETED,
            classId,
          },
        ]);

      await expect(service.retryActivation(paymentId)).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(prisma.payment.update).not.toHaveBeenCalled();
      expect(prisma.enrollment.update).not.toHaveBeenCalled();
    });

    it('throws UnprocessableEntityException for CONFIRMED + DROPPED enrollment (Case D)', async () => {
      prisma.payment.findUnique.mockResolvedValueOnce(preliminarySuccess);
      prisma.$queryRaw
        .mockResolvedValueOnce([
          { id: classId, status: ClassStatus.UPCOMING, capacity: 10 },
        ])
        .mockResolvedValueOnce([
          {
            id: paymentId,
            status: PaymentStatus.CONFIRMED,
            enrollmentId,
            activationIssue: PaymentActivationIssue.CLASS_FULL,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: enrollmentId,
            status: EnrollmentStatus.DROPPED,
            classId,
          },
        ]);

      await expect(service.retryActivation(paymentId)).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(prisma.payment.update).not.toHaveBeenCalled();
      expect(prisma.enrollment.update).not.toHaveBeenCalled();
    });

    it.each([
      PaymentStatus.PENDING,
      PaymentStatus.REPORTED,
      PaymentStatus.REJECTED,
      PaymentStatus.REVIEW_REQUIRED,
    ])('throws ConflictException when payment status is %s', async (status) => {
      prisma.payment.findUnique.mockResolvedValueOnce(preliminarySuccess);
      prisma.$queryRaw
        .mockResolvedValueOnce([
          { id: classId, status: ClassStatus.UPCOMING, capacity: 10 },
        ])
        .mockResolvedValueOnce([
          {
            id: paymentId,
            status,
            enrollmentId,
            activationIssue: PaymentActivationIssue.CLASS_FULL,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: enrollmentId,
            status: EnrollmentStatus.PENDING_PAYMENT,
            classId,
          },
        ]);

      await expect(service.retryActivation(paymentId)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.payment.update).not.toHaveBeenCalled();
      expect(prisma.enrollment.update).not.toHaveBeenCalled();
    });

    it('throws UnprocessableEntityException when relationship mismatch occurs', async () => {
      prisma.payment.findUnique.mockResolvedValueOnce(preliminarySuccess);
      prisma.$queryRaw
        .mockResolvedValueOnce([
          { id: classId, status: ClassStatus.UPCOMING, capacity: 10 },
        ])
        .mockResolvedValueOnce([
          {
            id: paymentId,
            status: PaymentStatus.CONFIRMED,
            enrollmentId: 9999, // Mismatched enrollmentId
            activationIssue: PaymentActivationIssue.CLASS_FULL,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: enrollmentId,
            status: EnrollmentStatus.PENDING_PAYMENT,
            classId,
          },
        ]);

      await expect(service.retryActivation(paymentId)).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(prisma.payment.update).not.toHaveBeenCalled();
      expect(prisma.enrollment.update).not.toHaveBeenCalled();
    });

    it('preserves financial immutability during retry (no changes to amount, code, reviewer, or timestamps)', async () => {
      prisma.payment.findUnique
        .mockResolvedValueOnce(preliminarySuccess)
        .mockResolvedValueOnce(buildDetail());

      prisma.$queryRaw
        .mockResolvedValueOnce([
          { id: classId, status: ClassStatus.UPCOMING, capacity: 10 },
        ])
        .mockResolvedValueOnce([
          {
            id: paymentId,
            status: PaymentStatus.CONFIRMED,
            enrollmentId,
            activationIssue: PaymentActivationIssue.CLASS_FULL,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: enrollmentId,
            status: EnrollmentStatus.PENDING_PAYMENT,
            classId,
          },
        ]);

      prisma.enrollment.count.mockResolvedValue(1);

      const result = await service.retryActivation(paymentId);

      // Verify update only touched activationIssue, NOT financial or reviewer audit fields
      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: paymentId },
        data: { activationIssue: null },
      });
      expect(result.amountVnd).toBe(1500000);
      expect(result.transferCode).toBe('BT-100');
    });

    it('throws NotFoundException when preliminary payment lookup returns null', async () => {
      prisma.payment.findUnique.mockResolvedValueOnce(null);

      await expect(service.retryActivation(999)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('Phase 3C-7 Lifecycle Hardening Invariants & Concurrency Guards', () => {
    describe('isReviewerForeignKeyError helper', () => {
      it('detects P2003 with reviewedById in field_name', () => {
        const error = new Prisma.PrismaClientKnownRequestError(
          'Foreign key constraint failed on the field: `Payment_reviewedById_fkey (index)`',
          {
            code: 'P2003',
            clientVersion: '6.2.1',
            meta: { field_name: 'Payment_reviewedById_fkey (index)' },
          },
        );
        expect(isReviewerForeignKeyError(error)).toBe(true);
      });

      it('detects P2003 with PaymentReviewer relation name', () => {
        const error = new Prisma.PrismaClientKnownRequestError(
          'Foreign key constraint failed on the field: `PaymentReviewer`',
          {
            code: 'P2003',
            clientVersion: '6.2.1',
            meta: { field_name: 'PaymentReviewer' },
          },
        );
        expect(isReviewerForeignKeyError(error)).toBe(true);
      });

      it('returns false for P2003 with unrelated field (e.g. classId)', () => {
        const error = new Prisma.PrismaClientKnownRequestError(
          'Foreign key constraint failed on the field: `Enrollment_classId_fkey`',
          {
            code: 'P2003',
            clientVersion: '6.2.1',
            meta: { field_name: 'Enrollment_classId_fkey' },
          },
        );
        expect(isReviewerForeignKeyError(error)).toBe(false);
      });

      it('returns false for non-P2003 Prisma errors (e.g. P2025)', () => {
        const error = new Prisma.PrismaClientKnownRequestError(
          'Record to delete does not exist.',
          {
            code: 'P2025',
            clientVersion: '6.2.1',
          },
        );
        expect(isReviewerForeignKeyError(error)).toBe(false);
      });

      it('returns false for generic errors', () => {
        expect(isReviewerForeignKeyError(new Error('Unknown error'))).toBe(
          false,
        );
        expect(isReviewerForeignKeyError(null)).toBe(false);
      });
    });

    describe('reportTransfer Enrollment invariant (422)', () => {
      const studentId = 7;
      const paymentId = 100;

      it('throws 422 UnprocessableEntityException when Enrollment is ACTIVE during first report', async () => {
        prisma.$queryRaw.mockResolvedValueOnce([
          {
            id: paymentId,
            status: PaymentStatus.PENDING,
            reportedAt: null,
            enrollmentStatus: EnrollmentStatus.ACTIVE,
          },
        ]);

        await expect(
          service.reportTransfer(paymentId, studentId),
        ).rejects.toThrow(UnprocessableEntityException);

        expect(prisma.payment.update).not.toHaveBeenCalled();
      });

      it('throws 422 UnprocessableEntityException when Enrollment is COMPLETED during first report', async () => {
        prisma.$queryRaw.mockResolvedValueOnce([
          {
            id: paymentId,
            status: PaymentStatus.PENDING,
            reportedAt: null,
            enrollmentStatus: EnrollmentStatus.COMPLETED,
          },
        ]);

        await expect(
          service.reportTransfer(paymentId, studentId),
        ).rejects.toThrow(UnprocessableEntityException);

        expect(prisma.payment.update).not.toHaveBeenCalled();
      });

      it('throws 422 UnprocessableEntityException when Enrollment is DROPPED during first report', async () => {
        prisma.$queryRaw.mockResolvedValueOnce([
          {
            id: paymentId,
            status: PaymentStatus.PENDING,
            reportedAt: null,
            enrollmentStatus: EnrollmentStatus.DROPPED,
          },
        ]);

        await expect(
          service.reportTransfer(paymentId, studentId),
        ).rejects.toThrow(UnprocessableEntityException);

        expect(prisma.payment.update).not.toHaveBeenCalled();
      });

      it('transitions PENDING to REPORTED when Enrollment is PENDING_PAYMENT', async () => {
        prisma.$queryRaw.mockResolvedValueOnce([
          {
            id: paymentId,
            status: PaymentStatus.PENDING,
            reportedAt: null,
            enrollmentStatus: EnrollmentStatus.PENDING_PAYMENT,
          },
        ]);

        prisma.payment.findFirst.mockResolvedValueOnce({
          id: paymentId,
          enrollmentId: 10,
          amountVnd: 500000,
          transferCode: 'BT-REPORT-01',
          status: PaymentStatus.REPORTED,
          createdAt: new Date(),
          reportedAt: new Date(),
          confirmedAt: null,
          updatedAt: new Date(),
          enrollment: {
            class: {
              id: 20,
              name: 'Class 20',
              course: { id: 30, title: 'Course 30' },
            },
          },
        });

        const res = await service.reportTransfer(paymentId, studentId);
        expect(prisma.payment.update).toHaveBeenCalledWith({
          where: { id: paymentId },
          data: expect.objectContaining({
            status: PaymentStatus.REPORTED,
          }),
        });
        expect(res.status).toBe(PaymentStatus.REPORTED);
      });
    });

    describe('rejectPayment Enrollment invariant & Reviewer FK mapping', () => {
      const adminId = 99;
      const paymentId = 101;

      it('throws 422 UnprocessableEntityException when Enrollment is ACTIVE during reject', async () => {
        prisma.$queryRaw.mockResolvedValueOnce([
          {
            id: paymentId,
            status: PaymentStatus.REPORTED,
            reviewedById: null,
            reviewedAt: null,
            adminNote: null,
            enrollmentStatus: EnrollmentStatus.ACTIVE,
          },
        ]);

        await expect(
          service.rejectPayment(paymentId, adminId, { reason: 'Sai cú pháp' }),
        ).rejects.toThrow(UnprocessableEntityException);

        expect(prisma.payment.update).not.toHaveBeenCalled();
      });

      it('throws 422 UnprocessableEntityException when Enrollment is COMPLETED during reject', async () => {
        prisma.$queryRaw.mockResolvedValueOnce([
          {
            id: paymentId,
            status: PaymentStatus.REPORTED,
            reviewedById: null,
            reviewedAt: null,
            adminNote: null,
            enrollmentStatus: EnrollmentStatus.COMPLETED,
          },
        ]);

        await expect(
          service.rejectPayment(paymentId, adminId, { reason: 'Sai cú pháp' }),
        ).rejects.toThrow(UnprocessableEntityException);

        expect(prisma.payment.update).not.toHaveBeenCalled();
      });

      it('throws 422 UnprocessableEntityException when Enrollment is DROPPED during reject', async () => {
        prisma.$queryRaw.mockResolvedValueOnce([
          {
            id: paymentId,
            status: PaymentStatus.REPORTED,
            reviewedById: null,
            reviewedAt: null,
            adminNote: null,
            enrollmentStatus: EnrollmentStatus.DROPPED,
          },
        ]);

        await expect(
          service.rejectPayment(paymentId, adminId, { reason: 'Sai cú pháp' }),
        ).rejects.toThrow(UnprocessableEntityException);

        expect(prisma.payment.update).not.toHaveBeenCalled();
      });

      it('maps reviewer P2003 FK error during reject to 409 Conflict', async () => {
        prisma.$queryRaw.mockResolvedValueOnce([
          {
            id: paymentId,
            status: PaymentStatus.REPORTED,
            reviewedById: null,
            reviewedAt: null,
            adminNote: null,
            enrollmentStatus: EnrollmentStatus.PENDING_PAYMENT,
          },
        ]);

        const fkError = new Prisma.PrismaClientKnownRequestError(
          'Foreign key constraint failed on the field: `Payment_reviewedById_fkey (index)`',
          {
            code: 'P2003',
            clientVersion: '6.2.1',
            meta: { field_name: 'Payment_reviewedById_fkey (index)' },
          },
        );
        prisma.payment.update.mockRejectedValueOnce(fkError);

        await expect(
          service.rejectPayment(paymentId, adminId, { reason: 'Sai cú pháp' }),
        ).rejects.toThrow(ConflictException);
      });

      it('does NOT map unrelated P2003 during reject to reviewer conflict', async () => {
        prisma.$queryRaw.mockResolvedValueOnce([
          {
            id: paymentId,
            status: PaymentStatus.REPORTED,
            reviewedById: null,
            reviewedAt: null,
            adminNote: null,
            enrollmentStatus: EnrollmentStatus.PENDING_PAYMENT,
          },
        ]);

        const unrelatedFkError = new Prisma.PrismaClientKnownRequestError(
          'Foreign key constraint failed on the field: `Other_fkey`',
          {
            code: 'P2003',
            clientVersion: '6.2.1',
            meta: { field_name: 'Other_fkey' },
          },
        );
        prisma.payment.update.mockRejectedValueOnce(unrelatedFkError);

        await expect(
          service.rejectPayment(paymentId, adminId, { reason: 'Sai cú pháp' }),
        ).rejects.toThrow(unrelatedFkError);
      });
    });

    describe('confirmPayment Reviewer FK mapping', () => {
      const adminId = 99;
      const paymentId = 102;
      const classId = 50;
      const enrollmentId = 60;

      it('maps reviewer P2003 FK error during confirm to 409 Conflict', async () => {
        prisma.payment.findUnique.mockResolvedValueOnce({
          id: paymentId,
          enrollmentId,
          enrollment: { id: enrollmentId, classId },
        });

        prisma.$queryRaw
          .mockResolvedValueOnce([
            { id: classId, status: ClassStatus.UPCOMING, capacity: 10 },
          ])
          .mockResolvedValueOnce([
            {
              id: paymentId,
              status: PaymentStatus.REPORTED,
              enrollmentId,
              confirmedAt: null,
              reviewedAt: null,
              reviewedById: null,
              activationIssue: null,
            },
          ])
          .mockResolvedValueOnce([
            {
              id: enrollmentId,
              status: EnrollmentStatus.PENDING_PAYMENT,
              classId,
            },
          ]);

        prisma.enrollment.count.mockResolvedValue(1);

        const fkError = new Prisma.PrismaClientKnownRequestError(
          'Foreign key constraint failed on the field: `Payment_reviewedById_fkey (index)`',
          {
            code: 'P2003',
            clientVersion: '6.2.1',
            meta: { field_name: 'Payment_reviewedById_fkey (index)' },
          },
        );
        prisma.payment.update.mockRejectedValueOnce(fkError);

        await expect(
          service.confirmPayment(paymentId, adminId),
        ).rejects.toThrow(ConflictException);
      });

      it('does NOT map unrelated P2003 during confirm to reviewer conflict', async () => {
        prisma.payment.findUnique.mockResolvedValueOnce({
          id: paymentId,
          enrollmentId,
          enrollment: { id: enrollmentId, classId },
        });

        prisma.$queryRaw
          .mockResolvedValueOnce([
            { id: classId, status: ClassStatus.UPCOMING, capacity: 10 },
          ])
          .mockResolvedValueOnce([
            {
              id: paymentId,
              status: PaymentStatus.REPORTED,
              enrollmentId,
              confirmedAt: null,
              reviewedAt: null,
              reviewedById: null,
              activationIssue: null,
            },
          ])
          .mockResolvedValueOnce([
            {
              id: enrollmentId,
              status: EnrollmentStatus.PENDING_PAYMENT,
              classId,
            },
          ]);

        prisma.enrollment.count.mockResolvedValue(1);

        const unrelatedFkError = new Prisma.PrismaClientKnownRequestError(
          'Foreign key constraint failed on the field: `Other_fkey`',
          {
            code: 'P2003',
            clientVersion: '6.2.1',
            meta: { field_name: 'Other_fkey' },
          },
        );
        prisma.payment.update.mockRejectedValueOnce(unrelatedFkError);

        await expect(
          service.confirmPayment(paymentId, adminId),
        ).rejects.toThrow(unrelatedFkError);
      });
    });
  });

  describe('Phase 3C-8 Payment Lifecycle Notifications', () => {
    const paymentId = 200;
    const adminId = 1;
    const enrollmentId = 80;
    const classId = 30;
    const studentId = 15;

    const buildMockDetail = (overrides: Record<string, any> = {}) => ({
      id: paymentId,
      enrollmentId,
      amountVnd: 2000000,
      transferCode: 'BT-200',
      status: PaymentStatus.CONFIRMED,
      activationIssue: null,
      createdAt: new Date('2026-09-06T08:00:00.000Z'),
      updatedAt: new Date('2026-09-06T08:30:00.000Z'),
      reportedAt: new Date('2026-09-06T08:15:00.000Z'),
      reviewedAt: new Date('2026-09-06T08:30:00.000Z'),
      confirmedAt: new Date('2026-09-06T08:30:00.000Z'),
      adminNote: null,
      enrollment: {
        id: enrollmentId,
        status: EnrollmentStatus.ACTIVE,
        joinedAt: new Date('2026-09-06T08:00:00.000Z'),
        user: {
          id: studentId,
          email: 'student@domain.test',
          profile: { fullName: 'Nguyen Van Test', phone: '0912345678' },
        },
        class: {
          id: classId,
          name: 'React Fullstack Pro',
          tuitionFeeVnd: 2000000,
          course: { id: 9, title: 'React Mastery' },
        },
      },
      reviewedBy: {
        id: adminId,
        email: 'admin@breadtrans.vn',
        profile: { fullName: 'Admin User' },
      },
      ...overrides,
    });

    const sampleDescriptor = {
      didPaymentTransition: true,
      didActivateEnrollment: true,
      previousPaymentStatus: PaymentStatus.REPORTED,
      newPaymentStatus: PaymentStatus.CONFIRMED,
      previousEnrollmentStatus: EnrollmentStatus.PENDING_PAYMENT,
      newEnrollmentStatus: EnrollmentStatus.ACTIVE,
      activationIssue: null,
      paymentId,
      studentId,
      studentEmail: 'student@domain.test',
      studentName: 'Nguyen Van Test',
      className: 'React Fullstack Pro',
      courseTitle: 'React Mastery',
      transferCode: 'BT-200',
      amountVnd: 2000000,
    };

    describe('Section 31: First Confirm Activation & Idempotency', () => {
      it('first confirm: claims atomic dispatch, sends activation email and push once', async () => {
        prisma.payment.findUnique
          .mockResolvedValueOnce({
            id: paymentId,
            enrollmentId,
            enrollment: { id: enrollmentId, classId },
          })
          .mockResolvedValueOnce(buildMockDetail());

        prisma.$queryRaw
          .mockResolvedValueOnce([
            { id: classId, status: ClassStatus.UPCOMING, capacity: 20 },
          ])
          .mockResolvedValueOnce([
            {
              id: paymentId,
              status: PaymentStatus.REPORTED,
              enrollmentId,
              confirmedAt: null,
              reviewedAt: null,
              reviewedById: null,
              activationIssue: null,
            },
          ])
          .mockResolvedValueOnce([
            {
              id: enrollmentId,
              status: EnrollmentStatus.PENDING_PAYMENT,
              classId,
            },
          ])
          .mockResolvedValueOnce([{ id: paymentId }]); // Atomic claim query

        prisma.enrollment.count.mockResolvedValue(2);

        const result = await service.confirmPayment(paymentId, adminId);

        expect(result.status).toBe(PaymentStatus.CONFIRMED);
        expect(result.enrollment.status).toBe(EnrollmentStatus.ACTIVE);

        // Atomic claim executed
        expect(prisma.$queryRaw).toHaveBeenCalledTimes(4);

        // Activation email sent with student-safe data
        expect(emailService.sendPaymentActivatedEmail).toHaveBeenCalledTimes(1);
        expect(emailService.sendPaymentActivatedEmail).toHaveBeenCalledWith(
          'student@domain.test',
          expect.objectContaining({
            studentName: 'Nguyen Van Test',
            className: 'React Fullstack Pro',
            courseTitle: 'React Mastery',
            transferCode: 'BT-200',
          }),
        );

        // Push sent with student-safe payload and valid Student deep link
        expect(notificationsService.sendPushToUser).toHaveBeenCalledTimes(1);
        expect(notificationsService.sendPushToUser).toHaveBeenCalledWith(
          studentId,
          expect.objectContaining({
            body: expect.stringContaining('kích hoạt'),
            url: '/my-courses',
          }),
        );
      });

      it('repeated confirm on already CONFIRMED+ACTIVE payment sends 0 additional notifications', async () => {
        prisma.payment.findUnique
          .mockResolvedValueOnce({
            id: paymentId,
            enrollmentId,
            enrollment: { id: enrollmentId, classId },
          })
          .mockResolvedValueOnce(buildMockDetail());

        prisma.$queryRaw
          .mockResolvedValueOnce([
            { id: classId, status: ClassStatus.UPCOMING, capacity: 20 },
          ])
          .mockResolvedValueOnce([
            {
              id: paymentId,
              status: PaymentStatus.CONFIRMED,
              enrollmentId,
              confirmedAt: new Date(),
              reviewedAt: new Date(),
              reviewedById: adminId,
              activationIssue: null,
            },
          ])
          .mockResolvedValueOnce([
            {
              id: enrollmentId,
              status: EnrollmentStatus.ACTIVE,
              classId,
            },
          ]);

        const result = await service.confirmPayment(paymentId, adminId);

        expect(result.status).toBe(PaymentStatus.CONFIRMED);
        // Zero notification calls
        expect(emailService.sendPaymentActivatedEmail).not.toHaveBeenCalled();
        expect(notificationsService.sendPushToUser).not.toHaveBeenCalled();
      });

      it('legacy CONFIRMED+ACTIVE with activationNotifiedAt=null sends 0 notifications on repeated confirm', async () => {
        prisma.payment.findUnique
          .mockResolvedValueOnce({
            id: paymentId,
            enrollmentId,
            enrollment: { id: enrollmentId, classId },
          })
          .mockResolvedValueOnce(buildMockDetail());

        // Even though activationNotifiedAt is null in DB for this legacy row,
        // because this request did NOT cause the transition, it must send 0 notifications
        prisma.$queryRaw
          .mockResolvedValueOnce([
            { id: classId, status: ClassStatus.UPCOMING, capacity: 20 },
          ])
          .mockResolvedValueOnce([
            {
              id: paymentId,
              status: PaymentStatus.CONFIRMED,
              enrollmentId,
              confirmedAt: new Date(),
              reviewedAt: new Date(),
              reviewedById: adminId,
              activationIssue: null,
            },
          ])
          .mockResolvedValueOnce([
            {
              id: enrollmentId,
              status: EnrollmentStatus.ACTIVE,
              classId,
            },
          ]);

        await service.confirmPayment(paymentId, adminId);

        expect(emailService.sendPaymentActivatedEmail).not.toHaveBeenCalled();
        expect(notificationsService.sendPushToUser).not.toHaveBeenCalled();
        // Claim query was never even run
        expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
      });
    });

    describe('Section 32: Retry Activation Notifications', () => {
      it('retry activation succeeds: claims atomic dispatch, sends activation email and push once', async () => {
        prisma.payment.findUnique
          .mockResolvedValueOnce({
            id: paymentId,
            enrollmentId,
            enrollment: { id: enrollmentId, classId },
          })
          .mockResolvedValueOnce(
            buildMockDetail({
              activationIssue: null,
              enrollment: {
                id: enrollmentId,
                status: EnrollmentStatus.ACTIVE,
                joinedAt: new Date(),
                user: {
                  id: studentId,
                  email: 'student@domain.test',
                  profile: { fullName: 'Nguyen Van Test' },
                },
                class: {
                  id: classId,
                  name: 'React Fullstack Pro',
                  tuitionFeeVnd: 2000000,
                  course: { id: 9, title: 'React Mastery' },
                },
              },
            }),
          );

        prisma.$queryRaw
          .mockResolvedValueOnce([
            { id: classId, status: ClassStatus.UPCOMING, capacity: 20 },
          ])
          .mockResolvedValueOnce([
            {
              id: paymentId,
              status: PaymentStatus.CONFIRMED,
              enrollmentId,
              activationIssue: PaymentActivationIssue.CLASS_FULL,
            },
          ])
          .mockResolvedValueOnce([
            {
              id: enrollmentId,
              status: EnrollmentStatus.PENDING_PAYMENT,
              classId,
            },
          ])
          .mockResolvedValueOnce([{ id: paymentId }]); // Atomic claim query

        prisma.enrollment.count.mockResolvedValue(5); // Capacity available

        const result = await service.retryActivation(paymentId);

        expect(result.status).toBe(PaymentStatus.CONFIRMED);
        expect(result.activationIssue).toBeNull();
        expect(result.enrollment.status).toBe(EnrollmentStatus.ACTIVE);

        expect(emailService.sendPaymentActivatedEmail).toHaveBeenCalledTimes(1);
        expect(notificationsService.sendPushToUser).toHaveBeenCalledTimes(1);
      });

      it('retry blocked (capacity still full): sends 0 notifications', async () => {
        prisma.payment.findUnique
          .mockResolvedValueOnce({
            id: paymentId,
            enrollmentId,
            enrollment: { id: enrollmentId, classId },
          })
          .mockResolvedValueOnce(
            buildMockDetail({
              activationIssue: PaymentActivationIssue.CLASS_FULL,
              enrollment: {
                id: enrollmentId,
                status: EnrollmentStatus.PENDING_PAYMENT,
                joinedAt: new Date(),
                user: {
                  id: studentId,
                  email: 'student@domain.test',
                  profile: { fullName: 'Nguyen Van Test' },
                },
                class: {
                  id: classId,
                  name: 'React Fullstack Pro',
                  tuitionFeeVnd: 2000000,
                  course: { id: 9, title: 'React Mastery' },
                },
              },
            }),
          );

        prisma.$queryRaw
          .mockResolvedValueOnce([
            { id: classId, status: ClassStatus.UPCOMING, capacity: 5 },
          ])
          .mockResolvedValueOnce([
            {
              id: paymentId,
              status: PaymentStatus.CONFIRMED,
              enrollmentId,
              activationIssue: PaymentActivationIssue.CLASS_FULL,
            },
          ])
          .mockResolvedValueOnce([
            {
              id: enrollmentId,
              status: EnrollmentStatus.PENDING_PAYMENT,
              classId,
            },
          ]);

        prisma.enrollment.count.mockResolvedValue(5); // Full!

        const result = await service.retryActivation(paymentId);

        expect(result.activationIssue).toBe(PaymentActivationIssue.CLASS_FULL);
        expect(result.enrollment.status).toBe(EnrollmentStatus.PENDING_PAYMENT);

        expect(emailService.sendPaymentActivatedEmail).not.toHaveBeenCalled();
        expect(notificationsService.sendPushToUser).not.toHaveBeenCalled();
      });

      it('retry transitioning between issues (CLASS_FULL -> CLASS_NOT_ELIGIBLE) sends 0 notifications', async () => {
        prisma.payment.findUnique
          .mockResolvedValueOnce({
            id: paymentId,
            enrollmentId,
            enrollment: { id: enrollmentId, classId },
          })
          .mockResolvedValueOnce(
            buildMockDetail({
              activationIssue: PaymentActivationIssue.CLASS_NOT_ELIGIBLE,
              enrollment: {
                id: enrollmentId,
                status: EnrollmentStatus.PENDING_PAYMENT,
                joinedAt: new Date(),
                user: {
                  id: studentId,
                  email: 'student@domain.test',
                  profile: { fullName: 'Nguyen Van Test' },
                },
                class: {
                  id: classId,
                  name: 'React Fullstack Pro',
                  tuitionFeeVnd: 2000000,
                  course: { id: 9, title: 'React Mastery' },
                },
              },
            }),
          );

        prisma.$queryRaw
          .mockResolvedValueOnce([
            { id: classId, status: ClassStatus.ONGOING, capacity: 20 },
          ])
          .mockResolvedValueOnce([
            {
              id: paymentId,
              status: PaymentStatus.CONFIRMED,
              enrollmentId,
              activationIssue: PaymentActivationIssue.CLASS_FULL,
            },
          ])
          .mockResolvedValueOnce([
            {
              id: enrollmentId,
              status: EnrollmentStatus.PENDING_PAYMENT,
              classId,
            },
          ]);

        const result = await service.retryActivation(paymentId);

        expect(result.activationIssue).toBe(
          PaymentActivationIssue.CLASS_NOT_ELIGIBLE,
        );
        expect(result.enrollment.status).toBe(EnrollmentStatus.PENDING_PAYMENT);

        expect(emailService.sendPaymentActivatedEmail).not.toHaveBeenCalled();
        expect(notificationsService.sendPushToUser).not.toHaveBeenCalled();
      });
    });

    describe('Section 33: Payment Rejection Notifications', () => {
      it('reject payment sends email and web push once without leaking adminNote to student', async () => {
        prisma.$queryRaw.mockResolvedValueOnce([
          {
            id: paymentId,
            status: PaymentStatus.REPORTED,
            reviewedById: null,
            reviewedAt: null,
            adminNote: null,
            enrollmentStatus: EnrollmentStatus.PENDING_PAYMENT,
          },
        ]);

        const rejectDetail = buildMockDetail({
          status: PaymentStatus.REJECTED,
          adminNote: 'Internal secret audit reason: counterfeit slip',
          enrollment: {
            id: enrollmentId,
            status: EnrollmentStatus.PENDING_PAYMENT,
            joinedAt: new Date(),
            user: {
              id: studentId,
              email: 'student@domain.test',
              profile: { fullName: 'Nguyen Van Test' },
            },
            class: {
              id: classId,
              name: 'React Fullstack Pro',
              tuitionFeeVnd: 2000000,
              course: { id: 9, title: 'React Mastery' },
            },
          },
        });

        prisma.payment.findUnique.mockResolvedValueOnce(rejectDetail);

        const result = await service.rejectPayment(paymentId, adminId, {
          reason: 'Internal secret audit reason: counterfeit slip',
        });

        expect(result.status).toBe(PaymentStatus.REJECTED);

        expect(emailService.sendPaymentRejectedEmail).toHaveBeenCalledTimes(1);
        expect(emailService.sendPaymentRejectedEmail).toHaveBeenCalledWith(
          'student@domain.test',
          expect.objectContaining({
            studentName: 'Nguyen Van Test',
            className: 'React Fullstack Pro',
            courseTitle: 'React Mastery',
            transferCode: 'BT-200',
          }),
        );
        // Verify adminNote is NOT in the arguments
        expect(emailService.sendPaymentRejectedEmail).not.toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            adminNote: expect.anything(),
          }),
        );

        expect(notificationsService.sendPushToUser).toHaveBeenCalledTimes(1);
        expect(notificationsService.sendPushToUser).toHaveBeenCalledWith(
          studentId,
          expect.objectContaining({
            body: expect.stringContaining('chưa thể đối soát'),
            url: '/my-courses',
          }),
        );
      });

      it('repeated reject throws 409 Conflict and sends 0 additional notifications', async () => {
        prisma.$queryRaw.mockResolvedValueOnce([
          {
            id: paymentId,
            status: PaymentStatus.REJECTED,
            reviewedById: adminId,
            reviewedAt: new Date(),
            adminNote: 'Already rejected',
            enrollmentStatus: EnrollmentStatus.PENDING_PAYMENT,
          },
        ]);

        await expect(
          service.rejectPayment(paymentId, adminId, { reason: 'Retry reject' }),
        ).rejects.toThrow(ConflictException);

        expect(emailService.sendPaymentRejectedEmail).not.toHaveBeenCalled();
        expect(notificationsService.sendPushToUser).not.toHaveBeenCalled();
      });

      it('rejection notification provider failure does not rollback DB or fail API', async () => {
        prisma.$queryRaw.mockResolvedValueOnce([
          {
            id: paymentId,
            status: PaymentStatus.REPORTED,
            reviewedById: null,
            reviewedAt: null,
            adminNote: null,
            enrollmentStatus: EnrollmentStatus.PENDING_PAYMENT,
          },
        ]);

        const rejectDetail = buildMockDetail({
          status: PaymentStatus.REJECTED,
          adminNote: 'Reason',
        });
        prisma.payment.findUnique.mockResolvedValueOnce(rejectDetail);

        // Simulate provider failure
        emailService.sendPaymentRejectedEmail.mockRejectedValueOnce(
          new Error('SMTP connection timed out'),
        );
        notificationsService.sendPushToUser.mockRejectedValueOnce(
          new Error('VAPID service unreachable'),
        );

        // Operation must still succeed
        const result = await service.rejectPayment(paymentId, adminId, {
          reason: 'Reason',
        });

        expect(result.status).toBe(PaymentStatus.REJECTED);
        expect(prisma.payment.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: paymentId },
            data: expect.objectContaining({ status: PaymentStatus.REJECTED }),
          }),
        );
      });
    });

    describe('Section 34: Pending Activation Notifications (First Confirm)', () => {
      it('first confirm with CLASS_FULL sends email only and NO web push', async () => {
        prisma.payment.findUnique
          .mockResolvedValueOnce({
            id: paymentId,
            enrollmentId,
            enrollment: { id: enrollmentId, classId },
          })
          .mockResolvedValueOnce(
            buildMockDetail({
              activationIssue: PaymentActivationIssue.CLASS_FULL,
              enrollment: {
                id: enrollmentId,
                status: EnrollmentStatus.PENDING_PAYMENT,
                joinedAt: new Date(),
                user: {
                  id: studentId,
                  email: 'student@domain.test',
                  profile: { fullName: 'Nguyen Van Test' },
                },
                class: {
                  id: classId,
                  name: 'React Fullstack Pro',
                  tuitionFeeVnd: 2000000,
                  course: { id: 9, title: 'React Mastery' },
                },
              },
            }),
          );

        prisma.$queryRaw
          .mockResolvedValueOnce([
            { id: classId, status: ClassStatus.UPCOMING, capacity: 5 },
          ])
          .mockResolvedValueOnce([
            {
              id: paymentId,
              status: PaymentStatus.REPORTED,
              enrollmentId,
              confirmedAt: null,
              reviewedAt: null,
              reviewedById: null,
              activationIssue: null,
            },
          ])
          .mockResolvedValueOnce([
            {
              id: enrollmentId,
              status: EnrollmentStatus.PENDING_PAYMENT,
              classId,
            },
          ]);

        prisma.enrollment.count.mockResolvedValue(5); // Full

        const result = await service.confirmPayment(paymentId, adminId);

        expect(result.status).toBe(PaymentStatus.CONFIRMED);
        expect(result.activationIssue).toBe(PaymentActivationIssue.CLASS_FULL);
        expect(result.enrollment.status).toBe(EnrollmentStatus.PENDING_PAYMENT);

        expect(
          emailService.sendPaymentPendingActivationEmail,
        ).toHaveBeenCalledTimes(1);
        expect(
          emailService.sendPaymentPendingActivationEmail,
        ).toHaveBeenCalledWith(
          'student@domain.test',
          expect.objectContaining({
            studentName: 'Nguyen Van Test',
            className: 'React Fullstack Pro',
            courseTitle: 'React Mastery',
            transferCode: 'BT-200',
          }),
        );
        // Web push MUST NOT be sent for pending activation
        expect(notificationsService.sendPushToUser).not.toHaveBeenCalled();
      });

      it('first confirm with CLASS_NOT_ELIGIBLE sends pending email only', async () => {
        prisma.payment.findUnique
          .mockResolvedValueOnce({
            id: paymentId,
            enrollmentId,
            enrollment: { id: enrollmentId, classId },
          })
          .mockResolvedValueOnce(
            buildMockDetail({
              activationIssue: PaymentActivationIssue.CLASS_NOT_ELIGIBLE,
              enrollment: {
                id: enrollmentId,
                status: EnrollmentStatus.PENDING_PAYMENT,
                joinedAt: new Date(),
                user: {
                  id: studentId,
                  email: 'student@domain.test',
                  profile: { fullName: 'Nguyen Van Test' },
                },
                class: {
                  id: classId,
                  name: 'React Fullstack Pro',
                  tuitionFeeVnd: 2000000,
                  course: { id: 9, title: 'React Mastery' },
                },
              },
            }),
          );

        prisma.$queryRaw
          .mockResolvedValueOnce([
            { id: classId, status: ClassStatus.ONGOING, capacity: 20 },
          ])
          .mockResolvedValueOnce([
            {
              id: paymentId,
              status: PaymentStatus.REPORTED,
              enrollmentId,
              confirmedAt: null,
              reviewedAt: null,
              reviewedById: null,
              activationIssue: null,
            },
          ])
          .mockResolvedValueOnce([
            {
              id: enrollmentId,
              status: EnrollmentStatus.PENDING_PAYMENT,
              classId,
            },
          ]);

        const result = await service.confirmPayment(paymentId, adminId);

        expect(result.status).toBe(PaymentStatus.CONFIRMED);
        expect(result.activationIssue).toBe(
          PaymentActivationIssue.CLASS_NOT_ELIGIBLE,
        );

        expect(
          emailService.sendPaymentPendingActivationEmail,
        ).toHaveBeenCalledTimes(1);
        expect(notificationsService.sendPushToUser).not.toHaveBeenCalled();
      });
    });

    type ServiceWithInternals = {
      tryClaimAndDispatchActivation: (
        event: typeof sampleDescriptor,
      ) => Promise<void>;
    };

    describe('Section 35: Activation Claim Concurrency', () => {
      it('under two concurrent activation claim attempts, exactly one acquires claim and dispatches', async () => {
        // First claim attempt wins (returns 1 row), second attempt loses (returns 0 rows)
        prisma.$queryRaw
          .mockResolvedValueOnce([{ id: paymentId }]) // Winner
          .mockResolvedValueOnce([]); // Loser

        const internalService = service as unknown as ServiceWithInternals;
        const promise1 =
          internalService.tryClaimAndDispatchActivation(sampleDescriptor);
        const promise2 =
          internalService.tryClaimAndDispatchActivation(sampleDescriptor);

        await Promise.all([promise1, promise2]);

        // Exactly one application dispatch attempt across both
        expect(emailService.sendPaymentActivatedEmail).toHaveBeenCalledTimes(1);
        expect(notificationsService.sendPushToUser).toHaveBeenCalledTimes(1);
      });
    });

    describe('Section 36: Claim Revalidation', () => {
      it('stale event descriptor cannot claim or send notification if DB state no longer qualifies', async () => {
        // Event descriptor claims activation happened, but DB query fails EXISTS or status match (returns 0 rows)
        prisma.$queryRaw.mockResolvedValueOnce([]);

        const internalService = service as unknown as ServiceWithInternals;
        await internalService.tryClaimAndDispatchActivation(sampleDescriptor);

        expect(emailService.sendPaymentActivatedEmail).not.toHaveBeenCalled();
        expect(notificationsService.sendPushToUser).not.toHaveBeenCalled();
      });
    });

    describe('Section 37: Provider Failure Isolation', () => {
      it('activation succeeds even when both email and push providers fail', async () => {
        prisma.$queryRaw.mockResolvedValueOnce([{ id: paymentId }]);

        emailService.sendPaymentActivatedEmail.mockRejectedValueOnce(
          new Error('SMTP fatal error'),
        );
        notificationsService.sendPushToUser.mockResolvedValueOnce({
          sent: 0,
          failed: 1,
        });

        // Dispatch must catch all failures and not rethrow
        const internalService = service as unknown as ServiceWithInternals;
        await expect(
          internalService.tryClaimAndDispatchActivation(sampleDescriptor),
        ).resolves.not.toThrow();

        expect(emailService.sendPaymentActivatedEmail).toHaveBeenCalledTimes(1);
        expect(notificationsService.sendPushToUser).toHaveBeenCalledTimes(1);
      });
    });

    describe('Section 38: Claim Failure Semantics', () => {
      it('unexpected DB exception during post-commit claim does not throw or convert API to 500', async () => {
        prisma.payment.findUnique
          .mockResolvedValueOnce({
            id: paymentId,
            enrollmentId,
            enrollment: { id: enrollmentId, classId },
          })
          .mockResolvedValueOnce(buildMockDetail());

        prisma.$queryRaw
          .mockResolvedValueOnce([
            { id: classId, status: ClassStatus.UPCOMING, capacity: 20 },
          ])
          .mockResolvedValueOnce([
            {
              id: paymentId,
              status: PaymentStatus.REPORTED,
              enrollmentId,
              confirmedAt: null,
              reviewedAt: null,
              reviewedById: null,
              activationIssue: null,
            },
          ])
          .mockResolvedValueOnce([
            {
              id: enrollmentId,
              status: EnrollmentStatus.PENDING_PAYMENT,
              classId,
            },
          ])
          .mockRejectedValueOnce(new Error('PostgreSQL connection dropped')); // Claim failure!

        prisma.enrollment.count.mockResolvedValue(2);

        // Financial operation must still return success
        const result = await service.confirmPayment(paymentId, adminId);

        expect(result.status).toBe(PaymentStatus.CONFIRMED);
        expect(result.enrollment.status).toBe(EnrollmentStatus.ACTIVE);
        // Notification providers not called because claim failed
        expect(emailService.sendPaymentActivatedEmail).not.toHaveBeenCalled();
        expect(notificationsService.sendPushToUser).not.toHaveBeenCalled();
      });
    });
  });
});
