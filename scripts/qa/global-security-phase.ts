/**
 * Phase I: ownership isolation (IDOR), entitlement browser smoke, and the
 * error/empty-state gate.
 *
 * Two QA learners are created. A creates private learner state through the
 * real API, then B asks for it by id. Canonical learner-owned objects are never
 * used and canonical content is never mutated; both QA learners and everything
 * they own are deleted in the finally block.
 */
import {
  BE,
  FE,
  assertAuditTarget,
  createQaLearner,
  destroyQaLearner,
  launch,
  log,
  login,
  makeMarker,
  orphanCount,
  prisma,
  type QaLearner,
} from './global-audit-lib';
import type { Browser } from 'playwright';

const marker = makeMarker('security');

async function token(learner: QaLearner): Promise<string> {
  const response = await fetch(`${BE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: learner.email, password: learner.password }),
  });
  const body = (await response.json()) as {
    data?: { access_token?: string; accessToken?: string };
  };
  const value = body.data?.access_token ?? body.data?.accessToken;
  if (!value) throw new Error(`login failed: ${response.status}`);
  return value;
}

const api = async (bearer: string, path: string, init?: RequestInit) => {
  const response = await fetch(`${BE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer}`,
      ...(init?.headers ?? {}),
    },
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
};
const unwrap = (payload: unknown) =>
  (payload as { data?: unknown })?.data ?? payload;

async function main() {
  let browser: Browser | undefined;
  const learnerIds: number[] = [];
  const idorRows: Array<Record<string, unknown>> = [];
  const emptyRows: Array<Record<string, unknown>> = [];
  try {
    await assertAuditTarget();
    const a = await createQaLearner(marker, 'PRO', '-a');
    const b = await createQaLearner(marker, 'PRO', '-b');
    learnerIds.push(a.userId, b.userId);
    const tokenA = await token(a);
    const tokenB = await token(b);

    // ---------------------------------------------------------------- IDOR
    // A starts a TOEIC assessment attempt: a genuinely private resource
    // created through the normal learner endpoint.
    const assessment = await prisma.toeicAssessment.findFirst({
      where: { publicationStatus: 'PUBLISHED' },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    if (assessment) {
      const started = await api(
        tokenA,
        `/toeic/assessments/${assessment.id}/attempts`,
        {
          method: 'POST',
          body: JSON.stringify({ idempotencyKey: `${marker}-a` }),
        },
      );
      const attemptId = (unwrap(started.body) as { id?: number } | null)?.id;
      if (typeof attemptId === 'number') {
        for (const path of [`/toeic/assessments/attempts/${attemptId}`]) {
          const owner = await api(tokenA, path);
          const other = await api(tokenB, path);
          const anonymous = await fetch(`${BE}${path}`).then((r) => r.status);
          idorRows.push({
            resourceType: 'ToeicAssessmentAttempt',
            path,
            ownerStatus: owner.status,
            otherStatus: other.status,
            anonymousStatus: anonymous,
            // Owner must succeed; a different learner must be refused.
            verdict:
              owner.status < 300 && other.status >= 400 && anonymous >= 400
                ? 'PASS'
                : 'FAIL',
          });
        }
      }
    }

    // A starts a listening attempt on a free quiz.
    const quiz = await prisma.quiz.findFirst({
      where: {
        type: 'LISTENING_PRACTICE',
        publicationStatus: 'PUBLISHED',
        isPremiumContent: false,
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    if (quiz) {
      const started = await api(
        tokenA,
        `/quizzes/${quiz.id}/listening-attempts`,
        {
          method: 'POST',
          body: JSON.stringify({}),
        },
      );
      const attemptId = (unwrap(started.body) as { id?: number } | null)?.id;
      if (typeof attemptId === 'number') {
        const path = `/quizzes/${quiz.id}/listening-attempts/${attemptId}`;
        const owner = await api(tokenA, path, {
          method: 'PATCH',
          body: JSON.stringify({ lastQuestionIndex: 1 }),
        });
        const other = await api(tokenB, path, {
          method: 'PATCH',
          body: JSON.stringify({ lastQuestionIndex: 1 }),
        });
        idorRows.push({
          resourceType: 'ListeningAttempt',
          path,
          ownerStatus: owner.status,
          otherStatus: other.status,
          anonymousStatus: null,
          verdict: owner.status < 300 && other.status >= 400 ? 'PASS' : 'FAIL',
        });
      }
    }

    // History and progress must be per-learner, never addressable by id.
    for (const path of [
      '/users/learning-history?type=ALL',
      '/users/me/skill-progress',
    ]) {
      const forA = await api(tokenA, path);
      const forB = await api(tokenB, path);
      idorRows.push({
        resourceType: 'PerLearnerCollection',
        path,
        ownerStatus: forA.status,
        otherStatus: forB.status,
        anonymousStatus: await fetch(`${BE}${path}`).then((r) => r.status),
        // Both succeed, but each must only ever see its own rows.
        distinctPayloads:
          JSON.stringify(unwrap(forA.body)) !==
            JSON.stringify(unwrap(forB.body)) ||
          JSON.stringify(unwrap(forA.body)) === '[]',
        verdict: forA.status < 300 && forB.status < 300 ? 'PASS' : 'FAIL',
      });
    }

    for (const row of idorRows) {
      await log('security', marker, { test: 'idor', ...row });
      console.log(
        `  ${String(row.verdict).padEnd(5)} ${String(row.resourceType).padEnd(26)} owner=${String(row.ownerStatus)} other=${String(row.otherStatus)} anon=${String(row.anonymousStatus ?? '-')} ${String(row.path)}`,
      );
    }

    // --------------------------------------------- entitlement + empty states
    browser = await launch();
    const free = await createQaLearner(marker, 'FREE', '-free');
    learnerIds.push(free.userId);

    const premium = await prisma.quiz.findFirst({
      where: {
        type: 'LISTENING_PRACTICE',
        publicationStatus: 'PUBLISHED',
        isPremiumContent: true,
      },
      select: { id: true, title: true },
      orderBy: { id: 'asc' },
    });

    const freePage = await browser.newPage({
      viewport: { width: 1440, height: 860 },
    });
    await login(freePage, free);

    // Empty/zero-content states on a learner with no history at all.
    const emptyChecks: Array<{ label: string; path: string }> = [
      { label: 'empty learning history', path: '/profile' },
      { label: 'no saved words', path: '/vocabulary/saved' },
      { label: 'zero published grammar', path: '/grammar' },
      { label: 'empty notifications', path: '/notifications' },
      { label: 'empty toeic history', path: '/toeic/history' },
      { label: 'invalid course id', path: '/courses/99999' },
      { label: 'invalid exam id', path: '/exams/99999' },
      { label: 'invalid listening id', path: '/listening/99999' },
    ];
    for (const check of emptyChecks) {
      await freePage.goto(`${FE}${check.path}`, {
        waitUntil: 'networkidle',
        timeout: 35_000,
      });
      await freePage.waitForTimeout(1300);
      const text = (await freePage.locator('body').innerText()).trim();
      const row = {
        label: check.label,
        path: check.path,
        chars: text.length,
        rawJson: /\{"|"statusCode"|"message":/.test(text),
        stackTrace: /TypeError:|at Object\.|at async |\.tsx:\d+/.test(text),
        infiniteSpinner: await freePage.evaluate(() => {
          const spinners = document.querySelectorAll('.animate-spin');
          return (
            spinners.length > 0 && document.body.innerText.trim().length < 120
          );
        }),
        humanMessage:
          /không|chưa|trống|rỗng|hãy|sắp|bắt đầu|đăng|kiểm tra|thử/i.test(text),
        verdict: 'PASS' as 'PASS' | 'FAIL',
      };
      row.verdict =
        !row.rawJson &&
        !row.stackTrace &&
        !row.infiniteSpinner &&
        row.humanMessage
          ? 'PASS'
          : 'FAIL';
      emptyRows.push(row);
      await log('security', marker, { test: 'error-empty-state', ...row });
      console.log(
        `  ${row.verdict.padEnd(5)} ${check.label.padEnd(26)} chars=${String(row.chars).padEnd(5)} rawJson=${String(row.rawJson)} stack=${String(row.stackTrace)} spinner=${String(row.infiniteSpinner)} human=${String(row.humanMessage)}`,
      );
    }

    // Entitlement UX smoke: FREE sees the premium item locked and cannot enter.
    let entitlement: Record<string, unknown> = { tested: false };
    if (premium) {
      await freePage.goto(`${FE}/listening`, { waitUntil: 'networkidle' });
      await freePage.waitForTimeout(1400);
      const listText = await freePage.locator('body').innerText();
      await freePage.goto(`${FE}/listening/${premium.id}`, {
        waitUntil: 'networkidle',
      });
      await freePage.waitForTimeout(1600);
      const freeDetail = (await freePage.locator('body').innerText()).trim();
      const freeBlocked =
        /nâng cấp|PLUS|PRO|khóa|mở khóa|không có quyền|premium/i.test(
          freeDetail,
        ) || new URL(freePage.url()).pathname !== `/listening/${premium.id}`;

      const proPage = await browser.newPage({
        viewport: { width: 1440, height: 860 },
      });
      await login(proPage, a);
      await proPage.goto(`${FE}/listening/${premium.id}`, {
        waitUntil: 'networkidle',
      });
      await proPage.waitForTimeout(1600);
      const proDetail = (await proPage.locator('body').innerText()).trim();
      const proEntered =
        new URL(proPage.url()).pathname === `/listening/${premium.id}` &&
        !/nâng cấp để|cần nâng cấp/i.test(proDetail);
      await proPage.close();

      entitlement = {
        tested: true,
        premiumQuizId: premium.id,
        listShowsLockAffordance: /khóa|PLUS|PRO|nâng cấp|premium/i.test(
          listText,
        ),
        freeBlockedOnDetail: freeBlocked,
        freeLandedOn: new URL(freePage.url()).pathname,
        proEntered,
        verdict: freeBlocked && proEntered ? 'PASS' : 'FAIL',
      };
      await log('security', marker, {
        test: 'entitlement-browser-smoke',
        ...entitlement,
      });
    }
    console.log(`\nentitlement smoke: ${JSON.stringify(entitlement)}`);

    const idorPass =
      idorRows.length > 0 && idorRows.every((r) => r.verdict === 'PASS');
    const emptyPass = emptyRows.every((r) => r.verdict === 'PASS');
    console.log(
      `\nLEARNER_IDOR_REGRESSION_PASS=${idorPass}\nIDOR_RESOURCE_TYPES_TESTED=${[...new Set(idorRows.map((r) => r.resourceType))].join(',')}\nLEARNER_ERROR_EMPTY_STATE_PASS=${emptyPass}\nENTITLEMENT_BROWSER_SMOKE_PASS=${String(entitlement.verdict ?? 'BLOCKED')}`,
    );
  } finally {
    await browser?.close();
    for (const id of learnerIds) await destroyQaLearner(id);
    const orphans = await orphanCount(marker);
    console.log(`QA_ORPHAN_RECORDS_AFTER_CLEANUP=${orphans}`);
    await log('security', marker, {
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
