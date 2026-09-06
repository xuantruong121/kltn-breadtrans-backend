import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import {
  Role,
  CourseStatus,
  ClassStatus,
  EnrollmentStatus,
  PaymentStatus,
} from '@prisma/client';
import { TransformInterceptor } from './../src/common/interceptors/transform.interceptor';
import * as crypto from 'crypto';

describe('Student Payment Lifecycle & Security & Concurrency (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  // Environment isolation snapshot
  const originalEnv = {
    PAYMENT_BANK_BIN: process.env.PAYMENT_BANK_BIN,
    PAYMENT_BANK_NAME: process.env.PAYMENT_BANK_NAME,
    PAYMENT_BANK_ACCOUNT_NUMBER: process.env.PAYMENT_BANK_ACCOUNT_NUMBER,
    PAYMENT_BANK_ACCOUNT_NAME: process.env.PAYMENT_BANK_ACCOUNT_NAME,
  };

  let studentA: any;
  let studentB: any;
  let teacherUser: any;

  let tokenStudentA: string;
  let tokenStudentB: string;
  let makeToken: (user: any) => string;

  let testCourse: any;
  let paidClass: any;
  let freeClass: any;

  let enrollmentA: any;
  let paymentA: any;
  let enrollmentB: any;
  let paymentB: any;
  let enrollmentFreeA: any;

  beforeAll(async () => {
    // 0. Safety Fuse: Refuse to run against any non-test database!
    const dbUrl = process.env.DATABASE_URL || '';
    const urlMatches =
      (dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1')) &&
      dbUrl.includes('5432') &&
      dbUrl.includes('kltn_test_db');

    if (!urlMatches) {
      throw new Error(
        `SAFETY FUSE TRIGGERED: Refusing to run destructive E2E tests outside isolated test DB! DATABASE_URL must point to localhost:5432/kltn_test_db. Current: ${dbUrl.replace(/:[^:@]+@/, ':***@')}`,
      );
    }

    // 1. Establish deterministic bank configuration BEFORE Nest module compilation
    process.env.PAYMENT_BANK_BIN = '970436';
    process.env.PAYMENT_BANK_NAME = 'Test Bank';
    process.env.PAYMENT_BANK_ACCOUNT_NUMBER = '1234567890';
    process.env.PAYMENT_BANK_ACCOUNT_NAME = 'BREADTRANS TEST CENTER';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    jwtService = app.get<JwtService>(JwtService);

    // Verify real PostgreSQL connection identity
    const [dbInfo] = await prisma.$queryRaw<
      Array<{ db: string; schema: string }>
    >`SELECT current_database() AS db, current_schema() AS schema;`;

    if (dbInfo?.db !== 'kltn_test_db' || dbInfo?.schema !== 'public') {
      throw new Error(
        `SAFETY FUSE ABORT: Connected PostgreSQL database is '${dbInfo?.db}' (schema: '${dbInfo?.schema}'). Must be kltn_test_db.public!`,
      );
    }
    console.log(
      `[SAFETY FUSE PASSED] Running Payment E2E suite against verified test DB: ${dbInfo.db}.${dbInfo.schema}`,
    );

    // 2. Setup Users
    studentA = await prisma.user.upsert({
      where: { email: 'e2e_payment_student_a@breadtrans.com' },
      update: {},
      create: {
        email: 'e2e_payment_student_a@breadtrans.com',
        password: 'hashed_password_123',
        role: Role.STUDENT,
      },
    });

    studentB = await prisma.user.upsert({
      where: { email: 'e2e_payment_student_b@breadtrans.com' },
      update: {},
      create: {
        email: 'e2e_payment_student_b@breadtrans.com',
        password: 'hashed_password_123',
        role: Role.STUDENT,
      },
    });

    teacherUser = await prisma.user.upsert({
      where: { email: 'e2e_payment_teacher@breadtrans.com' },
      update: {},
      create: {
        email: 'e2e_payment_teacher@breadtrans.com',
        password: 'hashed_password_123',
        role: Role.TEACHER,
      },
    });

    makeToken = (user: any) =>
      jwtService.sign({
        sub: user.id,
        email: user.email,
        role: user.role,
        deviceId: 'e2e-device',
        type: 'access',
        jti: crypto.randomUUID(),
      });

    tokenStudentA = makeToken(studentA);
    tokenStudentB = makeToken(studentB);

    // 3. Setup Course and Classes
    testCourse = await prisma.course.create({
      data: {
        title: 'E2E Payment Test Course',
        description: 'Testing student payment lifecycle',
        status: CourseStatus.PUBLISHED,
        level: 'BEGINNER',
        teacherId: teacherUser.id,
      },
    });

    paidClass = await prisma.class.create({
      data: {
        courseId: testCourse.id,
        teacherId: teacherUser.id,
        name: 'E2E Paid Class K1',
        tuitionFeeVnd: 1500000,
        capacity: 30,
        status: ClassStatus.UPCOMING,
      },
    });

    freeClass = await prisma.class.create({
      data: {
        courseId: testCourse.id,
        teacherId: teacherUser.id,
        name: 'E2E Free Class K1',
        tuitionFeeVnd: 0,
        capacity: 30,
        status: ClassStatus.UPCOMING,
      },
    });

    // 4. Create paid enrollments with atomic payments for Student A and Student B
    enrollmentA = await prisma.enrollment.create({
      data: {
        userId: studentA.id,
        classId: paidClass.id,
        status: EnrollmentStatus.PENDING_PAYMENT,
      },
    });

    paymentA = await prisma.payment.create({
      data: {
        enrollmentId: enrollmentA.id,
        amountVnd: 1500000,
        transferCode: `BT-${enrollmentA.id}`,
        status: PaymentStatus.PENDING,
      },
    });

    enrollmentB = await prisma.enrollment.create({
      data: {
        userId: studentB.id,
        classId: paidClass.id,
        status: EnrollmentStatus.PENDING_PAYMENT,
      },
    });

    paymentB = await prisma.payment.create({
      data: {
        enrollmentId: enrollmentB.id,
        amountVnd: 1500000,
        transferCode: `BT-${enrollmentB.id}`,
        status: PaymentStatus.PENDING,
      },
    });

    // 5. Create free active enrollment for Student A (No payment)
    enrollmentFreeA = await prisma.enrollment.create({
      data: {
        userId: studentA.id,
        classId: freeClass.id,
        status: EnrollmentStatus.ACTIVE,
      },
    });
  });

  afterAll(async () => {
    // Restore environment
    if (originalEnv.PAYMENT_BANK_BIN !== undefined) {
      process.env.PAYMENT_BANK_BIN = originalEnv.PAYMENT_BANK_BIN;
    } else {
      delete process.env.PAYMENT_BANK_BIN;
    }
    if (originalEnv.PAYMENT_BANK_NAME !== undefined) {
      process.env.PAYMENT_BANK_NAME = originalEnv.PAYMENT_BANK_NAME;
    } else {
      delete process.env.PAYMENT_BANK_NAME;
    }
    if (originalEnv.PAYMENT_BANK_ACCOUNT_NUMBER !== undefined) {
      process.env.PAYMENT_BANK_ACCOUNT_NUMBER =
        originalEnv.PAYMENT_BANK_ACCOUNT_NUMBER;
    } else {
      delete process.env.PAYMENT_BANK_ACCOUNT_NUMBER;
    }
    if (originalEnv.PAYMENT_BANK_ACCOUNT_NAME !== undefined) {
      process.env.PAYMENT_BANK_ACCOUNT_NAME =
        originalEnv.PAYMENT_BANK_ACCOUNT_NAME;
    } else {
      delete process.env.PAYMENT_BANK_ACCOUNT_NAME;
    }

    // Cleanup fixtures safely
    try {
      if (prisma) {
        if (paymentA?.id) {
          await prisma.payment
            .deleteMany({
              where: { id: { in: [paymentA.id, paymentB.id] } },
            })
            .catch(() => {});
        }
        if (enrollmentA?.id) {
          await prisma.enrollment
            .deleteMany({
              where: {
                id: { in: [enrollmentA.id, enrollmentB.id, enrollmentFreeA.id] },
              },
            })
            .catch(() => {});
        }
        if (paidClass?.id) {
          await prisma.class
            .deleteMany({
              where: { id: { in: [paidClass.id, freeClass.id] } },
            })
            .catch(() => {});
        }
        if (testCourse?.id) {
          await prisma.course
            .delete({ where: { id: testCourse.id } })
            .catch(() => {});
        }
        await prisma.user
          .deleteMany({
            where: {
              email: {
                in: [
                  'e2e_payment_student_a@breadtrans.com',
                  'e2e_payment_student_b@breadtrans.com',
                  'e2e_payment_teacher@breadtrans.com',
                ],
              },
            },
          })
          .catch(() => {});
      }
    } catch {}

    if (app) {
      await app.close();
    }
  });

  // ================= SCENARIOS =================

  it('1. GET /payments/me returns only Student A payments, ordered newest first', async () => {
    const res = await request(app.getHttpServer())
      .get('/payments/me')
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .expect(200);

    const body = res.body;
    expect(body.statusCode).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBe(1);
    expect(body.data[0].id).toBe(paymentA.id);
    expect(body.data[0].enrollmentId).toBe(enrollmentA.id);
    expect(body.data[0].amountVnd).toBe(1500000);
    expect(body.data[0].transferCode).toBe(`BT-${enrollmentA.id}`);
    expect(body.data[0].status).toBe(PaymentStatus.PENDING);
    expect(body.data[0].class.id).toBe(paidClass.id);
    expect(body.data[0].class.name).toBe('E2E Paid Class K1');
    expect(body.data[0].class.course.title).toBe('E2E Payment Test Course');

    // Verify information minimization: internal fields must NOT leak
    expect(body.data[0].reviewedById).toBeUndefined();
    expect(body.data[0].adminNote).toBeUndefined();
    expect(body.data[0].activationNotifiedAt).toBeUndefined();
    expect(body.data[0].activationIssue).toBeUndefined();
  });

  it('2. Static route order: GET /payments/me is not captured by :id route', async () => {
    const res = await request(app.getHttpServer())
      .get('/payments/me')
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .expect(200);

    expect(res.body.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('3. GET /payments/:id returns own payment with snapshot financial values', async () => {
    const res = await request(app.getHttpServer())
      .get(`/payments/${paymentA.id}`)
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .expect(200);

    const data = res.body.data;
    expect(data.id).toBe(paymentA.id);
    expect(data.amountVnd).toBe(1500000);
    expect(data.transferCode).toBe(`BT-${enrollmentA.id}`);
    expect(data.status).toBe(PaymentStatus.PENDING);
    expect(data.bankInstructions).toBeDefined();

    // Verify information minimization
    expect(data.reviewedById).toBeUndefined();
    expect(data.adminNote).toBeUndefined();
    expect(data.activationIssue).toBeUndefined();
  });

  it('4. Student B requesting Student A Payment receives 404 Not Found (IDOR prevention)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/payments/${paymentA.id}`)
      .set('Authorization', `Bearer ${tokenStudentB}`)
      .expect(404);

    expect(res.body.statusCode).toBe(404);
  });

  it('5. Financial snapshot invariant: Changing Class.tuitionFeeVnd does not alter Payment.amountVnd', async () => {
    // Directly modify Class tuition fee in DB
    await prisma.class.update({
      where: { id: paidClass.id },
      data: { tuitionFeeVnd: 9999999 },
    });

    const res = await request(app.getHttpServer())
      .get(`/payments/${paymentA.id}`)
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .expect(200);

    // Payment snapshot must still report the original 1500000
    expect(res.body.data.amountVnd).toBe(1500000);
    expect(res.body.data.bankInstructions.amountVnd).toBe(1500000);

    // Restore class fee
    await prisma.class.update({
      where: { id: paidClass.id },
      data: { tuitionFeeVnd: 1500000 },
    });
  });

  it('6. Bank instructions match deterministic test config', async () => {
    const res = await request(app.getHttpServer())
      .get(`/payments/${paymentA.id}`)
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .expect(200);

    const instructions = res.body.data.bankInstructions;
    expect(instructions.bin).toBe('970436');
    expect(instructions.bankName).toBe('Test Bank');
    expect(instructions.accountNumber).toBe('1234567890');
    expect(instructions.accountName).toBe('BREADTRANS TEST CENTER');
    expect(instructions.amountVnd).toBe(1500000);
    expect(instructions.transferCode).toBe(`BT-${enrollmentA.id}`);
  });

  it('7. VietQR contains Payment snapshot amount and transfer code properly URL-encoded', async () => {
    const res = await request(app.getHttpServer())
      .get(`/payments/${paymentA.id}`)
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .expect(200);

    const vietQrUrl = res.body.data.bankInstructions.vietQrUrl;
    expect(vietQrUrl).toBe(
      `https://img.vietqr.io/image/970436-1234567890-compact2.png?amount=1500000&addInfo=BT-${enrollmentA.id}&accountName=BREADTRANS+TEST+CENTER`,
    );
  });

  it('8. PENDING report-transfer returns HTTP 200 and transitions status to REPORTED', async () => {
    const res = await request(app.getHttpServer())
      .post(`/payments/${paymentA.id}/report-transfer`)
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .send({})
      .expect(200);

    expect(res.body.statusCode).toBe(200);
    expect(res.body.data.status).toBe(PaymentStatus.REPORTED);
  });

  it('9. reportedAt is server-generated and non-null', async () => {
    const res = await request(app.getHttpServer())
      .get(`/payments/${paymentA.id}`)
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .expect(200);

    expect(res.body.data.reportedAt).not.toBeNull();
    const reportedAtDate = new Date(res.body.data.reportedAt);
    expect(isNaN(reportedAtDate.getTime())).toBe(false);
  });

  it('10. Second report call returns HTTP 200 and reportedAt is unchanged (Idempotency)', async () => {
    const firstRes = await request(app.getHttpServer())
      .get(`/payments/${paymentA.id}`)
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .expect(200);

    const initialReportedAt = firstRes.body.data.reportedAt;

    // Call report-transfer again
    const secondRes = await request(app.getHttpServer())
      .post(`/payments/${paymentA.id}/report-transfer`)
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .send({})
      .expect(200);

    expect(secondRes.body.statusCode).toBe(200);
    expect(secondRes.body.data.status).toBe(PaymentStatus.REPORTED);
    expect(secondRes.body.data.reportedAt).toBe(initialReportedAt);
  });

  it('11. Concurrent report calls serialize and produce one stable REPORTED state', async () => {
    // Use Student B's fresh payment
    const [res1, res2] = await Promise.all([
      request(app.getHttpServer())
        .post(`/payments/${paymentB.id}/report-transfer`)
        .set('Authorization', `Bearer ${tokenStudentB}`)
        .send({}),
      request(app.getHttpServer())
        .post(`/payments/${paymentB.id}/report-transfer`)
        .set('Authorization', `Bearer ${tokenStudentB}`)
        .send({}),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res1.body.data.status).toBe(PaymentStatus.REPORTED);
    expect(res2.body.data.status).toBe(PaymentStatus.REPORTED);

    // Timestamp must be completely stable across both returns
    expect(res1.body.data.reportedAt).toBe(res2.body.data.reportedAt);
  });

  it('12. Learning access invariant: Enrollment remains PENDING_PAYMENT after report-transfer', async () => {
    const enrollment = await prisma.enrollment.findUnique({
      where: { id: enrollmentA.id },
    });

    expect(enrollment?.status).toBe(EnrollmentStatus.PENDING_PAYMENT);
  });

  it('13. ACTIVE seat count does not change because of report-transfer', async () => {
    const activeSeats = await prisma.enrollment.count({
      where: {
        classId: paidClass.id,
        status: EnrollmentStatus.ACTIVE,
      },
    });

    // Zero active seats because both student A and B are PENDING_PAYMENT
    expect(activeSeats).toBe(0);
  });

  it('14. Private Class access still returns 403 Forbidden for REPORTED payment student', async () => {
    await request(app.getHttpServer())
      .get(`/courses/classes/${paidClass.id}`)
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .expect(403);
  });

  it('15. meetingLink remains null in user classes list (/courses)', async () => {
    const res = await request(app.getHttpServer())
      .get('/courses')
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .expect(200);

    const classes = res.body.data;
    const paidClassEntry = classes.find((c: any) => c.classId === paidClass.id);
    expect(paidClassEntry).toBeDefined();
    expect(paidClassEntry.meetingLink).toBeNull();
    expect(paidClassEntry.enrollmentStatus).toBe(EnrollmentStatus.PENDING_PAYMENT);
  });

  it('16. Client body attempting status=CONFIRMED cannot alter payment or enrollment status', async () => {
    await request(app.getHttpServer())
      .post(`/payments/${paymentA.id}/report-transfer`)
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .send({
        status: 'CONFIRMED',
        enrollmentStatus: 'ACTIVE',
        amountVnd: 0,
      })
      .expect(200);

    const payment = await prisma.payment.findUnique({
      where: { id: paymentA.id },
    });
    expect(payment?.status).toBe(PaymentStatus.REPORTED);
    expect(payment?.amountVnd).toBe(1500000);

    const enrollment = await prisma.enrollment.findUnique({
      where: { id: enrollmentA.id },
    });
    expect(enrollment?.status).toBe(EnrollmentStatus.PENDING_PAYMENT);
  });

  it('17. Free ACTIVE Enrollment has no Payment and remains unaffected', async () => {
    const freePayment = await prisma.payment.findUnique({
      where: { enrollmentId: enrollmentFreeA.id },
    });
    expect(freePayment).toBeNull();

    // Free class meetingLink is accessible
    const res = await request(app.getHttpServer())
      .get('/courses')
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .expect(200);

    const freeClassEntry = res.body.data.find(
      (c: any) => c.classId === freeClass.id,
    );
    expect(freeClassEntry).toBeDefined();
    expect(freeClassEntry.enrollmentStatus).toBe(EnrollmentStatus.ACTIVE);
  });
});
