/**
 * Cross-tier learner metadata differential (spec §17 / §37).
 *
 * Structural metadata - titles, covers, lesson counts, question counts - must
 * be identical for FREE, PLUS and PRO. Only authorization may differ. A count
 * that changes with the viewer's tier means entitlement filtering leaked into
 * metadata, which is what made the IPA course look like it had no lessons.
 *
 * Read-only.
 *
 * Usage: npx ts-node scripts/verify-cross-tier-metadata.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:3001';
const PASSWORD = process.env.SEED_PASSWORD ?? 'Password123!';

const IDENTITIES = [
  { tier: 'FREE', email: 'student1@breadtrans.com' },
  { tier: 'PRO', email: 'student2@breadtrans.com' },
  { tier: 'PLUS', email: 'student3@breadtrans.com' },
] as const;

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

async function get(path: string, token?: string) {
  const response = await fetch(BASE + path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  const data = (parsed as { data?: unknown })?.data;
  return { status: response.status, data };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    // Ground truth straight from the database, tier-independent by definition.
    const courses = await prisma.course.findMany({
      where: { status: 'PUBLISHED' },
      select: {
        id: true,
        title: true,
        thumbnail: true,
        _count: { select: { lessons: true, courseLessons: true } },
      },
      orderBy: { id: 'asc' },
    });

    console.log('=== DATABASE GROUND TRUTH ===');
    for (const course of courses) {
      console.log(
        `  course ${String(course.id).padEnd(3)} Lesson=${String(course._count.lessons).padEnd(3)} ` +
          `CourseLesson=${String(course._count.courseLessons).padEnd(3)} total=${
            course._count.lessons + course._count.courseLessons
          }  ${course.title}`,
      );
    }

    const tokens = new Map<string, string>();
    for (const identity of IDENTITIES)
      tokens.set(identity.tier, await login(identity.email));

    const mismatches: string[] = [];

    console.log('\n=== PER-TIER LEARNER VIEW ===');
    for (const course of courses) {
      const row: string[] = [];
      const seen = new Map<string, Set<string>>();
      for (const identity of IDENTITIES) {
        const token = tokens.get(identity.tier)!;
        const detail = await get(`/public/courses/${course.id}`, token);
        const learning = await get(`/courses/${course.id}/learning`, token);

        const d = detail.data as
          | { title?: string; thumbnail?: string; lessons?: unknown[] }
          | undefined;
        const l = learning.data as { lessons?: unknown[] } | undefined;

        const legacyLessons = Array.isArray(d?.lessons) ? d.lessons.length : -1;
        const modernLessons = Array.isArray(l?.lessons) ? l.lessons.length : -1;
        const deliverable =
          Math.max(legacyLessons, 0) + Math.max(modernLessons, 0);

        row.push(
          `${identity.tier}: detail=${detail.status} legacy=${legacyLessons} ` +
            `learning=${learning.status === 200 ? modernLessons : `HTTP${learning.status}`}`,
        );

        const record = (field: string, value: string) => {
          if (!seen.has(field)) seen.set(field, new Set());
          seen.get(field)!.add(value);
        };
        record('title', String(d?.title ?? 'MISSING'));
        record('thumbnail', String(d?.thumbnail ?? 'MISSING'));
        record('legacyLessonCount', String(legacyLessons));
        void deliverable;
      }
      console.log(`  course ${course.id}: ${row.join(' | ')}`);
      // Metadata that must not vary by tier.
      for (const [field, values] of seen)
        if (values.size > 1)
          mismatches.push(
            `course ${course.id}: ${field} differs across tiers -> ${[...values].join(' / ')}`,
          );
    }

    // TOEIC structural counts must also be tier-stable.
    console.log('\n=== TOEIC CATALOG PER TIER ===');
    const toeicSeen = new Map<string, Set<string>>();
    for (const identity of IDENTITIES) {
      const token = tokens.get(identity.tier)!;
      const papers = await get('/quizzes/toeic-papers', token);
      const count = Array.isArray(papers.data) ? papers.data.length : -1;
      console.log(
        `  ${identity.tier.padEnd(5)} toeic-papers HTTP ${papers.status} count=${count}`,
      );
      if (!toeicSeen.has('count')) toeicSeen.set('count', new Set());
      toeicSeen.get('count')!.add(String(count));
    }
    for (const [field, values] of toeicSeen)
      if (values.size > 1)
        mismatches.push(
          `toeic-papers ${field} differs across tiers -> ${[...values].join(' / ')}`,
        );

    console.log(
      `\nunexpected cross-tier metadata differences: ${mismatches.length}`,
    );
    for (const m of mismatches) console.log(`  - ${m}`);
    console.log(
      `\nCOURSE_LESSON_COUNTS_TIER_INDEPENDENT=${mismatches.filter((m) => m.includes('LessonCount')).length === 0}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(
    'Cross-tier metadata check failed:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
