/**
 * One bounded phase of the global learner browser audit.
 *
 * Usage: npx ts-node scripts/qa/global-browser-phase.ts A
 *
 * Phases follow the audit plan: A dashboard/profile/progress/history,
 * B courses, C flashcards/vocabulary, D the four skills, E grammar/diagnostic,
 * F shop/gamification, G arena, H TOEIC regression, I security/ownership.
 *
 * Every concrete id is resolved from live data; nothing is hardcoded. Each run
 * creates its own QA learner and deletes it in a finally block.
 */
import {
  type RouteExpectation,
  type RouteResult,
  VIEWPORTS,
  auditForwardScroll,
  auditResponsive,
  auditRoute,
  auditSamePageScroll,
  createQaLearner,
  destroyQaLearner,
  launch,
  log,
  login,
  makeMarker,
  orphanCount,
  prisma,
  BE,
  FE,
} from './global-audit-lib';
import type { Browser, Page } from 'playwright';

const phase = (process.argv[2] ?? '').toUpperCase();
if (!/^[A-I]$/.test(phase)) {
  console.error('usage: global-browser-phase.ts <A|B|C|D|E|F|G|H|I>');
  process.exit(2);
}
const marker = makeMarker(phase);

/** Concrete ids for the dynamic route families, from current data. */
async function resolveIds() {
  const [course, lesson, vocabTopic, listening, speaking, reading, writing] =
    await Promise.all([
      prisma.course.findFirst({
        where: { status: 'PUBLISHED' },
        select: { id: true, title: true },
        orderBy: { id: 'asc' },
      }),
      prisma.courseLesson.findFirst({
        where: { status: 'PUBLISHED' },
        select: { id: true, courseId: true, title: true },
        orderBy: { id: 'asc' },
      }),
      prisma.vocabTopic.findFirst({
        where: { publicationStatus: 'PUBLISHED' },
        select: { id: true, title: true },
        orderBy: { id: 'asc' },
      }),
      prisma.quiz.findFirst({
        where: {
          type: 'LISTENING_PRACTICE',
          publicationStatus: 'PUBLISHED',
          isPremiumContent: false,
        },
        select: { id: true, title: true },
        orderBy: { id: 'asc' },
      }),
      prisma.speakingExercise.findFirst({
        where: { publicationStatus: 'PUBLISHED', isPremiumContent: false },
        select: { id: true, title: true },
        orderBy: { id: 'asc' },
      }),
      prisma.quiz.findFirst({
        where: {
          type: 'BILINGUAL_READING',
          publicationStatus: 'PUBLISHED',
          isPremiumContent: false,
        },
        select: { id: true, title: true },
        orderBy: { id: 'asc' },
      }),
      prisma.quiz.findFirst({
        where: {
          type: 'WRITING_PICTURE',
          publicationStatus: 'PUBLISHED',
          isPremiumContent: false,
        },
        select: { id: true, title: true },
        orderBy: { id: 'asc' },
      }),
    ]);
  const exams = await prisma.exam.findMany({
    where: { publicationStatus: 'PUBLISHED' },
    select: { id: true, variantCode: true, title: true },
    orderBy: { id: 'asc' },
  });
  const premiumListening = await prisma.quiz.findFirst({
    where: {
      type: 'LISTENING_PRACTICE',
      publicationStatus: 'PUBLISHED',
      isPremiumContent: true,
    },
    select: { id: true, title: true },
    orderBy: { id: 'asc' },
  });
  return {
    course,
    lesson,
    vocabTopic,
    listening,
    speaking,
    reading,
    writing,
    exams,
    premiumListening,
  };
}

type Ids = Awaited<ReturnType<typeof resolveIds>>;

/** Route sets per phase. Compression decisions are recorded as notes. */
function routesFor(phase: string, ids: Ids): RouteExpectation[] {
  const lr = ids.exams.find((e) => e.variantCode === 'TOEIC_LR');
  const sw = ids.exams.find((e) => e.variantCode === 'TOEIC_SW');
  const fs = ids.exams.find((e) => e.variantCode === 'TOEIC_4_SKILLS');
  switch (phase) {
    case 'A':
      return [
        {
          pattern: '/dashboard',
          path: '/dashboard',
          domain: 'Dashboard',
          identity: /Nhiệm vụ|Chuỗi|Bánh|Tiến độ|Hôm nay|Luyện tập/i,
        },
        {
          pattern: '/hub',
          path: '/hub',
          domain: 'Dashboard',
          identity: /\S/,
        },
        {
          pattern: '/learn',
          path: '/learn',
          domain: 'Dashboard',
          identity: /\S/,
        },
        {
          pattern: '/student-home',
          path: '/student-home',
          domain: 'Dashboard',
          identity: /\S/,
        },
        {
          pattern: '/plans',
          path: '/plans',
          domain: 'Plans / Entitlement',
          identity: /FREE|PLUS|PRO|gói|Gói/,
        },
        {
          pattern: '/notifications',
          path: '/notifications',
          domain: 'Notifications',
          identity: /[Tt]hông báo|[Hh]ộp thư|trống/,
          emptyStateAllowed: true,
        },
        {
          pattern: '/messages',
          path: '/messages',
          domain: 'Notifications',
          identity: /[Tt]in nhắn|[Hh]ỗ trợ|trống/,
          emptyStateAllowed: true,
        },
      ];
    case 'B':
      return [
        {
          pattern: '/courses',
          path: '/courses',
          domain: 'Courses',
          identity: /[Kk]hóa học/,
        },
        ...(ids.course
          ? [
              {
                pattern: '/courses/:id',
                path: `/courses/${ids.course.id}`,
                domain: 'Courses',
                identity: /[Bb]ài học|[Nn]ội dung|[Kk]hóa học/,
              } as RouteExpectation,
            ]
          : []),
        // Both of these are intentional server redirects to /courses (the old
        // learner catalogs were retired), so the identity checked is the
        // destination's, not a Classes/My-courses page of their own.
        {
          pattern: '/my-courses (redirects to /courses)',
          path: '/my-courses',
          domain: 'Courses',
          identity: /[Kk]hóa học/,
        },
        {
          pattern: '/classes (redirects to /courses)',
          path: '/classes',
          domain: 'Classes',
          identity: /[Kk]hóa học/,
        },
      ];
    case 'C':
      return [
        {
          pattern: '/flashcard',
          path: '/flashcard',
          domain: 'Flashcards',
          identity: /[Tt]hẻ|[Tt]ừ vựng|[Bb]ộ/,
        },
        ...(ids.vocabTopic
          ? [
              {
                pattern: '/flashcard/:id',
                path: `/flashcard/${ids.vocabTopic.id}`,
                domain: 'Flashcards',
                identity: /\S/,
              } as RouteExpectation,
            ]
          : []),
        {
          pattern: '/vocabulary/saved',
          path: '/vocabulary/saved',
          domain: 'Vocabulary',
          identity: /[Tt]ừ|[Ll]ưu|trống|chưa/,
          emptyStateAllowed: true,
        },
        {
          pattern: '/vocabulary/study',
          path: '/vocabulary/study',
          domain: 'Vocabulary',
          identity: /\S/,
          emptyStateAllowed: true,
        },
      ];
    case 'D':
      return [
        {
          pattern: '/listening',
          path: '/listening',
          domain: 'Listening',
          identity: /[Nn]ghe/,
        },
        ...(ids.listening
          ? [
              {
                pattern: '/listening/:id',
                path: `/listening/${ids.listening.id}`,
                domain: 'Listening',
                identity: /\S/,
              } as RouteExpectation,
            ]
          : []),
        {
          pattern: '/speaking',
          path: '/speaking',
          domain: 'Speaking',
          identity: /[Nn]ói/,
        },
        ...(ids.speaking
          ? [
              {
                pattern: '/speaking/:id',
                path: `/speaking/${ids.speaking.id}`,
                domain: 'Speaking',
                identity: /\S/,
              } as RouteExpectation,
            ]
          : []),
        {
          pattern: '/reading',
          path: '/reading',
          domain: 'Reading',
          identity: /[Đđ]ọc/,
        },
        ...(ids.reading
          ? [
              {
                pattern: '/reading/:id',
                path: `/reading/${ids.reading.id}`,
                domain: 'Reading',
                identity: /\S/,
              } as RouteExpectation,
            ]
          : []),
        {
          pattern: '/reading/mistakes',
          path: '/reading/mistakes',
          domain: 'Reading',
          identity: /\S/,
          emptyStateAllowed: true,
        },
        {
          pattern: '/writing',
          path: '/writing',
          domain: 'Writing',
          identity: /[Vv]iết/,
        },
        ...(ids.writing
          ? [
              {
                pattern: '/writing/:id',
                path: `/writing/${ids.writing.id}`,
                domain: 'Writing',
                identity: /\S/,
              } as RouteExpectation,
            ]
          : []),
      ];
    case 'E':
      return [
        {
          pattern: '/grammar',
          path: '/grammar',
          domain: 'Grammar',
          identity: /\S/,
          emptyStateAllowed: true,
        },
        {
          pattern: '/diagnostic',
          path: '/diagnostic',
          domain: 'Diagnostic',
          identity: /[Kk]iểm tra|[Đđ]ầu vào|[Bb]ắt đầu/,
        },
      ];
    case 'F':
      return [
        {
          pattern: '/market',
          path: '/market',
          domain: 'Market / Shop',
          identity: /[Cc]ửa hàng|[Bb]ánh|[Vv]ật phẩm|[Mm]ua/,
        },
        {
          pattern: '/pet',
          path: '/pet',
          domain: 'Gamification',
          identity: /\S/,
        },
      ];
    case 'G':
      return [
        {
          pattern: '/arena',
          path: '/arena',
          domain: 'Vocabulary 1v1 Arena',
          identity: /[Aa]rena|[Đđ]ấu|[Xx]ếp hạng|[Bb]ánh/,
        },
      ];
    case 'H':
      return [
        {
          pattern: '/exams',
          path: '/exams',
          domain: 'TOEIC',
          identity: /TOEIC/,
        },
        ...(lr
          ? [
              {
                pattern: '/exams/:id (L&R)',
                path: `/exams/${lr.id}`,
                domain: 'TOEIC',
                identity: /200 câu|Part 1/,
                primaryAction: /Bắt đầu làm bài|Tiếp tục làm bài/,
              } as RouteExpectation,
            ]
          : []),
        ...(sw
          ? [
              {
                pattern: '/exams/:id (S&W)',
                path: `/exams/${sw.id}`,
                domain: 'TOEIC',
                identity: /11 nhiệm vụ/,
                primaryAction: /Bắt đầu làm bài|Tiếp tục làm bài/,
              } as RouteExpectation,
            ]
          : []),
        ...(fs
          ? [
              {
                pattern: '/exams/:id (4 Skills)',
                path: `/exams/${fs.id}`,
                domain: 'TOEIC',
                identity: /200 câu/,
                primaryAction: /Bắt đầu làm bài|Tiếp tục làm bài/,
              } as RouteExpectation,
            ]
          : []),
        {
          pattern: '/toeic/history',
          path: '/toeic/history',
          domain: 'TOEIC',
          identity: /\S/,
          emptyStateAllowed: true,
        },
      ];
    default:
      return [];
  }
}

async function runRoutes(page: Page, routes: RouteExpectation[]) {
  const results: RouteResult[] = [];
  for (const route of routes) {
    const result = await auditRoute(page, route);
    results.push(result);
    await log(phase, marker, { test: 'route-render', ...result });
    console.log(
      `  ${result.verdict.padEnd(7)} ${route.pattern.padEnd(32)} http=${String(result.httpStatus).padEnd(4)} identity=${result.identityFound} chars=${result.textLength}${result.errorBoundary ? ` boundary="${result.errorBoundary}"` : ''}${result.backendLeak ? ` leak="${result.backendLeak}"` : ''}${result.stillLoading ? ' STILL_LOADING' : ''}${result.notes ? ` (${result.notes.slice(0, 60)})` : ''}`,
    );
  }
  return results;
}

/** Extra, phase-specific checks beyond the plain render gate. */
async function runExtras(phase: string, page: Page) {
  const extras: Record<string, unknown> = {};

  if (phase === 'B') {
    extras.forwardScroll = await auditForwardScroll(
      page,
      '/courses',
      /Xem chi tiết|Vào học|Bắt đầu|Chi tiết/i,
      /\/courses\/\d+/,
    );
    await log(phase, marker, {
      test: 'forward-scroll',
      ...(extras.forwardScroll as object),
    });
  }
  if (phase === 'C') {
    extras.forwardScroll = await auditForwardScroll(
      page,
      '/flashcard',
      /Bắt đầu học|Ôn tập|Học ngay/i,
      /\/flashcard\/\d+/,
    );
    await log(phase, marker, {
      test: 'forward-scroll',
      ...(extras.forwardScroll as object),
    });
  }
  if (phase === 'D') {
    extras.forwardScrollListening = await auditForwardScroll(
      page,
      '/listening',
      /Bắt đầu|Luyện nghe|Vào bài/i,
      /\/listening\/\d+/,
    );
    await log(phase, marker, {
      test: 'forward-scroll',
      surface: 'listening',
      ...(extras.forwardScrollListening as object),
    });
    extras.samePageReadingFilter = await auditSamePageScroll(
      page,
      '/reading',
      /Ngữ pháp|Đọc hiểu|Tất cả/i,
      'reading category filter',
    );
    await log(phase, marker, {
      test: 'same-page-scroll',
      ...(extras.samePageReadingFilter as object),
    });
  }
  if (phase === 'F') {
    extras.samePageMarketFilter = await auditSamePageScroll(
      page,
      '/market',
      /Vật phẩm|Tất cả|Trang trí/i,
      'market category tab',
    );
    await log(phase, marker, {
      test: 'same-page-scroll',
      ...(extras.samePageMarketFilter as object),
    });
  }
  if (phase === 'G') {
    // Arena: balance presentation and the insufficient-balance UX (known OPEN).
    await page.goto(`${FE}/arena`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    const body = await page.locator('body').innerText();
    const stakes = await page
      .getByRole('button', { name: /^\s*\d+\s*Bánh/ })
      .count();
    const findMatch = page.getByRole('button', {
      name: /Tìm trận|Bắt đầu|Vào trận/i,
    });
    const arena: Record<string, unknown> = {
      stakeButtons: stakes,
      showsBalanceSomewhere: /Bánh/.test(body),
      hasFindMatch: (await findMatch.count()) > 0,
      leaderboardPresent: /[Xx]ếp hạng|Top/.test(body),
    };
    // Click find-match on a zero-balance QA learner and capture what is shown.
    if (arena.hasFindMatch) {
      await findMatch.first().click();
      await page.waitForTimeout(2500);
      const after = await page.locator('body').innerText();
      arena.afterFindMatchShowsError = /không đủ|Bánh Mì|thất bại|lỗi/i.test(
        after,
      );
      arena.afterFindMatchRawSocketLeak =
        /\{"|statusCode|socket|undefined/.test(after.slice(0, 4000));
      arena.message =
        after
          .split('\n')
          .map((l) => l.trim())
          .find((l) => /không đủ/i.test(l)) ?? null;
    }
    extras.arena = arena;
    await log(phase, marker, { test: 'arena-smoke', ...arena });
  }
  if (phase === 'H') {
    extras.forwardScrollExams = await auditForwardScroll(
      page,
      '/exams',
      /TOEIC 2 Skills: Listening/i,
      /\/exams\/\d+/,
    );
    await log(phase, marker, {
      test: 'forward-scroll',
      surface: 'exams',
      ...(extras.forwardScrollExams as object),
    });
  }
  return extras;
}

async function main() {
  let browser: Browser | undefined;
  let learnerId: number | undefined;
  const started = Date.now();
  try {
    const ids = await resolveIds();
    const learner = await createQaLearner(marker, 'PLUS');
    learnerId = learner.userId;
    browser = await launch();
    const page = await browser.newPage({
      viewport: { width: 1440, height: 860 },
    });
    await login(page, learner);

    const routes = routesFor(phase, ids);
    console.log(`phase ${phase}: ${routes.length} routes`);
    const results = await runRoutes(page, routes);
    const extras = await runExtras(phase, page);

    const pass = results.filter((r) => r.verdict === 'PASS').length;
    const fail = results.filter((r) => r.verdict === 'FAIL').length;
    const blocked = results.filter((r) => r.verdict === 'BLOCKED').length;
    console.log(
      `\nphase ${phase} routes: PASS=${pass} FAIL=${fail} BLOCKED=${blocked}`,
    );
    if (Object.keys(extras).length) {
      console.log('extras:', JSON.stringify(extras, null, 2));
    }
    await log(phase, marker, {
      test: 'phase-summary',
      routes: results.length,
      pass,
      fail,
      blocked,
      durationMs: Date.now() - started,
    });
  } finally {
    await browser?.close();
    if (learnerId) await destroyQaLearner(learnerId);
    const orphans = await orphanCount(marker);
    console.log(`QA_ORPHAN_RECORDS_AFTER_CLEANUP=${orphans}`);
    await log(phase, marker, {
      test: 'cleanup',
      result: orphans === 0 ? 'PASS' : 'FAIL',
      orphanRecords: orphans,
    });
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

export { BE, FE, VIEWPORTS, auditResponsive };
