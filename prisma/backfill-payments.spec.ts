import { runPaymentBackfill } from './backfill-payments';
import { EnrollmentStatus, PaymentStatus } from '@prisma/client';

describe('Historical Payment Backfill Unit Tests', () => {
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          db: 'kltn_test_db',
          schema: 'public',
          server_addr: '127.0.0.1',
          server_port: 5432,
        },
      ]),
      enrollment: {
        findMany: jest.fn(),
      },
      payment: {
        create: jest.fn(),
        findUnique: jest.fn(),
      },
    };
  });

  // 1. Valid candidate: PENDING_PAYMENT, tuitionFeeVnd > 0, no payment -> creates exactly one Payment
  it('Case A: Valid candidate creates Payment with tuition snapshot and deterministic transferCode', async () => {
    mockPrisma.enrollment.findMany.mockResolvedValue([
      {
        id: 101,
        userId: 1,
        classId: 10,
        status: EnrollmentStatus.PENDING_PAYMENT,
        payment: null,
        class: {
          id: 10,
          tuitionFeeVnd: 500000,
        },
      },
    ]);
    mockPrisma.payment.create.mockResolvedValue({
      id: 1,
      enrollmentId: 101,
      amountVnd: 500000,
      transferCode: 'BT-101',
      status: PaymentStatus.PENDING,
    });

    const result = await runPaymentBackfill({ prismaClient: mockPrisma });

    expect(result.totalCandidates).toBe(1);
    expect(result.createdCount).toBe(1);
    expect(result.inconsistentCount).toBe(0);
    expect(result.skippedCount).toBe(0);
    expect(result.errorCount).toBe(0);
    expect(mockPrisma.payment.create).toHaveBeenCalledWith({
      data: {
        enrollmentId: 101,
        amountVnd: 500000,
        transferCode: 'BT-101',
        status: PaymentStatus.PENDING,
      },
    });
  });

  // 2. Existing payment excluded by query
  it('Case B: Existing payment already present -> findMany query returns 0 candidates', async () => {
    mockPrisma.enrollment.findMany.mockResolvedValue([]);

    const result = await runPaymentBackfill({ prismaClient: mockPrisma });

    expect(result.totalCandidates).toBe(0);
    expect(result.createdCount).toBe(0);
    expect(mockPrisma.payment.create).not.toHaveBeenCalled();
  });

  // 3. Inconsistent candidate: tuitionFeeVnd = 0
  it('Case C: PENDING_PAYMENT with tuitionFeeVnd = 0 -> classified as inconsistent, no Payment created', async () => {
    mockPrisma.enrollment.findMany.mockResolvedValue([
      {
        id: 102,
        userId: 2,
        classId: 11,
        status: EnrollmentStatus.PENDING_PAYMENT,
        payment: null,
        class: {
          id: 11,
          tuitionFeeVnd: 0,
        },
      },
    ]);

    const result = await runPaymentBackfill({ prismaClient: mockPrisma });

    expect(result.totalCandidates).toBe(1);
    expect(result.createdCount).toBe(0);
    expect(result.inconsistentCount).toBe(1);
    expect(result.errorCount).toBe(0);
    expect(mockPrisma.payment.create).not.toHaveBeenCalled();
  });

  // 4. Inconsistent candidate: tuitionFeeVnd < 0
  it('Case D: PENDING_PAYMENT with tuitionFeeVnd < 0 -> classified as inconsistent, no Payment created', async () => {
    mockPrisma.enrollment.findMany.mockResolvedValue([
      {
        id: 103,
        userId: 3,
        classId: 12,
        status: EnrollmentStatus.PENDING_PAYMENT,
        payment: null,
        class: {
          id: 12,
          tuitionFeeVnd: -100000,
        },
      },
    ]);

    const result = await runPaymentBackfill({ prismaClient: mockPrisma });

    expect(result.totalCandidates).toBe(1);
    expect(result.createdCount).toBe(0);
    expect(result.inconsistentCount).toBe(1);
    expect(result.errorCount).toBe(0);
    expect(mockPrisma.payment.create).not.toHaveBeenCalled();
  });

  // 5. ACTIVE, COMPLETED, DROPPED are filtered by query criteria
  it('Cases E, F, G: findMany strictly queries PENDING_PAYMENT with payment = null', async () => {
    mockPrisma.enrollment.findMany.mockResolvedValue([]);

    await runPaymentBackfill({ prismaClient: mockPrisma });

    expect(mockPrisma.enrollment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: EnrollmentStatus.PENDING_PAYMENT,
          payment: null,
        },
      }),
    );
  });

  // 6. Dry run mode: performs zero database writes
  it('Dry-run: candidate evaluated and counted as prospective creation, but payment.create is NOT called', async () => {
    mockPrisma.enrollment.findMany.mockResolvedValue([
      {
        id: 104,
        userId: 4,
        classId: 13,
        status: EnrollmentStatus.PENDING_PAYMENT,
        payment: null,
        class: {
          id: 13,
          tuitionFeeVnd: 800000,
        },
      },
    ]);

    const result = await runPaymentBackfill({
      dryRun: true,
      prismaClient: mockPrisma,
    });

    expect(result.totalCandidates).toBe(1);
    expect(result.createdCount).toBe(1);
    expect(mockPrisma.payment.create).not.toHaveBeenCalled();
  });

  // 7. Idempotency: second run finds 0 candidates or creates 0 rows
  it('Case H: Second run with all payments already created results in createdCount = 0', async () => {
    mockPrisma.enrollment.findMany.mockResolvedValue([]);

    const result = await runPaymentBackfill({ prismaClient: mockPrisma });

    expect(result.totalCandidates).toBe(0);
    expect(result.createdCount).toBe(0);
    expect(mockPrisma.payment.create).not.toHaveBeenCalled();
  });

  // 8. Hardened P2002 handling: consistent existing Payment classified as safe skip
  it('P2002 Concurrent Race: consistent existing payment classified as safe skip', async () => {
    mockPrisma.enrollment.findMany.mockResolvedValue([
      {
        id: 105,
        userId: 5,
        classId: 14,
        status: EnrollmentStatus.PENDING_PAYMENT,
        payment: null,
        class: {
          id: 14,
          tuitionFeeVnd: 1200000,
        },
      },
    ]);

    const p2002Error: any = new Error('Unique constraint failed');
    p2002Error.code = 'P2002';
    mockPrisma.payment.create.mockRejectedValue(p2002Error);

    mockPrisma.payment.findUnique.mockResolvedValue({
      id: 55,
      enrollmentId: 105,
      transferCode: 'BT-105',
      amountVnd: 1200000,
      status: PaymentStatus.PENDING,
    });

    const result = await runPaymentBackfill({ prismaClient: mockPrisma });

    expect(result.totalCandidates).toBe(1);
    expect(result.createdCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.errorCount).toBe(0);
  });

  // 9. Hardened P2002 handling: inconsistent existing payment classified as unexpected error
  it('P2002 Collision Mismatch: inconsistent payment data classified as error, not safe skip', async () => {
    mockPrisma.enrollment.findMany.mockResolvedValue([
      {
        id: 106,
        userId: 6,
        classId: 15,
        status: EnrollmentStatus.PENDING_PAYMENT,
        payment: null,
        class: {
          id: 15,
          tuitionFeeVnd: 900000,
        },
      },
    ]);

    const p2002Error: any = new Error('Unique constraint failed');
    p2002Error.code = 'P2002';
    mockPrisma.payment.create.mockRejectedValue(p2002Error);

    // Existing payment has wrong amount or wrong transfer code
    mockPrisma.payment.findUnique.mockResolvedValue({
      id: 56,
      enrollmentId: 106,
      transferCode: 'BT-WRONG',
      amountVnd: 50000,
      status: PaymentStatus.PENDING,
    });

    const result = await runPaymentBackfill({ prismaClient: mockPrisma });

    expect(result.totalCandidates).toBe(1);
    expect(result.createdCount).toBe(0);
    expect(result.skippedCount).toBe(0);
    expect(result.errorCount).toBe(1);
  });
});
