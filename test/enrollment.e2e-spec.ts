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
  let teacherUser: any;
  let adminUser: any;

  let tokenStudentA: string;
  let tokenStudentB: string;
  let tokenTeacher: string;
  let tokenAdmin: string;

  let testCourse: any;
  let freeClass: any;
  let paidClass: any;
  let singleSeatClass: any;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
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

    // Single seat class for concurrency test
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
  });

  afterAll(async () => {
    // Cleanup enrollments and classes
    const classIds = [freeClass?.id, paidClass?.id, singleSeatClass?.id].filter(
      Boolean,
    );
    if (classIds.length > 0) {
      await prisma.enrollment
        .deleteMany({ where: { classId: { in: classIds } } })
        .catch(() => null);
      await prisma.class
        .deleteMany({ where: { id: { in: classIds } } })
        .catch(() => null);
    }
    if (testCourse?.id) {
      await prisma.lesson
        .deleteMany({ where: { courseId: testCourse.id } })
        .catch(() => null);
      await prisma.course
        .delete({ where: { id: testCourse.id } })
        .catch(() => null);
    }
    await prisma.user
      .deleteMany({
        where: {
          id: {
            in: [
              studentA?.id,
              studentB?.id,
              teacherUser?.id,
              adminUser?.id,
            ].filter(Boolean),
          },
        },
      })
      .catch(() => null);

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
    it('Malicious payload cannot override userId, status, or tuitionFeeVnd', async () => {
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

      // Verify DB record directly
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

  describe('3. PENDING_PAYMENT Private Content Isolation', () => {
    it('PENDING_PAYMENT Student cannot access /courses/classes/:classId -> 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .get(`/courses/classes/${paidClass.id}`)
        .set('Authorization', `Bearer ${tokenStudentA}`);

      expect(res.status).toBe(403);
    });

    it('PENDING_PAYMENT Student calling /courses has meetingLink sanitized to null', async () => {
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
  });

  describe('4. Free Class Self-Enrollment & Private Learning Access', () => {
    it('Student enrolls in FREE class -> ACTIVE status and immediate learning access (200)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/courses/classes/${freeClass.id}/enroll`)
        .set('Authorization', `Bearer ${tokenStudentA}`)
        .send();

      expect(res.status).toBe(200);
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

  describe('5. Real Database Concurrency Acceptance Test (Row-Lock FOR UPDATE)', () => {
    it('2 concurrent requests for 1 remaining seat -> exactly 1 succeeds (200), exactly 1 gets 409 Conflict', async () => {
      // Both Student A and Student B attempt to enroll concurrently into singleSeatClass (capacity = 1)
      // Note: Student A was already created, Student B was created. Neither has enrolled in singleSeatClass yet.
      const [resA, resB] = await Promise.all([
        request(app.getHttpServer())
          .post(`/courses/classes/${singleSeatClass.id}/enroll`)
          .set('Authorization', `Bearer ${tokenStudentA}`)
          .send(),
        request(app.getHttpServer())
          .post(`/courses/classes/${singleSeatClass.id}/enroll`)
          .set('Authorization', `Bearer ${tokenStudentB}`)
          .send(),
      ]);

      const statuses = [resA.status, resB.status];
      expect(statuses).toContain(200);
      expect(statuses).toContain(409);

      // Verify DB count: strictly 1 active enrollment created
      const activeCount = await prisma.enrollment.count({
        where: {
          classId: singleSeatClass.id,
          status: EnrollmentStatus.ACTIVE,
        },
      });
      expect(activeCount).toBe(1);
    });
  });
});
