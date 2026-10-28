/**
 * Acceptance test for the runtime back-links.
 *
 * Normal learner navigation out of a TOEIC runtime must land directly on the
 * canonical /exams/:examId, with no legacy /toeic/* URL appearing in between.
 * Every URL the main frame visits is recorded, so a compatibility hop would be
 * visible rather than hidden by the final state.
 *
 * Creates one QA learner plus its own attempt, and removes both.
 */
import './qa/qa-legacy-guard';
import 'dotenv/config';
import { randomUUID } from 'crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import * as bcrypt from 'bcrypt';
import { chromium } from 'playwright';
import { PrismaClient, Role, SubscriptionStatus } from '@prisma/client';

const prisma = new PrismaClient();
const marker = `qa-toeic-backlink-${randomUUID()}`;
const evidencePath = resolve('artifacts/learner-runtime-qa.jsonl');
const baseUrl = process.env.RECOVERY_FE_BASE_URL ?? 'http://localhost:3000';
let userId: number | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const flags: Record<string, unknown> = {};

const escapeForRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function log(value: Record<string, unknown>) {
  await mkdir(dirname(evidencePath), { recursive: true });
  await appendFile(
    evidencePath,
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      marker,
      phase: 'toeic-runtime-backlink',
      ...value,
    })}\n`,
  );
}

async function login(
  page: import('playwright').Page,
  email: string,
  password: string,
) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
  await page.locator('[aria-controls="email-login-panel"]').click();
  await page.locator('#emailInput').fill(email);
  await page.locator('#passwordInput').fill(password);
  const response = page.waitForResponse(
    (item) =>
      item.url().includes('/auth/login') && item.request().method() === 'POST',
    { timeout: 20_000 },
  );
  await page.locator('#email-login-panel button[type="submit"]').click();
  if ((await response).status() !== 200) throw new Error('AUTH_FAILED');
  await page.waitForFunction(
    () => !location.pathname.startsWith('/login'),
    undefined,
    { timeout: 20_000 },
  );
}

async function main() {
  const email = `${marker}@breadtrans.local`;
  const password = `Qa-${randomUUID()}-Aa1!`;
  try {
    const user = await prisma.user.create({
      data: {
        email,
        password: await bcrypt.hash(password, 10),
        role: Role.STUDENT,
        emailVerifiedAt: new Date(),
        profile: { create: { fullName: 'QA TOEIC runtime backlink' } },
      },
    });
    userId = user.id;
    const planVersion = await prisma.planVersion.findFirstOrThrow({
      where: {
        isCurrent: true,
        status: 'PUBLISHED',
        plan: { code: 'PLUS', status: 'ACTIVE' },
      },
      select: { id: true },
    });
    await prisma.subscription.create({
      data: {
        userId: user.id,
        planVersionId: planVersion.id,
        status: SubscriptionStatus.ACTIVE,
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 3_600_000),
      },
    });

    const products = await prisma.exam.findMany({
      where: { publicationStatus: 'PUBLISHED' },
      select: {
        id: true,
        title: true,
        variantCode: true,
        toeicExamSet: { select: { id: true } },
        toeicAssessment: { select: { id: true } },
      },
      orderBy: { id: 'asc' },
    });
    const lr = products.find((p) => p.variantCode === 'TOEIC_LR');
    const sw = products.find((p) => p.variantCode === 'TOEIC_SW');
    const fs = products.find((p) => p.variantCode === 'TOEIC_4_SKILLS');
    if (!lr?.toeicExamSet || !sw?.toeicAssessment || !fs?.toeicAssessment) {
      throw new Error('PRODUCT_MAPPING_INCOMPLETE');
    }

    browser = await chromium.launch({
      executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      headless: true,
    });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 860 },
    });

    // Record every main-frame URL so a legacy hop cannot hide.
    const visited: string[] = [];
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) visited.push(new URL(frame.url()).pathname);
    });

    await login(page, email, password);

    /** Count legacy detail URLs visited since a marker index. */
    const legacyHopsSince = (from: number) =>
      visited
        .slice(from)
        .filter((p) => /^\/toeic\/(\d+|assessments\/\d+)$/.test(p));

    // ---------------------------------------------------------------- A: S&W
    // /exams/3 -> Start -> runtime attempt -> back to detail
    await page.goto(`${baseUrl}/exams/${sw.id}`, { waitUntil: 'networkidle' });
    await page.locator('h1').first().waitFor({ timeout: 20_000 });
    await page
      .getByRole('button', { name: /Bắt đầu làm bài|Tiếp tục làm bài/ })
      .first()
      .click();
    await page.waitForURL(/\/toeic\/assessments\/\d+\/attempts\/\d+$/, {
      timeout: 30_000,
    });
    const swRuntime = new URL(page.url()).pathname;
    await page.locator('h1').first().waitFor({ timeout: 20_000 });
    // scroll down first, so the destination's scroll position is meaningful
    await page.evaluate(() =>
      window.scrollTo(0, Math.min(600, document.documentElement.scrollHeight)),
    );
    const beforeBack = visited.length;
    await page.getByRole('link', { name: /Chi tiết bài thi/ }).click();
    await page.waitForURL(/\/exams\/\d+$/, { timeout: 20_000 });
    await page.locator('h1').first().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(800);
    const swBack = {
      runtime: swRuntime,
      landed: new URL(page.url()).pathname,
      legacyHops: legacyHopsSince(beforeBack),
      scrollY: await page.evaluate(() => window.scrollY),
    };
    flags.SW_BACKLINK = swBack;

    // history: one learner-visible transition, runtime -> canonical
    await page.goBack({ waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    const afterGoBack = new URL(page.url()).pathname;
    flags.HISTORY_AFTER_BACK = afterGoBack;
    flags.TOEIC_RUNTIME_TO_DETAIL_HISTORY_PASS =
      afterGoBack === swRuntime &&
      !/^\/toeic\/(\d+|assessments\/\d+)$/.test(afterGoBack);

    // ---------------------------------------------- A2: 4 Skills, same page
    await page.goto(`${baseUrl}/exams/${fs.id}`, { waitUntil: 'networkidle' });
    await page.locator('h1').first().waitFor({ timeout: 20_000 });
    await page
      .getByRole('button', { name: /Bắt đầu làm bài|Tiếp tục làm bài/ })
      .first()
      .click();
    await page.waitForURL(/\/toeic\/assessments\/\d+\/attempts\/\d+$/, {
      timeout: 30_000,
    });
    const fsRuntime = new URL(page.url()).pathname;
    await page.locator('h1').first().waitFor({ timeout: 20_000 });
    const beforeBackFs = visited.length;
    await page.getByRole('link', { name: /Chi tiết bài thi/ }).click();
    await page.waitForURL(/\/exams\/\d+$/, { timeout: 20_000 });
    await page.locator('h1').first().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(800);
    const fsBack = {
      runtime: fsRuntime,
      landed: new URL(page.url()).pathname,
      legacyHops: legacyHopsSince(beforeBackFs),
      scrollY: await page.evaluate(() => window.scrollY),
    };
    flags.FOURSKILLS_BACKLINK = fsBack;

    flags.TOEIC_ASSESSMENT_ATTEMPT_BACKLINK_CANONICAL_PASS =
      swBack.landed === `/exams/${sw.id}` &&
      swBack.legacyHops.length === 0 &&
      fsBack.landed === `/exams/${fs.id}` &&
      fsBack.legacyHops.length === 0;

    // ------------------------------------------------------------- B: bundle
    // A bundle is a Quiz carrying isBundle:true, not an assessment id, so the
    // real one is discovered rather than assumed.
    const bundleQuizzes = await prisma.quiz.findMany({
      select: { id: true, bilingualContent: true },
      orderBy: { id: 'asc' },
    });
    const bundle = bundleQuizzes.find((quiz) => {
      const meta =
        quiz.bilingualContent &&
        typeof quiz.bilingualContent === 'object' &&
        !Array.isArray(quiz.bilingualContent)
          ? (quiz.bilingualContent as Record<string, unknown>)
          : {};
      return (
        meta.isBundle === true &&
        (meta.examFormat === 'TOEIC_4_SKILLS' ||
          meta.examFormat === 'FOUR_SKILL')
      );
    });
    if (!bundle) throw new Error('NO_BUNDLE_QUIZ_TO_EXERCISE');
    const bundleQuizId = bundle.id;
    const beforeBundle = visited.length;
    await page.goto(`${baseUrl}/toeic/bundle/${bundleQuizId}`, {
      waitUntil: 'networkidle',
    });
    const bundleReachable = await page
      .locator('h1')
      .first()
      .isVisible()
      .catch(() => false);
    let bundleResult: Record<string, unknown> = {
      reachable: bundleReachable,
      quizId: bundleQuizId,
    };
    if (bundleReachable) {
      const launch = page.getByRole('button', { name: /Bắt đầu phần L&R/ });
      if (await launch.count()) {
        await launch.first().click();
        await page
          .waitForURL(/\/exams\/\d+$/, { timeout: 25_000 })
          .catch(() => undefined);
        await page.waitForTimeout(800);
        bundleResult = {
          ...bundleResult,
          landed: new URL(page.url()).pathname,
          legacyHops: legacyHopsSince(beforeBundle),
          scrollY: await page.evaluate(() => window.scrollY),
        };
      } else {
        bundleResult = { ...bundleResult, note: 'LAUNCH_BUTTON_ABSENT' };
      }
    }
    flags.BUNDLE_BACKLINK = bundleResult;
    flags.TOEIC_BUNDLE_BACKLINK_CANONICAL_PASS =
      bundleResult.landed === `/exams/${lr.id}` &&
      Array.isArray(bundleResult.legacyHops) &&
      (bundleResult.legacyHops as string[]).length === 0;

    // ------------------------------------------------------------ aggregates
    const scrolls = [swBack.scrollY, fsBack.scrollY, bundleResult.scrollY]
      .filter((v) => typeof v === 'number') as number[];
    flags.TOEIC_RUNTIME_BACKLINK_SCROLL_TOP_PASS =
      scrolls.length > 0 && scrolls.every((v) => v === 0);
    flags.TOEIC_NORMAL_LEARNER_NAVIGATION_LEGACY_DETAIL_HOPS = visited.filter(
      (p) => /^\/toeic\/(\d+|assessments\/\d+)$/.test(p),
    ).length;
    flags.VISITED_PATHS = visited;

    await log({ test: 'runtime-backlink-acceptance', result: 'RECORDED', flags });
    console.log(JSON.stringify(flags, null, 2));
  } finally {
    await browser?.close();
    if (userId) {
      // QA-owned attempts only, scoped to this user.
      await prisma.toeicAssessmentAttempt
        .deleteMany({ where: { userId } })
        .catch(() => undefined);
      await prisma.toeicAttempt
        .deleteMany({ where: { userId } })
        .catch(() => undefined);
      await prisma.subscription.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
    const orphans = await prisma.user.count({
      where: { email: { startsWith: 'qa-toeic-backlink-' } },
    });
    console.log(`QA_ORPHAN_RECORDS_AFTER_CLEANUP=${orphans}`);
    await log({
      test: 'cleanup',
      result: orphans === 0 ? 'PASS' : 'FAIL',
      orphanRecords: orphans,
    });
    await prisma.$disconnect();
  }
}

void main().catch(async (error) => {
  await log({
    test: 'fatal',
    result: 'FAIL',
    failure: error instanceof Error ? error.message : String(error),
  });
  console.error(error);
  process.exitCode = 1;
});
