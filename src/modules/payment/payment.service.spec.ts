import { Test, TestingModule } from '@nestjs/testing';
import { PaymentService, buildVietQrUrl } from './payment.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PaymentStatus,
  EnrollmentStatus,
  ClassStatus,
  PaymentActivationIssue,
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

describe('PaymentService', () => {
  let service: PaymentService;
  let prisma: MockPrismaService;
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<PaymentService>(PaymentService);
    prisma = module.get<PrismaService>(
      PrismaService,
    ) as unknown as MockPrismaService;
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
        { id: paymentId, status: PaymentStatus.PENDING, reportedAt: null },
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
});
