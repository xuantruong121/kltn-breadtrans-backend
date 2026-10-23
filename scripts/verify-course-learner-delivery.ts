/**
 * Verify every published course is actually deliverable through the learner V5
 * path (spec §26), not merely present as rows.
 *
 * For each course it walks the real learner API as a paid identity:
 *   GET /courses/:id/learning                      -> lesson list
 *   GET /courses/:id/learning/lessons/:lessonId    -> sections, exercises, media
 *
 * A published lesson with no sections or no exercises counts as incomplete, and
 * every lesson media reference must actually resolve.
 *
 * Read-only.
 *
 * Usage: npx ts-node scripts/verify-course-learner-delivery.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:3001';
const PASSWORD = process.env.SEED_PASSWORD ?? 'Password123!';
// Course library access is a PRO entitlement, so delivery is verified as PRO.
const LEARNER_EMAIL = process.env.SMOKE_PRO_EMAIL ?? 'student2@breadtrans.com';

type LessonSummary = { id: number; order: number; title: string };

async function login(email: string) {
  const response = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = (await response.json()) as {
    data?: { access_token?: string; accessToken?: string };
  };
  const token = body.data?.access_token ?? body.data?.accessToken;
  if (!token) throw new Error(`login failed for ${email}: ${response.status}`);
  return token;
}

const mediaCache = new Map<string, boolean>();
async function resolves(url: string) {
  if (mediaCache.has(url)) return mediaCache.get(url)!;
  let ok = false;
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
    });
    ok = response.ok;
  } catch {
    ok = false;
  }
  mediaCache.set(url, ok);
  return ok;
}

async function main() {
  const prisma = new PrismaClient();
  const problems: string[] = [];
  try {
    const courses = await prisma.course.findMany({
      where: { status: 'PUBLISHED' },
      select: {
        id: true,
        title: true,
        _count: { select: { courseLessons: true } },
      },
      orderBy: { id: 'asc' },
    });
    const token = await login(LEARNER_EMAIL);
    const headers = { Authorization: `Bearer ${token}` };

    let incompleteLessons = 0;
    let brokenMedia = 0;

    for (const course of courses) {
      const overviewResponse = await fetch(
        `${BASE}/courses/${course.id}/learning`,
        { headers },
      );
      const overviewBody = (await overviewResponse.json()) as {
        data?: { lessons?: LessonSummary[] };
      };
      if (overviewResponse.status !== 200) {
        problems.push(
          `course ${course.id}: overview HTTP ${overviewResponse.status}`,
        );
        continue;
      }
      const lessons = overviewBody.data?.lessons ?? [];
      if (lessons.length !== course._count.courseLessons)
        problems.push(
          `course ${course.id}: API served ${lessons.length} lessons but DB holds ${course._count.courseLessons}`,
        );

      let sections = 0;
      let exercises = 0;
      let media = 0;

      for (const summary of lessons) {
        const lessonResponse = await fetch(
          `${BASE}/courses/${course.id}/learning/lessons/${summary.id}`,
          { headers },
        );
        if (lessonResponse.status !== 200) {
          problems.push(
            `course ${course.id} lesson ${summary.id}: HTTP ${lessonResponse.status}`,
          );
          continue;
        }
        const lessonBody = (await lessonResponse.json()) as {
          data?: {
            lesson?: {
              title?: string;
              sections?: unknown[];
              exercises?: unknown[];
              media?: Array<{ url?: string }>;
            };
          };
        };
        const lesson = lessonBody.data?.lesson;
        const lessonSections = lesson?.sections ?? [];
        const lessonExercises = lesson?.exercises ?? [];
        const lessonMedia = lesson?.media ?? [];
        sections += lessonSections.length;
        exercises += lessonExercises.length;
        media += lessonMedia.length;

        if (!lesson?.title)
          problems.push(`course ${course.id} lesson ${summary.id}: no title`);
        if (!lessonSections.length) {
          incompleteLessons++;
          problems.push(
            `course ${course.id} lesson ${summary.id}: zero sections`,
          );
        }
        if (!lessonExercises.length) {
          incompleteLessons++;
          problems.push(
            `course ${course.id} lesson ${summary.id}: zero exercises`,
          );
        }
        for (const item of lessonMedia) {
          if (!item.url) continue;
          if (!(await resolves(item.url))) {
            brokenMedia++;
            problems.push(
              `course ${course.id} lesson ${summary.id}: media does not resolve ${item.url}`,
            );
          }
        }
      }

      console.log(
        `  course ${String(course.id).padEnd(3)} lessons=${String(lessons.length).padEnd(3)} ` +
          `sections=${String(sections).padEnd(4)} exercises=${String(exercises).padEnd(3)} media=${String(media).padEnd(3)} ${course.title}`,
      );
    }

    console.log(`\npublished incomplete lessons : ${incompleteLessons}`);
    console.log(`broken lesson media          : ${brokenMedia}`);
    console.log(`problems                     : ${problems.length}`);
    for (const problem of problems.slice(0, 20)) console.log(`  - ${problem}`);
    console.log(`\nCOURSE_LEARNER_DELIVERY_PASS=${problems.length === 0}`);
    if (problems.length) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(
    'Course learner delivery check failed:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
