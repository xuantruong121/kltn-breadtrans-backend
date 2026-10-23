import 'dotenv/config';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaClient, Role, SubscriptionStatus } from '@prisma/client';

const prisma = new PrismaClient();
const apiBase = process.env.RECOVERY_API_BASE_URL ?? 'http://localhost:3001';
const marker = `qa-r2-course-v5-${randomUUID()}`;

const unwrap = (body: unknown): any =>
  body && typeof body === 'object' && 'data' in body
    ? (body as { data: unknown }).data
    : body;

async function api(path: string, token: string, init?: RequestInit) {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  return {
    status: response.status,
    body: unwrap(await response.json().catch(() => null)),
  };
}

async function main() {
  const password = `Course-${randomUUID()}-Aa1!`;
  const email = `${marker}@breadtrans.local`;
  let userId: number | undefined;
  let accessToken: string | undefined;
  try {
    const pro = await prisma.planVersion.findFirstOrThrow({
      where: {
        isCurrent: true,
        status: 'PUBLISHED',
        plan: { code: 'PRO' },
      },
      select: { id: true },
    });
    const user = await prisma.user.create({
      data: {
        email,
        password: await bcrypt.hash(password, 10),
        role: Role.STUDENT,
        emailVerifiedAt: new Date(),
        profile: { create: { fullName: 'QA Course V5' } },
      },
    });
    userId = user.id;
    await prisma.subscription.create({
      data: {
        userId,
        planVersionId: pro.id,
        status: SubscriptionStatus.ACTIVE,
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 60 * 60_000),
      },
    });
    const login = await fetch(`${apiBase}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, deviceId: marker }),
    });
    const loginBody = unwrap(await login.json()) as { access_token?: string };
    if (!login.ok || !loginBody.access_token) throw new Error('QA login failed');
    accessToken = loginBody.access_token;

    const courses: Record<string, unknown> = {};
    let firstLesson: any;
    for (const courseId of [1, 8, 12]) {
      const overview = await api(`/courses/${courseId}/learning`, accessToken);
      if (overview.status !== 200 || !Array.isArray(overview.body?.lessons)) {
        throw new Error(`Course ${courseId} overview failed: HTTP ${overview.status}`);
      }
      const lessonId = overview.body.lessons[0]?.id;
      const lesson = await api(
        `/courses/${courseId}/learning/lessons/${lessonId}`,
        accessToken,
      );
      if (lesson.status !== 200 || !Array.isArray(lesson.body?.lesson?.exercises)) {
        throw new Error(`Course ${courseId} lesson failed: HTTP ${lesson.status}`);
      }
      courses[String(courseId)] = {
        overviewStatus: overview.status,
        lessonStatus: lesson.status,
        lessonCount: overview.body.lessons.length,
        sectionCount: lesson.body.lesson.sections.length,
        exerciseCount: lesson.body.lesson.exercises.length,
        mediaCount: lesson.body.lesson.media.length,
      };
      if (courseId === 1) firstLesson = lesson.body.lesson;
    }
    const exercise = firstLesson.exercises[0];
    const answers = exercise.questions.map((question: any) => ({
      questionId: question.id,
      answer: Array.isArray(question.options) ? question.options[0] : null,
    }));
    const path = `/courses/1/learning/lessons/${firstLesson.id}/exercises/${exercise.id}/submit`;
    const submit = () =>
      api(path, accessToken!, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answers }),
      });
    const first = await submit();
    const second = await submit();
    const readback = await api('/courses/1/learning', accessToken);
    if (
      first.status !== 200 ||
      second.status !== 200 ||
      first.body?.attemptId !== second.body?.attemptId ||
      readback.status !== 200
    ) {
      throw new Error('Course V5 submit/dedup/readback verification failed');
    }
    console.log(
      JSON.stringify({
        COURSE_V5_RUNTIME: 'PASS',
        courses,
        progress: {
          submitStatus: first.status,
          deduplicated: first.body.attemptId === second.body.attemptId,
          score: first.body.score,
          maxScore: first.body.maxScore,
          readbackStatus: readback.status,
        },
      }),
    );
  } finally {
    if (accessToken) {
      await fetch(`${apiBase}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      }).catch(() => undefined);
    }
    if (userId) {
      await prisma.subscription.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } });
    }
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
