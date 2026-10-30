import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { CourseStatus } from '@prisma/client';
import { getRedisConnectionToken } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

describe('Public Courses API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;

  let publishedCourseId: number;
  let draftCourseId: number;
  let createdPublishedCourse = false;
  let createdDraftCourse = false;

  // Courses are hidden unless COURSES_ENABLED=true (CoursesEnabledGuard,
  // read per request). These tests cover the enabled catalog.
  const coursesFlag = process.env.COURSES_ENABLED;

  beforeAll(async () => {
    process.env.COURSES_ENABLED = 'true';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    try {
      redis = app.get<Redis>(getRedisConnectionToken());
    } catch {
      // Redis optional
    }

    // Fixture setup: find or create published course
    const existingPublished = await prisma.course.findFirst({
      where: { status: CourseStatus.PUBLISHED },
    });

    if (existingPublished) {
      publishedCourseId = existingPublished.id;
    } else {
      const newCourse = await prisma.course.create({
        data: {
          title: 'E2E Test Published Course',
          description: 'E2E Public Discovery Description',
          status: CourseStatus.PUBLISHED,
          level: 'BEGINNER',
        },
      });
      publishedCourseId = newCourse.id;
      createdPublishedCourse = true;
    }

    // Fixture setup: find or create draft course
    const existingDraft = await prisma.course.findFirst({
      where: { status: CourseStatus.DRAFT },
    });

    if (existingDraft) {
      draftCourseId = existingDraft.id;
    } else {
      const newDraft = await prisma.course.create({
        data: {
          title: 'E2E Test Draft Course',
          description: 'E2E Draft Description',
          status: CourseStatus.DRAFT,
          level: 'INTERMEDIATE',
        },
      });
      draftCourseId = newDraft.id;
      createdDraftCourse = true;
    }
  });

  afterAll(async () => {
    if (coursesFlag === undefined) delete process.env.COURSES_ENABLED;
    else process.env.COURSES_ENABLED = coursesFlag;
    if (createdPublishedCourse && publishedCourseId) {
      await prisma.course
        .delete({ where: { id: publishedCourseId } })
        .catch(() => null);
    }
    if (createdDraftCourse && draftCourseId) {
      await prisma.course
        .delete({ where: { id: draftCourseId } })
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

  it('answers 404 while courses are hidden', async () => {
    process.env.COURSES_ENABLED = 'false';
    try {
      await request(app.getHttpServer()).get('/public/courses').expect(404);
    } finally {
      process.env.COURSES_ENABLED = 'true';
    }
  });

  describe('GET /public/courses (Catalog for Guest)', () => {
    it('should return 200 and list of PUBLISHED courses without Auth header and without classroom data', async () => {
      const res = await request(app.getHttpServer())
        .get('/public/courses')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);

      const catalog = res.body as Array<{
        id: number;
        title: string;
        upcomingClassCount?: unknown;
        status: string;
        classes?: unknown;
        isSelfPaced?: boolean;
        lessons?: unknown;
        quizzes?: unknown;
      }>;

      // Verify structure
      const item = catalog.find((c) => c.id === publishedCourseId);
      expect(item).toBeDefined();
      expect(item?.title).toBeDefined();
      expect(item?.status).toBe(CourseStatus.PUBLISHED);
      expect(item?.isSelfPaced).toBe(true);

      // Verify no draft course leaked in public catalog
      const leakedDraft = catalog.find((c) => c.id === draftCourseId);
      expect(leakedDraft).toBeUndefined();

      // Courses are self-paced and unlocked by PRO (CP60.1): the catalog
      // carries no classes, seats or tuition.
      expect(item?.classes).toBeUndefined();
      expect(item?.upcomingClassCount).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toMatch(
        /tuitionFeeVnd|remainingSeats|upcomingClassCount|"classes"/,
      );
      expect(item?.lessons).toBeUndefined();
      expect(item?.quizzes).toBeUndefined();
    });
  });

  describe('GET /public/courses/:id (Course Detail for Guest)', () => {
    it('should return 200 for a PUBLISHED course without Auth header and with sanitized outline', async () => {
      const res = await request(app.getHttpServer())
        .get(`/public/courses/${publishedCourseId}`)
        .expect(200);

      expect(res.body.id).toBe(publishedCourseId);
      expect(res.body.status).toBe(CourseStatus.PUBLISHED);
      expect(Array.isArray(res.body.lessons)).toBe(true);
      expect(res.body.isSelfPaced).toBe(true);
      // No classroom data in the detail either (CP60.1).
      expect(res.body.classes).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toMatch(
        /tuitionFeeVnd|remainingSeats|currentEnrollmentCount|"classes"/,
      );

      // Zero-leak checks on root and relations
      expect(res.body.quizzes).toBeUndefined();
      for (const lesson of res.body.lessons) {
        expect(lesson.videoUrl).toBeUndefined();
        expect(lesson.materials).toBeUndefined();
      }
    });

    it('should return 404 for an unpublished (DRAFT) course without Auth header', async () => {
      await request(app.getHttpServer())
        .get(`/public/courses/${draftCourseId}`)
        .expect(404);
    });

    it('should return 404 for a non-existent course id', async () => {
      await request(app.getHttpServer())
        .get('/public/courses/99999999')
        .expect(404);
    });
  });
});
