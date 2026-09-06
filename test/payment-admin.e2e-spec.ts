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

describe('Admin Payment Review, Detail, Reject & Concurrency (e2e)', () => {
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

  let adminUser: any;
  let adminUser2: any;
  let teacherUser: any;
  let studentUser: any;

  let tokenAdmin: string;
  let tokenAdmin2: string;
  let tokenTeacher: string;
  let tokenStudent: string;

  let testCourse: any;
  let testClass: any;

  // Fixture payments
  let paymentReported: any;
  let enrollmentReported: any;
  let paymentPending: any;
  let enrollmentPending: any;
  let paymentConfirmed: any;
  let enrollmentConfirmed: any;
  let paymentReviewRequired: any;
  let enrollmentReviewRequired: any;
  let paymentForConcurrent: any;
  let enrollmentForConcurrent: any;

  let makeToken: (user: any) => string;

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
      `[SAFETY FUSE PASSED] Running Admin Payment E2E suite against verified test DB: ${dbInfo.db}.${dbInfo.schema}`,
    );

    // 2. Setup Users
    adminUser = await prisma.user.upsert({
      where: { email: 'e2e_admin_payment_reviewer@breadtrans.com' },
      update: {},
      create: {
        email: 'e2e_admin_payment_reviewer@breadtrans.com',
        password: 'hashed_password_123',
        role: Role.ADMIN,
        profile: {
          create: {
            fullName: 'Admin Reviewer One',
          },
        },
      },
      include: { profile: true },
    });

    adminUser2 = await prisma.user.upsert({
      where: { email: 'e2e_admin_payment_reviewer2@breadtrans.com' },
      update: {},
      create: {
        email: 'e2e_admin_payment_reviewer2@breadtrans.com',
        password: 'hashed_password_123',
        role: Role.ADMIN,
        profile: {
          create: {
            fullName: 'Admin Reviewer Two',
          },
        },
      },
      include: { profile: true },
    });

    teacherUser = await prisma.user.upsert({
      where: { email: 'e2e_teacher_payment_denied@breadtrans.com' },
      update: {},
      create: {
        email: 'e2e_teacher_payment_denied@breadtrans.com',
        password: 'hashed_password_123',
        role: Role.TEACHER,
        profile: {
          create: {
            fullName: 'Teacher Denied',
          },
        },
      },
      include: { profile: true },
    });

    studentUser = await prisma.user.upsert({
      where: { email: 'e2e_student_payment_target@breadtrans.com' },
      update: {
        profile: {
          upsert: {
            create: {
              fullName: 'Target Student Name',
              phone: '0912345678',
            },
            update: {
              fullName: 'Target Student Name',
              phone: '0912345678',
            },
          },
        },
      },
      create: {
        email: 'e2e_student_payment_target@breadtrans.com',
        password: 'hashed_password_123',
        role: Role.STUDENT,
        profile: {
          create: {
            fullName: 'Target Student Name',
            phone: '0912345678',
          },
        },
      },
      include: { profile: true },
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

    tokenAdmin = makeToken(adminUser);
    tokenAdmin2 = makeToken(adminUser2);
    tokenTeacher = makeToken(teacherUser);
    tokenStudent = makeToken(studentUser);

    // 3. Setup Course and Class
    testCourse = await prisma.course.create({
      data: {
        title: 'E2E Admin Payment Test Course',
        description: 'Testing admin payment review and reject',
        status: CourseStatus.PUBLISHED,
        level: 'BEGINNER',
        teacherId: teacherUser.id,
      },
    });

    const createTestClass = async (name: string) => {
      return prisma.class.create({
        data: {
          courseId: testCourse.id,
          teacherId: teacherUser.id,
          name,
          tuitionFeeVnd: 1200000,
          capacity: 25,
          status: ClassStatus.UPCOMING,
          meetingLink: 'https://breadtrans.com/meet/secret-class-link',
        },
      });
    };

    testClass = await createTestClass('E2E Reported Class');
    const classPending = await createTestClass('E2E Pending Class');
    const classConfirmed = await createTestClass('E2E Confirmed Class');
    const classReviewRequired = await createTestClass(
      'E2E Review Required Class',
    );
    const classForConcurrent = await createTestClass('E2E Concurrent Class');

    // 4. Setup Fixture Payments across all states
    // A. REPORTED Payment (primary reject target)
    enrollmentReported = await prisma.enrollment.create({
      data: {
        userId: studentUser.id,
        classId: testClass.id,
        status: EnrollmentStatus.PENDING_PAYMENT,
      },
    });
    paymentReported = await prisma.payment.create({
      data: {
        enrollmentId: enrollmentReported.id,
        amountVnd: 1200000,
        transferCode: `BT-E2E-REP-${crypto.randomBytes(3).toString('hex')}`,
        status: PaymentStatus.REPORTED,
        reportedAt: new Date(Date.now() - 3600000),
      },
    });

    // B. PENDING Payment
    enrollmentPending = await prisma.enrollment.create({
      data: {
        userId: studentUser.id,
        classId: classPending.id,
        status: EnrollmentStatus.PENDING_PAYMENT,
      },
    });
    paymentPending = await prisma.payment.create({
      data: {
        enrollmentId: enrollmentPending.id,
        amountVnd: 1200000,
        transferCode: `BT-E2E-PEN-${crypto.randomBytes(3).toString('hex')}`,
        status: PaymentStatus.PENDING,
      },
    });

    // C. CONFIRMED Payment
    enrollmentConfirmed = await prisma.enrollment.create({
      data: {
        userId: studentUser.id,
        classId: classConfirmed.id,
        status: EnrollmentStatus.ACTIVE,
      },
    });
    paymentConfirmed = await prisma.payment.create({
      data: {
        enrollmentId: enrollmentConfirmed.id,
        amountVnd: 1200000,
        transferCode: `BT-E2E-CNF-${crypto.randomBytes(3).toString('hex')}`,
        status: PaymentStatus.CONFIRMED,
        reportedAt: new Date(Date.now() - 7200000),
        confirmedAt: new Date(Date.now() - 3600000),
      },
    });

    // D. REVIEW_REQUIRED Payment
    enrollmentReviewRequired = await prisma.enrollment.create({
      data: {
        userId: studentUser.id,
        classId: classReviewRequired.id,
        status: EnrollmentStatus.PENDING_PAYMENT,
      },
    });
    paymentReviewRequired = await prisma.payment.create({
      data: {
        enrollmentId: enrollmentReviewRequired.id,
        amountVnd: 1200000,
        transferCode: `BT-E2E-REV-${crypto.randomBytes(3).toString('hex')}`,
        status: PaymentStatus.REVIEW_REQUIRED,
        reportedAt: new Date(Date.now() - 5000000),
      },
    });

    // E. Target for Concurrent Rejection
    enrollmentForConcurrent = await prisma.enrollment.create({
      data: {
        userId: studentUser.id,
        classId: classForConcurrent.id,
        status: EnrollmentStatus.PENDING_PAYMENT,
      },
    });
    paymentForConcurrent = await prisma.payment.create({
      data: {
        enrollmentId: enrollmentForConcurrent.id,
        amountVnd: 1200000,
        transferCode: `BT-E2E-CONC-${crypto.randomBytes(3).toString('hex')}`,
        status: PaymentStatus.REPORTED,
        reportedAt: new Date(Date.now() - 1800000),
      },
    });
  });

  afterAll(async () => {
    process.env.PAYMENT_BANK_BIN = originalEnv.PAYMENT_BANK_BIN;
    process.env.PAYMENT_BANK_NAME = originalEnv.PAYMENT_BANK_NAME;
    process.env.PAYMENT_BANK_ACCOUNT_NUMBER =
      originalEnv.PAYMENT_BANK_ACCOUNT_NUMBER;
    process.env.PAYMENT_BANK_ACCOUNT_NAME =
      originalEnv.PAYMENT_BANK_ACCOUNT_NAME;

    // Teardown test fixtures
    try {
      if (prisma) {
        const pIds = [
          paymentReported?.id,
          paymentPending?.id,
          paymentConfirmed?.id,
          paymentReviewRequired?.id,
          paymentForConcurrent?.id,
        ].filter(Boolean);

        if (pIds.length > 0) {
          await prisma.payment.deleteMany({ where: { id: { in: pIds } } });
        }

        const eIds = [
          enrollmentReported?.id,
          enrollmentPending?.id,
          enrollmentConfirmed?.id,
          enrollmentReviewRequired?.id,
          enrollmentForConcurrent?.id,
        ].filter(Boolean);

        if (eIds.length > 0) {
          await prisma.enrollment.deleteMany({ where: { id: { in: eIds } } });
        }

        if (testCourse?.id) {
          await prisma.payment.deleteMany({
            where: { enrollment: { class: { courseId: testCourse.id } } },
          });
          await prisma.enrollment.deleteMany({
            where: { class: { courseId: testCourse.id } },
          });
          await prisma.class.deleteMany({ where: { courseId: testCourse.id } });
          await prisma.course.delete({ where: { id: testCourse.id } });
        }
        if (teacherUser?.id) {
          await prisma.payment.deleteMany({
            where: { enrollment: { class: { teacherId: teacherUser.id } } },
          });
          await prisma.enrollment.deleteMany({
            where: { class: { teacherId: teacherUser.id } },
          });
          await prisma.class.deleteMany({
            where: { teacherId: teacherUser.id },
          });
        }

        const uIds = [
          adminUser?.id,
          adminUser2?.id,
          teacherUser?.id,
          studentUser?.id,
        ].filter(Boolean);

        if (uIds.length > 0) {
          await prisma.profile.deleteMany({ where: { userId: { in: uIds } } });
          await prisma.user.deleteMany({ where: { id: { in: uIds } } });
        }
      }
    } catch (err) {
      console.warn('E2E teardown error:', err);
    }

    if (app) {
      await app.close();
    }
  });

  // =========================================================================
  // 1-4. AUTHORIZATION & NAMESPACE CHECKS
  // =========================================================================
  describe('1-4. Authorization & Namespace on /admin/payments', () => {
    it('1. Admin GET /admin/payments succeeds with 200', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/payments')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200);

      expect(res.body.statusCode).toBe(200);
      expect(res.body.data.items).toBeInstanceOf(Array);
      expect(res.body.data.pagination).toBeDefined();
    });

    it('2. Student gets 403 Forbidden on /admin/payments', async () => {
      await request(app.getHttpServer())
        .get('/admin/payments')
        .set('Authorization', `Bearer ${tokenStudent}`)
        .expect(403);
    });

    it('3. Teacher gets 403 Forbidden on /admin/payments', async () => {
      await request(app.getHttpServer())
        .get('/admin/payments')
        .set('Authorization', `Bearer ${tokenTeacher}`)
        .expect(403);
    });

    it('4. Unauthenticated request gets 401 Unauthorized on /admin/payments', async () => {
      await request(app.getHttpServer()).get('/admin/payments').expect(401);
    });
  });

  // =========================================================================
  // 5-7. FILTERING, SEARCH & DETERMINISTIC ORDERING
  // =========================================================================
  describe('5-7. Queue Filtering & Ordering', () => {
    it('5. REPORTED filter returns only REPORTED payments', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/payments?status=REPORTED')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200);

      const items = res.body.data.items;
      expect(items.length).toBeGreaterThanOrEqual(1);
      for (const item of items) {
        expect(item.status).toBe(PaymentStatus.REPORTED);
      }
    });

    it('6. REVIEW_REQUIRED filter returns only REVIEW_REQUIRED payments', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/payments?status=REVIEW_REQUIRED')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200);

      const items = res.body.data.items;
      expect(items.length).toBeGreaterThanOrEqual(1);
      for (const item of items) {
        expect(item.status).toBe(PaymentStatus.REVIEW_REQUIRED);
      }
    });

    it('7. Ordering is deterministic with createdAt: desc, id: desc', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/payments?limit=50')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200);

      const items = res.body.data.items;
      for (let i = 0; i < items.length - 1; i++) {
        const timeA = new Date(items[i].createdAt).getTime();
        const timeB = new Date(items[i + 1].createdAt).getTime();
        if (timeA === timeB) {
          expect(items[i].id).toBeGreaterThan(items[i + 1].id);
        } else {
          expect(timeA).toBeGreaterThanOrEqual(timeB);
        }
      }
    });
  });

  // =========================================================================
  // 8-9. ADMIN DETAIL API
  // =========================================================================
  describe('8-9. GET /admin/payments/:id Detail', () => {
    it('8. Admin detail returns financial snapshot, student phone, and enrollment context', async () => {
      const res = await request(app.getHttpServer())
        .get(`/admin/payments/${paymentReported.id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200);

      const detail = res.body.data;
      expect(detail.id).toBe(paymentReported.id);
      expect(detail.amountVnd).toBe(1200000);
      expect(detail.transferCode).toBe(paymentReported.transferCode);
      expect(detail.student.email).toBe(studentUser.email);
      expect(detail.student.phone).toBe('0912345678');
      expect(detail.enrollment.id).toBe(enrollmentReported.id);
      expect(detail.enrollment.status).toBe(EnrollmentStatus.PENDING_PAYMENT);
      expect(detail.class.tuitionFeeVnd).toBe(1200000);
      expect(detail.bankInstructions).toBeDefined();
    });

    it('9. Detail on non-existent payment returns 404 Not Found', async () => {
      await request(app.getHttpServer())
        .get('/admin/payments/99999999')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(404);
    });
  });

  // =========================================================================
  // 10-23. REJECT STATE TRANSITION & INVARIANTS
  // =========================================================================
  describe('10-23. Rejection State Machine & Invariants', () => {
    const validRejectReason =
      'Không tìm thấy giao dịch ngân hàng khớp số tiền 1,200,000 VND trong sao kê ngày hôm nay.';

    it('10. Reject REPORTED returns exact HTTP 200 (not 201)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/admin/payments/${paymentReported.id}/reject`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ reason: validRejectReason })
        .expect(200);

      expect(res.body.statusCode).toBe(200);
      expect(res.body.data.status).toBe(PaymentStatus.REJECTED);
      expect(res.body.data.adminNote).toBe(validRejectReason);
    });

    it('11-17. Verifies authoritative database state after rejection', async () => {
      const updated = await prisma.payment.findUnique({
        where: { id: paymentReported.id },
      });

      expect(updated).not.toBeNull();
      // 11. DB status becomes REJECTED
      expect(updated!.status).toBe(PaymentStatus.REJECTED);
      // 12. reviewedById = authenticated Admin
      expect(updated!.reviewedById).toBe(adminUser.id);
      // 13. reviewedAt is non-null
      expect(updated!.reviewedAt).not.toBeNull();
      // 14. adminNote = submitted reason
      expect(updated!.adminNote).toBe(validRejectReason);
      // 15. amountVnd unchanged
      expect(updated!.amountVnd).toBe(1200000);
      // 16. transferCode unchanged
      expect(updated!.transferCode).toBe(paymentReported.transferCode);
      // 17. reportedAt unchanged
      expect(new Date(updated!.reportedAt!).getTime()).toBe(
        new Date(paymentReported.reportedAt).getTime(),
      );
    });

    it('18-21. Enrollment invariant: Enrollment remains PENDING_PAYMENT, student denied class access', async () => {
      const enrollment = await prisma.enrollment.findUnique({
        where: { id: enrollmentReported.id },
      });

      // 18. Enrollment status MUST remain PENDING_PAYMENT
      expect(enrollment!.status).toBe(EnrollmentStatus.PENDING_PAYMENT);

      // 19. Private class access remains 403 Forbidden for Student
      await request(app.getHttpServer())
        .get(`/courses/classes/${testClass.id}`)
        .set('Authorization', `Bearer ${tokenStudent}`)
        .expect(403);

      // 20. meetingLink remains null for Student learning view on GET /courses
      const coursesRes = await request(app.getHttpServer())
        .get('/courses')
        .set('Authorization', `Bearer ${tokenStudent}`)
        .expect(200);
      const rawCourses =
        (
          coursesRes.body as {
            data?: Array<{ classId: number; meetingLink: string | null }>;
          }
        ).data ||
        (coursesRes.body as Array<{
          classId: number;
          meetingLink: string | null;
        }>);
      const studentClassView = rawCourses.find(
        (c) => c.classId === testClass.id,
      );
      if (studentClassView) {
        expect(studentClassView.meetingLink).toBeNull();
      }

      // 21. ACTIVE capacity count remains unchanged (0 active enrollments in testClass)
      const activeEnrollments = await prisma.enrollment.count({
        where: {
          classId: testClass.id,
          status: EnrollmentStatus.ACTIVE,
        },
      });
      expect(activeEnrollments).toBe(0);
    });

    it('22-23. Student privacy regression: Student sees REJECTED status but NOT internal review metadata', async () => {
      // 22. Student sees status = REJECTED on /payments/:id
      const res = await request(app.getHttpServer())
        .get(`/payments/${paymentReported.id}`)
        .set('Authorization', `Bearer ${tokenStudent}`)
        .expect(200);

      const studentView = res.body.data;
      expect(studentView.status).toBe(PaymentStatus.REJECTED);

      // 23. Student does NOT receive adminNote, reviewedById, reviewedAt
      expect(studentView.adminNote).toBeUndefined();
      expect(studentView.reviewedById).toBeUndefined();
      expect(studentView.reviewedAt).toBeUndefined();
      expect(studentView.reviewedBy).toBeUndefined();

      // Student /payments/me check
      const meRes = await request(app.getHttpServer())
        .get('/payments/me')
        .set('Authorization', `Bearer ${tokenStudent}`)
        .expect(200);

      const meList = (
        meRes.body as {
          data: Array<{
            id: number;
            status: PaymentStatus;
            adminNote?: string;
            reviewedById?: number;
            reviewedAt?: Date;
          }>;
        }
      ).data;
      const targetInMe = meList.find((p) => p.id === paymentReported.id);
      expect(targetInMe).toBeDefined();
      expect(targetInMe!.status).toBe(PaymentStatus.REJECTED);
      expect(targetInMe!.adminNote).toBeUndefined();
      expect(targetInMe!.reviewedById).toBeUndefined();
      expect(targetInMe!.reviewedAt).toBeUndefined();
    });
  });

  // =========================================================================
  // 24-28. INVALID REJECT STATES & IMMUTABILITY
  // =========================================================================
  describe('24-28. Conflict Rejections on Non-REPORTED Payments', () => {
    const reason = 'Lý do từ chối kiểm thử';

    it('24. PENDING reject returns 409 Conflict', async () => {
      await request(app.getHttpServer())
        .post(`/admin/payments/${paymentPending.id}/reject`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ reason })
        .expect(409);
    });

    it('25. CONFIRMED reject returns 409 Conflict', async () => {
      await request(app.getHttpServer())
        .post(`/admin/payments/${paymentConfirmed.id}/reject`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ reason })
        .expect(409);
    });

    it('26. REVIEW_REQUIRED reject returns 409 Conflict', async () => {
      await request(app.getHttpServer())
        .post(`/admin/payments/${paymentReviewRequired.id}/reject`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ reason })
        .expect(409);
    });

    it('27. Duplicate REJECTED reject returns 409 Conflict', async () => {
      // paymentReported is already REJECTED from test 10
      await request(app.getHttpServer())
        .post(`/admin/payments/${paymentReported.id}/reject`)
        .set('Authorization', `Bearer ${tokenAdmin2}`)
        .send({ reason: 'Admin 2 attempting overwrite' })
        .expect(409);
    });

    it('28. Duplicate rejection preserves original reviewer, note, and timestamp', async () => {
      const payment = await prisma.payment.findUnique({
        where: { id: paymentReported.id },
      });

      expect(payment!.status).toBe(PaymentStatus.REJECTED);
      expect(payment!.reviewedById).toBe(adminUser.id); // Still Admin 1
      expect(payment!.adminNote).not.toContain('Admin 2'); // Original note preserved
    });
  });

  // =========================================================================
  // 29-30. VALIDATION & DATA TAMPERING PROTECTION
  // =========================================================================
  describe('29-30. Input Validation & Whitelist Protection', () => {
    it('29. Reason validation: < 5 chars, > 500 chars, or empty returns 400 Bad Request', async () => {
      // Too short (< 5 chars)
      await request(app.getHttpServer())
        .post(`/admin/payments/${paymentReported.id}/reject`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ reason: 'abc' })
        .expect(400);

      // Only whitespace
      await request(app.getHttpServer())
        .post(`/admin/payments/${paymentReported.id}/reject`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ reason: '     ' })
        .expect(400);

      // Too long (> 500 chars)
      const tooLongReason = 'x'.repeat(501);
      await request(app.getHttpServer())
        .post(`/admin/payments/${paymentReported.id}/reject`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ reason: tooLongReason })
        .expect(400);

      // Missing reason
      await request(app.getHttpServer())
        .post(`/admin/payments/${paymentReported.id}/reject`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({})
        .expect(400);
    });

    it('30. Unauthorized body fields cannot control review metadata or status', async () => {
      // Create a fresh class and REPORTED payment to test whitelist filtering
      const tempClass = await prisma.class.create({
        data: {
          courseId: testCourse.id,
          teacherId: teacherUser.id,
          name: 'E2E Whitelist Test Class',
          tuitionFeeVnd: 1200000,
          capacity: 25,
          status: ClassStatus.UPCOMING,
        },
      });
      const tempEnrollment = await prisma.enrollment.create({
        data: {
          userId: studentUser.id,
          classId: tempClass.id,
          status: EnrollmentStatus.PENDING_PAYMENT,
        },
      });
      const tempPayment = await prisma.payment.create({
        data: {
          enrollmentId: tempEnrollment.id,
          amountVnd: 1200000,
          transferCode: `BT-WHITELIST-${crypto.randomBytes(3).toString('hex')}`,
          status: PaymentStatus.REPORTED,
          reportedAt: new Date(),
        },
      });

      await request(app.getHttpServer())
        .post(`/admin/payments/${tempPayment.id}/reject`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          reason: 'Lý do từ chối hợp lệ để kiểm tra whitelist',
          status: 'CONFIRMED',
          amountVnd: 0,
          transferCode: 'BT-TAMPERED',
          reviewedById: 9999,
        })
        .expect(200);

      const updated = await prisma.payment.findUnique({
        where: { id: tempPayment.id },
      });

      // Status must be REJECTED, not tampered CONFIRMED
      expect(updated!.status).toBe(PaymentStatus.REJECTED);
      // amountVnd must remain original 1200000
      expect(updated!.amountVnd).toBe(1200000);
      // transferCode must remain original
      expect(updated!.transferCode).toBe(tempPayment.transferCode);
      // reviewer must be authenticated admin, not spoofed 9999
      expect(updated!.reviewedById).toBe(adminUser.id);

      // Clean up temp fixtures
      await prisma.payment.delete({ where: { id: tempPayment.id } });
      await prisma.enrollment.delete({ where: { id: tempEnrollment.id } });
      await prisma.class.delete({ where: { id: tempClass.id } });
    });
  });

  // =========================================================================
  // 31. CONCURRENCY: TWO ADMINS REJECTING CONCURRENTLY
  // =========================================================================
  describe('31. Concurrency Protection on Simultaneous Rejections', () => {
    it('31. Exactly one admin gets 200, exactly one gets 409, final review is authoritative', async () => {
      const reasonAdmin1 = 'Admin 1: Biên lai không hợp lệ';
      const reasonAdmin2 = 'Admin 2: Không tìm thấy giao dịch';

      const results = await Promise.all([
        request(app.getHttpServer())
          .post(`/admin/payments/${paymentForConcurrent.id}/reject`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .send({ reason: reasonAdmin1 }),
        request(app.getHttpServer())
          .post(`/admin/payments/${paymentForConcurrent.id}/reject`)
          .set('Authorization', `Bearer ${tokenAdmin2}`)
          .send({ reason: reasonAdmin2 }),
      ]);

      const statuses = results.map((r) => r.status);
      expect(statuses).toContain(200);
      expect(statuses).toContain(409);

      // Verify the final record in database preserves the winner's note and id
      const winnerAdminId = statuses[0] === 200 ? adminUser.id : adminUser2.id;
      const winnerReason = statuses[0] === 200 ? reasonAdmin1 : reasonAdmin2;

      const finalPayment = await prisma.payment.findUnique({
        where: { id: paymentForConcurrent.id },
      });

      expect(finalPayment!.status).toBe(PaymentStatus.REJECTED);
      expect(finalPayment!.reviewedById).toBe(winnerAdminId);
      expect(finalPayment!.adminNote).toBe(winnerReason);
    });
  });
});
