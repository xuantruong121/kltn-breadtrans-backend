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
} from '@prisma/client';
import { getRedisConnectionToken } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import * as crypto from 'crypto';

describe('Enrollment Lifecycle & Security & Concurrency (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let redis: Redis;

  let studentA: any;
  let studentB: any;
  let studentC: any;
  let studentD: any;
  let teacherUser: any;
  let adminUser: any;

  let tokenStudentA: string;
  let tokenStudentB: string;
  let tokenStudentC: string;
  let tokenStudentD: string;
  let tokenTeacher: string;
  let tokenAdmin: string;

  let testCourse: any;
  let freeClass: any;
  let paidClass: any;
  let singleSeatClass: any;
  let completedClass: any;
  let paidClassAssignment: any;

  beforeAll(async () => {
    // 0. Safety Fuse: Refuse to run against any non-test database!
    const dbUrl = process.env.DATABASE_URL || '';
    if (!dbUrl.includes('test') && !dbUrl.includes('kltn_test_db')) {
      throw new Error(
        `SAFETY FUSE TRIGGERED: Refusing to run destructive E2E tests outside isolated test DB! DATABASE_URL must contain 'test' or 'kltn_test_db'. Current: ${dbUrl.replace(/:[^:@]+@/, ':***@')}`,
      );
    }
    console.log(
      `[SAFETY FUSE PASSED] Running E2E suite against verified test DB: ${dbUrl.replace(/:[^:@]+@/, ':***@')}`,
    );

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    jwtService = app.get<JwtService>(JwtService);
    try {
      redis = app.get<Redis>(getRedisConnectionToken());
    } catch {
      // Redis optional
    }

    // 1. Setup Users
    studentA = await prisma.user.upsert({
      where: { email: 'e2e_student_a@breadtrans.com' },
      update: {},
      create: {
        email: 'e2e_student_a@breadtrans.com',
        password: 'hashed_password_123',
        role: Role.STUDENT,
      },
    });

    studentB = await prisma.user.upsert({
      where: { email: 'e2e_student_b@breadtrans.com' },
      update: {},
      create: {
        email: 'e2e_student_b@breadtrans.com',
        password: 'hashed_password_123',
        role: Role.STUDENT,
      },
    });

    studentC = await prisma.user.upsert({
      where: { email: 'e2e_student_c@breadtrans.com' },
      update: {},
      create: {
        email: 'e2e_student_c@breadtrans.com',
        password: 'hashed_password_123',
        role: Role.STUDENT,
      },
    });

    studentD = await prisma.user.upsert({
      where: { email: 'e2e_student_d@breadtrans.com' },
      update: {},
      create: {
        email: 'e2e_student_d@breadtrans.com',
        password: 'hashed_password_123',
        role: Role.STUDENT,
      },
    });

    teacherUser = await prisma.user.upsert({
      where: { email: 'e2e_teacher@breadtrans.com' },
      update: {},
      create: {
        email: 'e2e_teacher@breadtrans.com',
        password: 'hashed_password_123',
        role: Role.TEACHER,
      },
    });

    adminUser = await prisma.user.upsert({
      where: { email: 'e2e_admin@breadtrans.com' },
      update: {},
      create: {
        email: 'e2e_admin@breadtrans.com',
        password: 'hashed_password_123',
        role: Role.ADMIN,
      },
    });

    // 2. Generate JWT tokens
    const makeToken = (user: any) =>
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
    tokenStudentC = makeToken(studentC);
    tokenStudentD = makeToken(studentD);
    tokenTeacher = makeToken(teacherUser);
    tokenAdmin = makeToken(adminUser);

    // 3. Setup Course and Classes
    testCourse = await prisma.course.create({
      data: {
        title: 'E2E Phase 3B Course',
        description: 'Testing self-enrollment and lifecycle',
        status: CourseStatus.PUBLISHED,
        level: 'BEGINNER',
        teacherId: teacherUser.id,
        lessons: {
          create: [
            {
              title: 'Private Lesson 1',
              description: 'Contains private video',
              order: 1,
              videoUrl: 'https://cdn.breadtrans.com/private/lesson1.mp4',
            },
          ],
        },
      },
    });

    // Free UPCOMING Class
    freeClass = await prisma.class.create({
      data: {
        name: 'E2E Free Class',
        courseId: testCourse.id,
        teacherId: teacherUser.id,
        capacity: 30,
        tuitionFeeVnd: 0,
        status: ClassStatus.UPCOMING,
        meetingLink: 'https://daily.co/e2e-free-class',
      },
    });

    // Paid UPCOMING Class (200,000 VND)
    paidClass = await prisma.class.create({
      data: {
        name: 'E2E Paid Class',
        courseId: testCourse.id,
        teacherId: teacherUser.id,
        capacity: 20,
        tuitionFeeVnd: 200000,
        status: ClassStatus.UPCOMING,
        meetingLink: 'https://daily.co/e2e-paid-class',
      },
    });

    // Single seat class for concurrency test (capacity = 1)
    singleSeatClass = await prisma.class.create({
      data: {
        name: 'E2E Single Seat Class',
        courseId: testCourse.id,
        teacherId: teacherUser.id,
        capacity: 1,
        tuitionFeeVnd: 0,
        status: ClassStatus.UPCOMING,
        meetingLink: 'https://daily.co/e2e-single-seat',
      },
    });

    // Completed class for admin override validation
    completedClass = await prisma.class.create({
      data: {
        name: 'E2E Completed Class',
        courseId: testCourse.id,
        teacherId: teacherUser.id,
        capacity: 10,
        tuitionFeeVnd: 100000,
        status: ClassStatus.COMPLETED,
        meetingLink: 'https://daily.co/e2e-completed',
      },
    });

    // Assignment attached to paidClass
    paidClassAssignment = await prisma.assignment.create({
      data: {
        classId: paidClass.id,
        title: 'Paid Class Midterm Assignment',
        description: 'Private essay assignment for enrolled students',
        type: 'ESSAY',
      },
    });
  });

  afterAll(async () => {
    // Cleanup fixtures
    const classIds = [
      freeClass?.id,
      paidClass?.id,
      singleSeatClass?.id,
      completedClass?.id,
    ].filter(Boolean);

    if (classIds.length > 0 && prisma) {
      await prisma.assignmentSubmission
        ?.deleteMany({
          where: { assignment: { classId: { in: classIds } } },
        })
        .catch(() => null);
      await prisma.assignment
        ?.deleteMany({ where: { classId: { in: classIds } } })
        .catch(() => null);
      await prisma.enrollment
        ?.deleteMany({ where: { classId: { in: classIds } } })
        .catch(() => null);
      await prisma.class
        ?.deleteMany({ where: { id: { in: classIds } } })
        .catch(() => null);
    }
    if (testCourse?.id && prisma) {
      await prisma.lesson
        ?.deleteMany({ where: { courseId: testCourse.id } })
        .catch(() => null);
      await prisma.course
        ?.delete({ where: { id: testCourse.id } })
        .catch(() => null);
    }
    if (prisma) {
      await prisma.user
        ?.deleteMany({
          where: {
            id: {
              in: [
                studentA?.id,
                studentB?.id,
                studentC?.id,
                studentD?.id,
                teacherUser?.id,
                adminUser?.id,
              ].filter(Boolean),
            },
          },
        })
        .catch(() => null);
    }

    if (redis) {
      await redis.quit().catch(() => null);
    }
    if (prisma) {
      await prisma.$disconnect().catch(() => null);
    }
    await app.close();
  });

  describe('1. Authentication & Role Guard on POST /courses/classes/:classId/enroll', () => {
    it('Guest (unauthenticated) -> 401 Unauthorized', async () => {
      const res = await request(app.getHttpServer())
        .post(`/courses/classes/${freeClass.id}/enroll`)
        .send();

      expect(res.status).toBe(401);
    });

    it('Teacher -> 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .post(`/courses/classes/${freeClass.id}/enroll`)
        .set('Authorization', `Bearer ${tokenTeacher}`)
        .send();

      expect(res.status).toBe(403);
    });

    it('Admin calling Student self-enroll route -> 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .post(`/courses/classes/${freeClass.id}/enroll`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send();

      expect(res.status).toBe(403);
    });
  });

  describe('2. ENR13 - Malicious Body Injection & Mass-Assignment Protection', () => {
    it('Malicious payload cannot override userId, status, tuitionFeeVnd, or isAdminOverride', async () => {
      const maliciousPayload = {
        userId: 99999,
        status: 'ACTIVE',
        tuitionFeeVnd: 0,
        isAdminOverride: true,
      };

      const res = await request(app.getHttpServer())
        .post(`/courses/classes/${paidClass.id}/enroll`)
        .set('Authorization', `Bearer ${tokenStudentA}`)
        .send(maliciousPayload);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('PENDING_PAYMENT');
      expect(res.body.tuitionFeeVnd).toBe(200000);
      expect(res.body.accessGranted).toBe(false);

      // Verify DB record directly: owner is studentA, status is PENDING_PAYMENT
      const dbEnrollment = await prisma.enrollment.findUnique({
        where: {
          userId_classId: {
            userId: studentA.id,
            classId: paidClass.id,
          },
        },
      });

      expect(dbEnrollment).toBeDefined();
      expect(dbEnrollment?.userId).toBe(studentA.id);
      expect(dbEnrollment?.status).toBe(EnrollmentStatus.PENDING_PAYMENT);

      // Verify attacker-specified userId 99999 was NOT created
      const attackerEnrollment = await prisma.enrollment.findFirst({
        where: { userId: 99999 },
      });
      expect(attackerEnrollment).toBeNull();
    });
  });

  describe('3. PENDING_PAYMENT Private Content Isolation (PEND-SEC-01 to PEND-SEC-05)', () => {
    it('PEND-SEC-01: PENDING_PAYMENT Student cannot access /courses/classes/:classId -> 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .get(`/courses/classes/${paidClass.id}`)
        .set('Authorization', `Bearer ${tokenStudentA}`);

      expect(res.status).toBe(403);
    });

    it('PEND-SEC-02: PENDING_PAYMENT Student calling /courses has meetingLink sanitized to null', async () => {
      const res = await request(app.getHttpServer())
        .get('/courses')
        .set('Authorization', `Bearer ${tokenStudentA}`);

      const enrollments = res.body as Array<{
        classId: number;
        enrollmentStatus: string;
        meetingLink: string | null;
        tuitionFeeVnd: number;
      }>;
      const paidEnrollmentItem = enrollments.find(
        (item) => item.classId === paidClass.id,
      );
      expect(paidEnrollmentItem).toBeDefined();
      expect(paidEnrollmentItem?.enrollmentStatus).toBe('PENDING_PAYMENT');
      expect(paidEnrollmentItem?.meetingLink).toBeNull();
      expect(paidEnrollmentItem?.tuitionFeeVnd).toBe(200000);
    });

    it('PEND-SEC-03: PENDING_PAYMENT Student cannot access assignments of class or assignment detail -> 403 Forbidden', async () => {
      // 1. Cannot list assignments for paidClass
      const listRes = await request(app.getHttpServer())
        .get(`/courses/classes/${paidClass.id}/assignments`)
        .set('Authorization', `Bearer ${tokenStudentA}`);

      expect(listRes.status).toBe(403);

      // 2. Cannot read assignment detail
      const detailRes = await request(app.getHttpServer())
        .get(`/courses/assignments/${paidClassAssignment.id}`)
        .set('Authorization', `Bearer ${tokenStudentA}`);

      expect(detailRes.status).toBe(403);

      // 3. Teacher owner CAN access assignment detail and inspect submissions
      const teacherRes = await request(app.getHttpServer())
        .get(`/courses/assignments/${paidClassAssignment.id}`)
        .set('Authorization', `Bearer ${tokenTeacher}`);

      expect(teacherRes.status).toBe(200);
      expect(teacherRes.body.id).toBe(paidClassAssignment.id);
    });

    it('PEND-SEC-04: PENDING_PAYMENT Student cannot submit assignment -> 403 Forbidden', async () => {
      const submitRes = await request(app.getHttpServer())
        .post(`/courses/assignments/${paidClassAssignment.id}/submit`)
        .set('Authorization', `Bearer ${tokenStudentA}`)
        .send({ content: 'Malicious unauthorized submission' });

      expect(submitRes.status).toBe(403);
    });

    it('PEND-SEC-05: PENDING_PAYMENT Student receives no private lesson video or materials', async () => {
      const classRes = await request(app.getHttpServer())
        .get(`/courses/classes/${paidClass.id}`)
        .set('Authorization', `Bearer ${tokenStudentA}`);

      expect(classRes.status).toBe(403);
      expect(classRes.body.lessons).toBeUndefined();
    });
  });

  describe('4. Free Class Self-Enrollment & Private Learning Access', () => {
    it('Student enrolls in FREE class -> ACTIVE status and immediate learning access (200/201)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/courses/classes/${freeClass.id}/enroll`)
        .set('Authorization', `Bearer ${tokenStudentA}`)
        .send();

      expect([200, 201]).toContain(res.status);
      expect(res.body.status).toBe('ACTIVE');
      expect(res.body.accessGranted).toBe(true);
      expect(res.body.tuitionFeeVnd).toBe(0);

      // Private learning access via /courses/classes/:classId -> 200 OK
      const accessRes = await request(app.getHttpServer())
        .get(`/courses/classes/${freeClass.id}`)
        .set('Authorization', `Bearer ${tokenStudentA}`);

      expect(accessRes.status).toBe(200);
      expect(accessRes.body.id).toBe(freeClass.id);
    });

    it('Student duplicate enrollment into FREE class -> 409 Conflict', async () => {
      const res = await request(app.getHttpServer())
        .post(`/courses/classes/${freeClass.id}/enroll`)
        .set('Authorization', `Bearer ${tokenStudentA}`)
        .send();

      expect(res.status).toBe(409);
    });
  });

  describe('5. Admin Override Direct Enrollment (R4)', () => {
    it('ADM-OVR-01: Admin enrolls Student B into PAID UPCOMING class -> directly ACTIVE (accessGranted: true)', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/enroll')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          userId: studentB.id,
          classId: paidClass.id,
        });

      expect([200, 201]).toContain(res.status);
      expect(res.body.status).toBe('ACTIVE');
      expect(res.body.accessGranted).toBe(true);

      // Verify DB record is ACTIVE
      const dbEnrollment = await prisma.enrollment.findUnique({
        where: {
          userId_classId: {
            userId: studentB.id,
            classId: paidClass.id,
          },
        },
      });
      expect(dbEnrollment?.status).toBe(EnrollmentStatus.ACTIVE);

      // Verify Student B now has private access to paidClass
      const accessRes = await request(app.getHttpServer())
        .get(`/courses/classes/${paidClass.id}`)
        .set('Authorization', `Bearer ${tokenStudentB}`);

      expect(accessRes.status).toBe(200);
    });

    it('ADM-OVR-02: Admin re-enrolls Student B into same class -> 409 Conflict', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/enroll')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          userId: studentB.id,
          classId: paidClass.id,
        });

      expect(res.status).toBe(409);
    });

    it('ADM-OVR-03: Admin attempts to enroll Student into COMPLETED class -> 400 Bad Request', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/enroll')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          userId: studentC.id,
          classId: completedClass.id,
        });

      expect(res.status).toBe(400);
    });
  });

  describe('6. Real Database Concurrency Acceptance Test (Row-Lock FOR UPDATE) (R5)', () => {
    it('Capacity Race: 2 concurrent requests for 1 remaining seat -> 1 success (2xx), 1 conflict (409)', async () => {
      // Student C and Student D attempt to enroll concurrently into singleSeatClass (capacity = 1)
      const [resC, resD] = await Promise.all([
        request(app.getHttpServer())
          .post(`/courses/classes/${singleSeatClass.id}/enroll`)
          .set('Authorization', `Bearer ${tokenStudentC}`)
          .send(),
        request(app.getHttpServer())
          .post(`/courses/classes/${singleSeatClass.id}/enroll`)
          .set('Authorization', `Bearer ${tokenStudentD}`)
          .send(),
      ]);

      const statuses = [resC.status, resD.status];
      const successCount = statuses.filter((s) => s >= 200 && s < 300).length;
      const conflictCount = statuses.filter((s) => s === 409).length;

      expect(successCount).toBe(1);
      expect(conflictCount).toBe(1);

      // Verify DB count: strictly matches capacity invariant (ACTIVE count == capacity)
      const activeCount = await prisma.enrollment.count({
        where: {
          classId: singleSeatClass.id,
          status: EnrollmentStatus.ACTIVE,
        },
      });
      expect(activeCount).toBe(singleSeatClass.capacity);
    });

    it('Duplicate Race: 2 concurrent requests from SAME student for SAME class -> 1 success, 1 conflict, 0 errors', async () => {
      // Student D tries to enroll in freeClass concurrently twice
      const [dup1, dup2] = await Promise.all([
        request(app.getHttpServer())
          .post(`/courses/classes/${freeClass.id}/enroll`)
          .set('Authorization', `Bearer ${tokenStudentD}`)
          .send(),
        request(app.getHttpServer())
          .post(`/courses/classes/${freeClass.id}/enroll`)
          .set('Authorization', `Bearer ${tokenStudentD}`)
          .send(),
      ]);

      const statuses = [dup1.status, dup2.status];
      const successCount = statuses.filter((s) => s >= 200 && s < 300).length;
      const conflictCount = statuses.filter((s) => s === 409).length;

      expect(successCount).toBe(1);
      expect(conflictCount).toBe(1);
      expect(statuses).not.toContain(500);

      // DB record count must be strictly 1
      const enrollmentRows = await prisma.enrollment.count({
        where: {
          classId: freeClass.id,
          userId: studentD.id,
        },
      });
      expect(enrollmentRows).toBe(1);
    });
  });
});
