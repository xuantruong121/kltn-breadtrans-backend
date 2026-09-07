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
  PaymentActivationIssue,
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
  let studentUser2: any;

  let tokenAdmin: string;
  let tokenAdmin2: string;
  let tokenTeacher: string;
  let tokenStudent: string;
  let tokenStudent2: string;

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

    studentUser2 = await prisma.user.upsert({
      where: { email: 'e2e_student_payment_target2@breadtrans.com' },
      update: {
        profile: {
          upsert: {
            create: {
              fullName: 'Target Student Name Two',
              phone: '0912345679',
            },
            update: {
              fullName: 'Target Student Name Two',
              phone: '0912345679',
            },
          },
        },
      },
      create: {
        email: 'e2e_student_payment_target2@breadtrans.com',
        password: 'hashed_password_123',
        role: Role.STUDENT,
        profile: {
          create: {
            fullName: 'Target Student Name Two',
            phone: '0912345679',
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
    tokenStudent2 = makeToken(studentUser2);

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
          studentUser2?.id,
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

  // =========================================================================
  // PHASE 3C-5 ADMIN PAYMENT CONFIRMATION & ATOMIC ACTIVATION (E2E)
  // =========================================================================
  describe('Phase 3C-5: Admin Payment Confirmation & Atomic Enrollment Activation (e2e)', () => {
    // Helper to create disposable class
    const createClass = async (
      name: string,
      options: {
        capacity?: number | null;
        status?: ClassStatus;
        tuitionFeeVnd?: number;
      } = {},
    ) => {
      return prisma.class.create({
        data: {
          courseId: testCourse.id,
          teacherId: teacherUser.id,
          name,
          tuitionFeeVnd: options.tuitionFeeVnd ?? 1000000,
          capacity: options.capacity !== undefined ? options.capacity : 20,
          status: options.status ?? ClassStatus.UPCOMING,
          meetingLink: 'https://breadtrans.com/meet/phase3c5-class',
        },
      });
    };

    // Helper to create disposable enrollment & payment
    const createPayment = async (
      clsId: number,
      userId: number,
      options: {
        paymentStatus?: PaymentStatus;
        enrollmentStatus?: EnrollmentStatus;
        amountVnd?: number;
        activationIssue?: PaymentActivationIssue | null;
        confirmedAt?: Date | null;
        reviewedAt?: Date | null;
        reviewedById?: number | null;
      } = {},
    ) => {
      const enrollment = await prisma.enrollment.create({
        data: {
          userId,
          classId: clsId,
          status: options.enrollmentStatus ?? EnrollmentStatus.PENDING_PAYMENT,
        },
      });

      const payment = await prisma.payment.create({
        data: {
          enrollmentId: enrollment.id,
          amountVnd: options.amountVnd ?? 1000000,
          transferCode: `BT-3C5-${crypto.randomBytes(3).toString('hex')}`,
          status: options.paymentStatus ?? PaymentStatus.REPORTED,
          activationIssue: options.activationIssue,
          reportedAt:
            options.paymentStatus === PaymentStatus.PENDING
              ? null
              : new Date(Date.now() - 60000),
          confirmedAt: options.confirmedAt,
          reviewedAt: options.reviewedAt,
          reviewedById: options.reviewedById,
        },
      });

      return { enrollment, payment };
    };

    // -----------------------------------------------------------------------
    // 32. Authorization & Namespace on /admin/payments/:id/confirm
    // -----------------------------------------------------------------------
    describe('32. Authorization & Role Protection on POST /admin/payments/:id/confirm', () => {
      it('32.1. Admin POST /admin/payments/:id/confirm succeeds with 200', async () => {
        const cls = await createClass('Auth Test Class 1');
        const { payment } = await createPayment(cls.id, studentUser.id);

        const res = await request(app.getHttpServer())
          .post(`/admin/payments/${payment.id}/confirm`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .expect(200);

        expect(res.body.statusCode).toBe(200);
        expect(res.body.data.status).toBe(PaymentStatus.CONFIRMED);
      });

      it('32.2. Student gets 403 Forbidden on confirm', async () => {
        const cls = await createClass('Auth Test Class 2');
        const { payment } = await createPayment(cls.id, studentUser.id);

        await request(app.getHttpServer())
          .post(`/admin/payments/${payment.id}/confirm`)
          .set('Authorization', `Bearer ${tokenStudent}`)
          .expect(403);
      });

      it('32.3. Teacher gets 403 Forbidden on confirm', async () => {
        const cls = await createClass('Auth Test Class 3');
        const { payment } = await createPayment(cls.id, studentUser.id);

        await request(app.getHttpServer())
          .post(`/admin/payments/${payment.id}/confirm`)
          .set('Authorization', `Bearer ${tokenTeacher}`)
          .expect(403);
      });

      it('32.4. Unauthenticated gets 401 Unauthorized on confirm', async () => {
        const cls = await createClass('Auth Test Class 4');
        const { payment } = await createPayment(cls.id, studentUser.id);

        await request(app.getHttpServer())
          .post(`/admin/payments/${payment.id}/confirm`)
          .expect(401);
      });
    });

    // -----------------------------------------------------------------------
    // 33. Case A: UPCOMING + Capacity Available (Happy Path)
    // -----------------------------------------------------------------------
    describe('33. Case A: UPCOMING + Capacity Available (Happy Path Activation)', () => {
      it('33.1. Payment becomes CONFIRMED, Enrollment becomes ACTIVE, student gets 200 access', async () => {
        const cls = await createClass('Happy Path Class', { capacity: 5 });
        const { payment, enrollment } = await createPayment(
          cls.id,
          studentUser.id,
        );

        // Verify initial access is blocked (403)
        await request(app.getHttpServer())
          .get(`/courses/classes/${cls.id}`)
          .set('Authorization', `Bearer ${tokenStudent}`)
          .expect(403);

        const beforeConfirm = Date.now();

        const res = await request(app.getHttpServer())
          .post(`/admin/payments/${payment.id}/confirm`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .expect(200);

        const afterConfirm = Date.now();

        // 1. Response verification
        expect(res.body.statusCode).toBe(200);
        expect(res.body.data.status).toBe(PaymentStatus.CONFIRMED);
        expect(res.body.data.activationIssue).toBeNull();
        expect(res.body.data.enrollment.status).toBe(EnrollmentStatus.ACTIVE);
        expect(res.body.data.reviewedBy.id).toBe(adminUser.id);

        // 2. Database verification
        const dbPayment = await prisma.payment.findUnique({
          where: { id: payment.id },
        });
        expect(dbPayment!.status).toBe(PaymentStatus.CONFIRMED);
        expect(dbPayment!.activationIssue).toBeNull();
        expect(dbPayment!.reviewedById).toBe(adminUser.id);
        expect(dbPayment!.confirmedAt).not.toBeNull();
        expect(dbPayment!.reviewedAt).not.toBeNull();
        expect(
          new Date(dbPayment!.confirmedAt!).getTime(),
        ).toBeGreaterThanOrEqual(beforeConfirm - 2000);
        expect(new Date(dbPayment!.confirmedAt!).getTime()).toBeLessThanOrEqual(
          afterConfirm + 2000,
        );
        expect(dbPayment!.amountVnd).toBe(1000000); // immutable
        expect(dbPayment!.transferCode).toBe(payment.transferCode); // immutable

        const dbEnrollment = await prisma.enrollment.findUnique({
          where: { id: enrollment.id },
        });
        expect(dbEnrollment!.status).toBe(EnrollmentStatus.ACTIVE);

        // 3. Access Truth verification: Student now enters private classroom (200)
        await request(app.getHttpServer())
          .get(`/courses/classes/${cls.id}`)
          .set('Authorization', `Bearer ${tokenStudent}`)
          .expect(200);
      });
    });

    // -----------------------------------------------------------------------
    // 34. Case B: UPCOMING + Full Capacity (CLASS_FULL)
    // -----------------------------------------------------------------------
    describe('34. Case B: UPCOMING + Full Capacity (CLASS_FULL Decision)', () => {
      it('34.1. Payment CONFIRMED with CLASS_FULL, Enrollment remains PENDING_PAYMENT, student gets 403', async () => {
        const cls = await createClass('Full Class Test', { capacity: 1 });

        // Occupy the only seat with an ACTIVE enrollment
        await prisma.enrollment.create({
          data: {
            userId: studentUser2.id,
            classId: cls.id,
            status: EnrollmentStatus.ACTIVE,
          },
        });

        // Student 1 reports payment for this class
        const { payment, enrollment } = await createPayment(
          cls.id,
          studentUser.id,
        );

        const res = await request(app.getHttpServer())
          .post(`/admin/payments/${payment.id}/confirm`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .expect(200);

        // 1. Response verification
        expect(res.body.statusCode).toBe(200);
        expect(res.body.data.status).toBe(PaymentStatus.CONFIRMED);
        expect(res.body.data.activationIssue).toBe(
          PaymentActivationIssue.CLASS_FULL,
        );
        expect(res.body.data.enrollment.status).toBe(
          EnrollmentStatus.PENDING_PAYMENT,
        );

        // 2. Database verification
        const dbPayment = await prisma.payment.findUnique({
          where: { id: payment.id },
        });
        expect(dbPayment!.status).toBe(PaymentStatus.CONFIRMED);
        expect(dbPayment!.activationIssue).toBe(
          PaymentActivationIssue.CLASS_FULL,
        );
        expect(dbPayment!.reviewedById).toBe(adminUser.id);

        const dbEnrollment = await prisma.enrollment.findUnique({
          where: { id: enrollment.id },
        });
        expect(dbEnrollment!.status).toBe(EnrollmentStatus.PENDING_PAYMENT);

        // 3. Access truth: Student still gets 403 Forbidden
        await request(app.getHttpServer())
          .get(`/courses/classes/${cls.id}`)
          .set('Authorization', `Bearer ${tokenStudent}`)
          .expect(403);
      });
    });

    // -----------------------------------------------------------------------
    // 35. Case C: Ineligible Class Statuses (CLASS_NOT_ELIGIBLE)
    // -----------------------------------------------------------------------
    describe('35. Case C: Ineligible Class Statuses (CLASS_NOT_ELIGIBLE Decision)', () => {
      it('35.1. ONGOING class -> Payment CONFIRMED, CLASS_NOT_ELIGIBLE, Enrollment PENDING_PAYMENT', async () => {
        const cls = await createClass('Ongoing Class Test', {
          status: ClassStatus.ONGOING,
        });
        const { payment, enrollment } = await createPayment(
          cls.id,
          studentUser.id,
        );

        const res = await request(app.getHttpServer())
          .post(`/admin/payments/${payment.id}/confirm`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .expect(200);

        expect(res.body.data.status).toBe(PaymentStatus.CONFIRMED);
        expect(res.body.data.activationIssue).toBe(
          PaymentActivationIssue.CLASS_NOT_ELIGIBLE,
        );
        expect(res.body.data.enrollment.status).toBe(
          EnrollmentStatus.PENDING_PAYMENT,
        );

        const dbEnrollment = await prisma.enrollment.findUnique({
          where: { id: enrollment.id },
        });
        expect(dbEnrollment!.status).toBe(EnrollmentStatus.PENDING_PAYMENT);

        await request(app.getHttpServer())
          .get(`/courses/classes/${cls.id}`)
          .set('Authorization', `Bearer ${tokenStudent}`)
          .expect(403);
      });

      it('35.2. COMPLETED class -> Payment CONFIRMED, CLASS_NOT_ELIGIBLE, Enrollment PENDING_PAYMENT', async () => {
        const cls = await createClass('Completed Class Test', {
          status: ClassStatus.COMPLETED,
        });
        const { payment, enrollment } = await createPayment(
          cls.id,
          studentUser.id,
        );

        const res = await request(app.getHttpServer())
          .post(`/admin/payments/${payment.id}/confirm`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .expect(200);

        expect(res.body.data.status).toBe(PaymentStatus.CONFIRMED);
        expect(res.body.data.activationIssue).toBe(
          PaymentActivationIssue.CLASS_NOT_ELIGIBLE,
        );
        expect(res.body.data.enrollment.status).toBe(
          EnrollmentStatus.PENDING_PAYMENT,
        );

        const dbEnrollment = await prisma.enrollment.findUnique({
          where: { id: enrollment.id },
        });
        expect(dbEnrollment!.status).toBe(EnrollmentStatus.PENDING_PAYMENT);
      });

      it('35.3. CANCELLED class -> Payment CONFIRMED, CLASS_NOT_ELIGIBLE, Enrollment PENDING_PAYMENT', async () => {
        const cls = await createClass('Cancelled Class Test', {
          status: ClassStatus.CANCELLED,
        });
        const { payment, enrollment } = await createPayment(
          cls.id,
          studentUser.id,
        );

        const res = await request(app.getHttpServer())
          .post(`/admin/payments/${payment.id}/confirm`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .expect(200);

        expect(res.body.data.status).toBe(PaymentStatus.CONFIRMED);
        expect(res.body.data.activationIssue).toBe(
          PaymentActivationIssue.CLASS_NOT_ELIGIBLE,
        );
        expect(res.body.data.enrollment.status).toBe(
          EnrollmentStatus.PENDING_PAYMENT,
        );

        const dbEnrollment = await prisma.enrollment.findUnique({
          where: { id: enrollment.id },
        });
        expect(dbEnrollment!.status).toBe(EnrollmentStatus.PENDING_PAYMENT);
      });
    });

    // -----------------------------------------------------------------------
    // 36. Conflict on Non-REPORTED Payments
    // -----------------------------------------------------------------------
    describe('36. State Machine Guards (409 Conflict on Non-REPORTED Payments)', () => {
      it('36.1. PENDING payment returns 409 Conflict', async () => {
        const cls = await createClass('Pending Confirm Test');
        const { payment } = await createPayment(cls.id, studentUser.id, {
          paymentStatus: PaymentStatus.PENDING,
        });

        const res = await request(app.getHttpServer())
          .post(`/admin/payments/${payment.id}/confirm`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .expect(409);

        expect(res.body.message).toContain('PENDING');
      });

      it('36.2. REJECTED payment returns 409 Conflict', async () => {
        const cls = await createClass('Rejected Confirm Test');
        const { payment } = await createPayment(cls.id, studentUser.id, {
          paymentStatus: PaymentStatus.REJECTED,
          reviewedById: adminUser.id,
          reviewedAt: new Date(),
        });

        const res = await request(app.getHttpServer())
          .post(`/admin/payments/${payment.id}/confirm`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .expect(409);

        expect(res.body.message).toContain('REJECTED');
      });

      it('36.3. REVIEW_REQUIRED payment returns 409 Conflict', async () => {
        const cls = await createClass('ReviewReq Confirm Test');
        const { payment } = await createPayment(cls.id, studentUser.id, {
          paymentStatus: PaymentStatus.REVIEW_REQUIRED,
        });

        const res = await request(app.getHttpServer())
          .post(`/admin/payments/${payment.id}/confirm`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .expect(409);

        expect(res.body.message).toContain('REVIEW_REQUIRED');
      });
    });

    // -----------------------------------------------------------------------
    // 37. Idempotency Across All 3 Confirmation Outcomes
    // -----------------------------------------------------------------------
    describe('37. Idempotency Across All 3 Confirmation Outcomes (No Re-execution, No Retry)', () => {
      it('37.1. Idempotent repeat on CONFIRMED + ACTIVE returns 200, preserves original timestamps and state', async () => {
        const cls = await createClass('Idempotent Active Class');
        const { payment } = await createPayment(cls.id, studentUser.id);

        // First confirm
        const firstRes = await request(app.getHttpServer())
          .post(`/admin/payments/${payment.id}/confirm`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .expect(200);

        const firstConfirmedAt = firstRes.body.data.confirmedAt;
        const firstReviewedAt = firstRes.body.data.reviewedAt;

        // Repeat confirm
        const secondRes = await request(app.getHttpServer())
          .post(`/admin/payments/${payment.id}/confirm`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .expect(200);

        expect(secondRes.body.data.status).toBe(PaymentStatus.CONFIRMED);
        expect(secondRes.body.data.activationIssue).toBeNull();
        expect(secondRes.body.data.confirmedAt).toBe(firstConfirmedAt);
        expect(secondRes.body.data.reviewedAt).toBe(firstReviewedAt);
        expect(secondRes.body.data.enrollment.status).toBe(
          EnrollmentStatus.ACTIVE,
        );
      });

      it('37.2. Idempotent repeat on CONFIRMED + CLASS_FULL does NOT auto-retry when seat becomes available', async () => {
        const cls = await createClass('Idempotent Full Class', { capacity: 1 });

        // Competing active student occupying the seat
        const competitorEnrollment = await prisma.enrollment.create({
          data: {
            userId: studentUser2.id,
            classId: cls.id,
            status: EnrollmentStatus.ACTIVE,
          },
        });

        const { payment, enrollment } = await createPayment(
          cls.id,
          studentUser.id,
        );

        // First confirm -> CLASS_FULL
        const firstRes = await request(app.getHttpServer())
          .post(`/admin/payments/${payment.id}/confirm`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .expect(200);

        expect(firstRes.body.data.activationIssue).toBe(
          PaymentActivationIssue.CLASS_FULL,
        );

        // Now seat becomes available (competitor dropped/deleted)
        await prisma.enrollment.delete({
          where: { id: competitorEnrollment.id },
        });

        // Repeat confirm MUST NOT retry activation in Phase 3C-5!
        const repeatRes = await request(app.getHttpServer())
          .post(`/admin/payments/${payment.id}/confirm`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .expect(200);

        expect(repeatRes.body.data.status).toBe(PaymentStatus.CONFIRMED);
        expect(repeatRes.body.data.activationIssue).toBe(
          PaymentActivationIssue.CLASS_FULL,
        );
        expect(repeatRes.body.data.enrollment.status).toBe(
          EnrollmentStatus.PENDING_PAYMENT,
        );

        const dbEnrollment = await prisma.enrollment.findUnique({
          where: { id: enrollment.id },
        });
        expect(dbEnrollment!.status).toBe(EnrollmentStatus.PENDING_PAYMENT);
      });

      it('37.3. Idempotent repeat on CONFIRMED + CLASS_NOT_ELIGIBLE does NOT auto-retry when class becomes UPCOMING', async () => {
        const cls = await createClass('Idempotent Not Eligible Class', {
          status: ClassStatus.ONGOING,
        });
        const { payment, enrollment } = await createPayment(
          cls.id,
          studentUser.id,
        );

        // First confirm -> CLASS_NOT_ELIGIBLE
        await request(app.getHttpServer())
          .post(`/admin/payments/${payment.id}/confirm`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .expect(200);

        // Change class status back to UPCOMING
        await prisma.class.update({
          where: { id: cls.id },
          data: { status: ClassStatus.UPCOMING },
        });

        // Repeat confirm MUST NOT auto-retry
        const repeatRes = await request(app.getHttpServer())
          .post(`/admin/payments/${payment.id}/confirm`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .expect(200);

        expect(repeatRes.body.data.status).toBe(PaymentStatus.CONFIRMED);
        expect(repeatRes.body.data.activationIssue).toBe(
          PaymentActivationIssue.CLASS_NOT_ELIGIBLE,
        );
        expect(repeatRes.body.data.enrollment.status).toBe(
          EnrollmentStatus.PENDING_PAYMENT,
        );

        const dbEnrollment = await prisma.enrollment.findUnique({
          where: { id: enrollment.id },
        });
        expect(dbEnrollment!.status).toBe(EnrollmentStatus.PENDING_PAYMENT);
      });
    });

    // -----------------------------------------------------------------------
    // 38. First-Confirm Invariants (422 Unprocessable Entity & Zero Mutation)
    // -----------------------------------------------------------------------
    describe('38. First-Confirm Invariants (422 Unprocessable Entity & Zero Mutation)', () => {
      it('38.1. REPORTED payment pointing to ACTIVE enrollment returns 422 with zero mutation', async () => {
        const cls = await createClass('Invariant Test Class 1');
        const { payment } = await createPayment(cls.id, studentUser.id, {
          paymentStatus: PaymentStatus.REPORTED,
          enrollmentStatus: EnrollmentStatus.ACTIVE,
        });

        await request(app.getHttpServer())
          .post(`/admin/payments/${payment.id}/confirm`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .expect(422);

        // Verify zero mutation
        const dbPayment = await prisma.payment.findUnique({
          where: { id: payment.id },
        });
        expect(dbPayment!.status).toBe(PaymentStatus.REPORTED);
        expect(dbPayment!.confirmedAt).toBeNull();
        expect(dbPayment!.reviewedAt).toBeNull();
      });

      it('38.2. REPORTED payment pointing to COMPLETED enrollment returns 422 with zero mutation', async () => {
        const cls = await createClass('Invariant Test Class 2');
        const { payment } = await createPayment(cls.id, studentUser.id, {
          paymentStatus: PaymentStatus.REPORTED,
          enrollmentStatus: EnrollmentStatus.COMPLETED,
        });

        await request(app.getHttpServer())
          .post(`/admin/payments/${payment.id}/confirm`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .expect(422);

        const dbPayment = await prisma.payment.findUnique({
          where: { id: payment.id },
        });
        expect(dbPayment!.status).toBe(PaymentStatus.REPORTED);
      });

      it('38.3. REPORTED payment pointing to DROPPED enrollment returns 422 with zero mutation', async () => {
        const cls = await createClass('Invariant Test Class 3');
        const { payment } = await createPayment(cls.id, studentUser.id, {
          paymentStatus: PaymentStatus.REPORTED,
          enrollmentStatus: EnrollmentStatus.DROPPED,
        });

        await request(app.getHttpServer())
          .post(`/admin/payments/${payment.id}/confirm`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .expect(422);

        const dbPayment = await prisma.payment.findUnique({
          where: { id: payment.id },
        });
        expect(dbPayment!.status).toBe(PaymentStatus.REPORTED);
      });
    });

    // -----------------------------------------------------------------------
    // 39. Client Body Has Zero Authority (Tampering Protection)
    // -----------------------------------------------------------------------
    describe('39. Client Body Has Zero Authority (Tampering Protection)', () => {
      it('39.1. Malicious client body cannot override status, activationIssue, reviewer or amount', async () => {
        const cls = await createClass('Tamper Protection Class');
        const { payment, enrollment } = await createPayment(
          cls.id,
          studentUser.id,
        );

        const res = await request(app.getHttpServer())
          .post(`/admin/payments/${payment.id}/confirm`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .send({
            status: 'REJECTED',
            activationIssue: 'CLASS_FULL',
            reviewedById: 9999,
            amountVnd: 0,
            transferCode: 'TAMPERED_CODE',
            confirmedAt: '2020-01-01T00:00:00.000Z',
          })
          .expect(200);

        // Server decides everything
        expect(res.body.data.status).toBe(PaymentStatus.CONFIRMED);
        expect(res.body.data.activationIssue).toBeNull();
        expect(res.body.data.reviewedBy.id).toBe(adminUser.id);
        expect(res.body.data.amountVnd).toBe(1000000);
        expect(res.body.data.transferCode).toBe(payment.transferCode);
        expect(res.body.data.enrollment.id).toBe(enrollment.id);
        expect(res.body.data.enrollment.status).toBe(EnrollmentStatus.ACTIVE);

        const dbPayment = await prisma.payment.findUnique({
          where: { id: payment.id },
        });
        expect(dbPayment!.status).toBe(PaymentStatus.CONFIRMED);
        expect(dbPayment!.activationIssue).toBeNull();
        expect(dbPayment!.reviewedById).toBe(adminUser.id);
        expect(dbPayment!.amountVnd).toBe(1000000);
      });
    });

    // -----------------------------------------------------------------------
    // 40. Concurrency: Parallel Capacity Race (Capacity = 1)
    // -----------------------------------------------------------------------
    describe('40. Concurrency: Parallel Capacity Race on Single-Seat Class (Capacity = 1)', () => {
      it('40.1. Exactly one Enrollment ACTIVE, exactly one PENDING_PAYMENT, exactly one CLASS_FULL, total ACTIVE = 1', async () => {
        const cls = await createClass('Capacity Race Class', { capacity: 1 });

        // Two students both reported payments for this class
        const p1 = await createPayment(cls.id, studentUser.id);
        const p2 = await createPayment(cls.id, studentUser2.id);

        // Run both confirms concurrently
        const [res1, res2] = await Promise.all([
          request(app.getHttpServer())
            .post(`/admin/payments/${p1.payment.id}/confirm`)
            .set('Authorization', `Bearer ${tokenAdmin}`),
          request(app.getHttpServer())
            .post(`/admin/payments/${p2.payment.id}/confirm`)
            .set('Authorization', `Bearer ${tokenAdmin2}`),
        ]);

        // Both HTTP calls succeed with 200
        expect(res1.status).toBe(200);
        expect(res2.status).toBe(200);

        // Verify both payments in database
        const dbP1 = await prisma.payment.findUnique({
          where: { id: p1.payment.id },
        });
        const dbP2 = await prisma.payment.findUnique({
          where: { id: p2.payment.id },
        });

        expect(dbP1!.status).toBe(PaymentStatus.CONFIRMED);
        expect(dbP2!.status).toBe(PaymentStatus.CONFIRMED);

        const issues = [dbP1!.activationIssue, dbP2!.activationIssue];
        expect(issues).toContain(null);
        expect(issues).toContain(PaymentActivationIssue.CLASS_FULL);

        // Verify both enrollments in database
        const dbE1 = await prisma.enrollment.findUnique({
          where: { id: p1.enrollment.id },
        });
        const dbE2 = await prisma.enrollment.findUnique({
          where: { id: p2.enrollment.id },
        });

        const enrollStatuses = [dbE1!.status, dbE2!.status];
        expect(enrollStatuses).toContain(EnrollmentStatus.ACTIVE);
        expect(enrollStatuses).toContain(EnrollmentStatus.PENDING_PAYMENT);

        // CRITICAL: ACTIVE count in database must strictly be 1!
        const totalActive = await prisma.enrollment.count({
          where: { classId: cls.id, status: EnrollmentStatus.ACTIVE },
        });
        expect(totalActive).toBe(1);

        // Access Truth: Active winner gets 200, pending loser gets 403
        const activeToken =
          dbE1!.status === EnrollmentStatus.ACTIVE
            ? tokenStudent
            : tokenStudent2;
        const pendingToken =
          dbE1!.status === EnrollmentStatus.ACTIVE
            ? tokenStudent2
            : tokenStudent;

        await request(app.getHttpServer())
          .get(`/courses/classes/${cls.id}`)
          .set('Authorization', `Bearer ${activeToken}`)
          .expect(200);

        await request(app.getHttpServer())
          .get(`/courses/classes/${cls.id}`)
          .set('Authorization', `Bearer ${pendingToken}`)
          .expect(403);
      });
    });

    // -----------------------------------------------------------------------
    // 41. Concurrency: Confirm vs. Reject Race
    // -----------------------------------------------------------------------
    describe('41. Concurrency: Confirm vs. Reject Race on Same REPORTED Payment', () => {
      it('41.1. Exactly one 200, exactly one 409, final database state is strictly either CONFIRMED or REJECTED', async () => {
        const cls = await createClass('Confirm vs Reject Class');
        const { payment } = await createPayment(cls.id, studentUser.id);

        const [confirmRes, rejectRes] = await Promise.all([
          request(app.getHttpServer())
            .post(`/admin/payments/${payment.id}/confirm`)
            .set('Authorization', `Bearer ${tokenAdmin}`),
          request(app.getHttpServer())
            .post(`/admin/payments/${payment.id}/reject`)
            .set('Authorization', `Bearer ${tokenAdmin2}`)
            .send({
              reason: 'Lý do từ chối đồng thời trong bài kiểm thử concurrency',
            }),
        ]);

        const statuses = [confirmRes.status, rejectRes.status];
        expect(statuses).toContain(200);
        expect(statuses).toContain(409);

        // Authoritative database check
        const dbPayment = await prisma.payment.findUnique({
          where: { id: payment.id },
        });
        expect([PaymentStatus.CONFIRMED, PaymentStatus.REJECTED]).toContain(
          dbPayment!.status,
        );

        if (dbPayment!.status === PaymentStatus.CONFIRMED) {
          expect(dbPayment!.confirmedAt).not.toBeNull();
          expect(dbPayment!.adminNote).toBeNull();
        } else {
          expect(dbPayment!.adminNote).toContain('Lý do từ chối đồng thời');
          expect(dbPayment!.confirmedAt).toBeNull();
        }
      });
    });

    // -----------------------------------------------------------------------
    // 42. Concurrency: Report Transfer vs. Confirm Race
    // -----------------------------------------------------------------------
    describe('42. Concurrency: Report Transfer vs. Confirm Race', () => {
      it('42.1. Serialized cleanly without 500: either report wins first (CONFIRMED) or confirm 409 (REPORTED)', async () => {
        const cls = await createClass('Report vs Confirm Class');
        const { payment } = await createPayment(cls.id, studentUser.id, {
          paymentStatus: PaymentStatus.PENDING,
        });

        const [reportRes, confirmRes] = await Promise.all([
          request(app.getHttpServer())
            .post(`/payments/${payment.id}/report-transfer`)
            .set('Authorization', `Bearer ${tokenStudent}`),
          request(app.getHttpServer())
            .post(`/admin/payments/${payment.id}/confirm`)
            .set('Authorization', `Bearer ${tokenAdmin}`),
        ]);

        // Report transfer should always return 200
        expect(reportRes.status).toBe(200);

        // Confirm can return 200 (if report serialized first) or 409 (if confirm locked first and saw PENDING)
        expect([200, 409]).toContain(confirmRes.status);

        const dbPayment = await prisma.payment.findUnique({
          where: { id: payment.id },
        });
        if (confirmRes.status === 200) {
          expect(dbPayment!.status).toBe(PaymentStatus.CONFIRMED);
        } else {
          expect(dbPayment!.status).toBe(PaymentStatus.REPORTED);
        }
      });
    });

    // -----------------------------------------------------------------------
    // 43. Student Reviewer & ActivationIssue Privacy Regressions
    // -----------------------------------------------------------------------
    describe('43. Student Reviewer & ActivationIssue Privacy Regressions', () => {
      it('43.1. Student GET /payments/:id hides reviewedById, reviewedBy, adminNote, and activationIssue', async () => {
        const cls = await createClass('Student Privacy Class');
        const { payment } = await createPayment(cls.id, studentUser.id);

        // Confirm payment
        await request(app.getHttpServer())
          .post(`/admin/payments/${payment.id}/confirm`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .expect(200);

        // Student fetches their payment detail
        const studentRes = await request(app.getHttpServer())
          .get(`/payments/${payment.id}`)
          .set('Authorization', `Bearer ${tokenStudent}`)
          .expect(200);

        expect(studentRes.body.data.status).toBe(PaymentStatus.CONFIRMED);
        expect(studentRes.body.data.reviewedById).toBeUndefined();
        expect(studentRes.body.data.reviewedBy).toBeUndefined();
        expect(studentRes.body.data.adminNote).toBeUndefined();
        expect(studentRes.body.data.activationIssue).toBeUndefined();
      });
    });
  });
});
