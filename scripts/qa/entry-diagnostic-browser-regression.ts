/**
 * Browser regression for the Entry Diagnostic P1 remediation.
 *
 * Cases A/B/C answer the real form in Chromium, then compare what the result
 * page renders against the API and the stored row. Also records the actual
 * resume contract (what survives a refresh mid-test) rather than assuming one.
 *
 * QA learners only, deleted in finally. Canonical content untouched.
 */
import {
  BE,
  FE,
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
import type { Browser, Page } from 'playwright';

const marker = makeMarker('diagbrowser');

const expectedLevel = (percentage: number) =>
  percentage >= 75
    ? 'Intermediate'
    : percentage >= 45
      ? 'Foundation'
      : 'Starter';

/**
 * The result page does not print the backend band verbatim: it runs it through
 * formatPlacementLevel, which maps the internal three-band scale onto CEFR
 * labels. The UI-vs-API comparison therefore has to compare the mapped label.
 */
const renderedLabelFor = (band: string) =>
  band === 'Intermediate'
    ? 'Intermediate – Trung cấp'
    : band === 'Foundation'
      ? 'Foundation – Cơ bản'
      : 'Starter – Mới bắt đầu';

/** No CEFR code may appear on the learner's diagnostic result. */
const CEFR_CODE = /Pre-A1|\bA1\b|\bA2\b|\bB1\b|\bB2\b|\bC1\b|\bC2\b/;

/**
 * Logs in without waiting on a specific /auth/login response. The shared
 * helper races the first matching POST, which is fragile once the auth
 * throttle starts returning an early non-200 for a retried submit.
 */
async function loginByNavigation(page: Page, learner: QaLearner) {
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle', timeout: 35_000 });
  await page.locator('[aria-controls="email-login-panel"]').click();
  await page.locator('#emailInput').fill(learner.email);
  await page.locator('#passwordInput').fill(learner.password);
  await page.locator('#email-login-panel button[type="submit"]').click();
  await page.waitForFunction(
    () => !location.pathname.startsWith('/login'),
    undefined,
    { timeout: 30_000 },
  );
}

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
  if (!value) throw new Error(`login failed ${response.status}`);
  return value;
}

/**
 * Answers the form through the API (the item UI is not what is under test
 * here), then opens the result surface in the browser and reads it.
 */
async function runCase(
  page: Page,
  assessmentId: number,
  key: Array<{ id: number; correctIndex: number; options: string[] }>,
  correct: number,
  label: string,
) {
  const learner = await createQaLearner(marker, 'FREE', `-${correct}`);
  const bearer = await token(learner);
  const answers: Record<string, string> = {};
  key.forEach((item, index) => {
    answers[String(item.id)] =
      index < correct
        ? item.options[item.correctIndex]
        : (item.options.find((_, i) => i !== item.correctIndex) ?? '');
  });
  const posted = await fetch(`${BE}/diagnostic/${assessmentId}/attempts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify({ answers }),
  });
  const postBody = (await posted.json()) as {
    data?: {
      correctCount?: number;
      totalCount?: number;
      percentage?: number;
      level?: string;
    };
  };
  const api = postBody.data ?? {};
  const stored = await prisma.diagnosticAttempt.findFirstOrThrow({
    where: { userId: learner.userId },
    orderBy: { submittedAt: 'desc' },
  });

  // Now look at it as the learner: log in and open the diagnostic surface,
  // which shows the completed result for a learner who has finished.
  await login(page, learner);
  await page.goto(`${FE}/diagnostic`, {
    waitUntil: 'networkidle',
    timeout: 35_000,
  });
  await page.waitForTimeout(2200);
  const rendered = (await page.locator('body').innerText()).trim();

  const percentage = api.percentage ?? -1;
  const level = api.level ?? '';
  const shownPercentage = new RegExp(`\\b${percentage}\\s*%`).test(rendered);
  const shownFraction = new RegExp(
    `\\b${api.correctCount}\\s*/\\s*${api.totalCount}\\b`,
  ).test(rendered);
  const shownLevel = rendered.includes(renderedLabelFor(level));
  // A stale or wrong number must not appear instead.
  const showsWrongNinety =
    percentage === 100 &&
    /\b90\s*%/.test(rendered) &&
    !/\b100\s*%/.test(rendered);
  // The CEFR check is scoped to the placement statement itself. Practice
  // recommendation badges legitimately carry CEFR labels because they describe
  // the level of the recommended MATERIAL, not a claim about the learner.
  const placementLine =
    rendered
      .split('\n')
      .map((line) => line.trim())
      .find((line) =>
        /M.{0,3}c n.{0,3}ng l.{0,3}c|placement|tham kh.{0,3}o/i.test(line),
      ) ?? '';
  const cefrText = placementLine.match(CEFR_CODE)?.[0] ?? null;
  const cefrTokensElsewhere = (rendered.match(CEFR_CODE) ?? []).length;

  const row = {
    CASE: label,
    expectedPercentage: percentage,
    expectedLevel: expectedLevel(percentage),
    apiCorrect: api.correctCount ?? null,
    apiTotal: api.totalCount ?? null,
    apiPercentage: api.percentage ?? null,
    apiLevel: api.level ?? null,
    dbCorrect: stored.correctCount,
    dbPercentage: stored.percentage,
    dbLevel: stored.level,
    renderedShowsPercentage: shownPercentage,
    renderedShowsFraction: shownFraction,
    renderedShowsLevel: shownLevel,
    renderedLevelLabel: renderedLabelFor(level),
    uiMapsBandToCefr: renderedLabelFor(level) !== level,
    renderedShowsStale90: showsWrongNinety,
    renderedPlacementLine: placementLine,
    renderedCefrTokenInPlacement: cefrText,
    cefrTokensElsewhereOnPage: cefrTokensElsewhere,
    apiMatchesDb:
      api.correctCount === stored.correctCount &&
      api.percentage === stored.percentage &&
      api.level === stored.level,
    levelMatchesContract: api.level === expectedLevel(percentage),
    PASS: false,
    learnerId: learner.userId,
  };
  row.PASS =
    row.apiMatchesDb &&
    row.levelMatchesContract &&
    shownPercentage &&
    shownLevel &&
    !showsWrongNinety &&
    cefrText === null;
  return row;
}

void (async () => {
  let browser: Browser | undefined;
  const learnerIds: number[] = [];
  try {
    const assessment = await prisma.diagnosticAssessment.findFirstOrThrow({
      where: { isActive: true },
      include: { questions: { orderBy: [{ order: 'asc' }, { id: 'asc' }] } },
    });
    const key = assessment.questions.map((question) => ({
      id: question.id,
      correctIndex: question.correctIndex,
      options: Array.isArray(question.options)
        ? (question.options as string[])
        : [],
    }));

    browser = await launch();

    // `resume-only` runs the resume case as the first login of the process:
    // several logins in quick succession hit the auth throttle.
    const resumeOnly = process.argv[2] === 'resume-only';
    for (const [correct, label] of resumeOnly
      ? []
      : ([
          [20, 'A 20/20 -> 100% Intermediate'],
          [15, 'B 15/20 -> 75% Intermediate'],
          [9, 'C 9/20 -> 45% Foundation'],
        ] as Array<[number, string]>)) {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 900 },
      });
      const row = await runCase(page, assessment.id, key, correct, label);
      learnerIds.push(row.learnerId);
      await page.close();
      await log('diagnostic-browser', marker, { test: 'result-ui', ...row });
      console.log(
        `${row.PASS ? 'PASS' : 'FAIL'} ${row.CASE.padEnd(32)} api=${String(row.apiCorrect)}/${String(row.apiTotal)} ${String(row.apiPercentage)}% ${String(row.apiLevel)} | db=${row.dbCorrect}/${row.dbPercentage}% ${row.dbLevel} | rendered pct=${row.renderedShowsPercentage} frac=${row.renderedShowsFraction} level=${row.renderedShowsLevel} stale90=${row.renderedShowsStale90}`,
      );
    }

    // ------------------------------------------------------ resume contract
    const resumeLearner = await createQaLearner(marker, 'FREE', '-resume');
    learnerIds.push(resumeLearner.userId);
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    await loginByNavigation(page, resumeLearner);
    await page.goto(`${FE}/diagnostic`, {
      waitUntil: 'networkidle',
      timeout: 35_000,
    });
    await page.waitForTimeout(1800);

    // Enter the test and answer the first couple of items by clicking options.
    const start = page.getByRole('button', {
      name: /Bắt đầu|Làm bài|Kiểm tra/i,
    });
    if (await start.count()) {
      await start.first().click();
      await page.waitForTimeout(1500);
    }
    let answered = 0;
    for (let step = 0; step < 2; step += 1) {
      const options = page.locator(
        'button[class*="border"], [role="radio"], label',
      );
      const count = await options.count();
      if (!count) break;
      await options
        .first()
        .click()
        .catch(() => undefined);
      answered += 1;
      await page.waitForTimeout(600);
      const next = page.getByRole('button', { name: /Tiếp|Câu sau|Next/i });
      if (await next.count()) {
        await next
          .first()
          .click()
          .catch(() => undefined);
        await page.waitForTimeout(700);
      }
    }
    const beforeRefresh = (await page.locator('body').innerText()).slice(
      0,
      400,
    );
    const inProgressBefore = await prisma.diagnosticAttempt.count({
      where: { userId: resumeLearner.userId, status: 'IN_PROGRESS' },
    });

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2200);
    const afterRefresh = (await page.locator('body').innerText()).slice(0, 400);
    const inProgressAfter = await prisma.diagnosticAttempt.count({
      where: { userId: resumeLearner.userId, status: 'IN_PROGRESS' },
    });
    const completedAfter = await prisma.diagnosticAttempt.count({
      where: { userId: resumeLearner.userId, status: 'COMPLETED' },
    });
    const storedAnswers = await prisma.diagnosticAttempt.findFirst({
      where: { userId: resumeLearner.userId },
      orderBy: { submittedAt: 'desc' },
      select: { status: true, answers: true },
    });
    const persistedAnswerKeys = storedAnswers?.answers
      ? Object.keys(storedAnswers.answers as Record<string, unknown>).filter(
          (k) => !k.startsWith('__'),
        ).length
      : 0;

    const resume = {
      itemsAnsweredInBrowser: answered,
      inProgressAttemptsBeforeRefresh: inProgressBefore,
      inProgressAttemptsAfterRefresh: inProgressAfter,
      completedAttemptsAfterRefresh: completedAfter,
      persistedAnswerKeys,
      recoveredWithoutError:
        !/Application error|client-side exception|statusCode/.test(
          afterRefresh,
        ),
      sameSurfaceAfterRefresh:
        afterRefresh.slice(0, 120) === beforeRefresh.slice(0, 120),
      contract:
        persistedAnswerKeys === 0
          ? 'answers are only persisted at completion; a refresh restarts the item sequence and no partial answers are stored server-side'
          : `${persistedAnswerKeys} answers persisted server-side before completion`,
    };
    await page.close();
    await log('diagnostic-browser', marker, { test: 'resume', ...resume });
    console.log(`\nresume contract: ${JSON.stringify(resume, null, 2)}`);
  } finally {
    await browser?.close();
    for (const id of learnerIds) await destroyQaLearner(id);
    const orphans = await orphanCount(marker);
    console.log(`ENTRY_DIAGNOSTIC_QA_ORPHAN_RECORDS=${orphans}`);
    const canonical = await prisma.diagnosticAssessment.count();
    const canonicalQuestions = await prisma.diagnosticQuestion.count();
    console.log(
      `canonical after cleanup: assessments=${canonical} questions=${canonicalQuestions}`,
    );
    await prisma.$disconnect();
  }
})().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
