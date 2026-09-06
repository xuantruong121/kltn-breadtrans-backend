import { Test, TestingModule } from '@nestjs/testing';
import { PaymentService, buildVietQrUrl } from './payment.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentStatus } from '@prisma/client';
import { NotFoundException, ConflictException } from '@nestjs/common';
import {
  STUDENT_PAYMENT_SUMMARY_SELECT,
  STUDENT_PAYMENT_DETAIL_SELECT,
} from './payment.constants';

describe('PaymentService', () => {
  let service: PaymentService;
  let prisma: any;
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
    const mockPrisma = {
      payment: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
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
    prisma = module.get<PrismaService>(PrismaService);
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
      expect((STUDENT_PAYMENT_SUMMARY_SELECT as any).reviewedById).toBeUndefined();
      expect((STUDENT_PAYMENT_SUMMARY_SELECT as any).adminNote).toBeUndefined();
      expect((STUDENT_PAYMENT_SUMMARY_SELECT as any).activationIssue).toBeUndefined();
      expect((STUDENT_PAYMENT_SUMMARY_SELECT as any).activationNotifiedAt).toBeUndefined();
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
});
