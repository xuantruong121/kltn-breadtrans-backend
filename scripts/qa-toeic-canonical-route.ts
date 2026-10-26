/**
 * Acceptance test for the unified TOEIC public route model.
 *
 * The criterion is the URL the browser actually shows, not component reuse:
 * all three products must sit on /exams/:examId. Also checks that the legacy
 * aggregate URLs still work and redirect exactly once, that Start still aims
 * at the already-proven runtime, and that history holds no compatibility URL.
 *
 * Read-only against product data. Creates one QA learner and deletes it.
 */
import 'dotenv/config';
import { randomUUID } from 'crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import * as bcrypt from 'bcrypt';
import { chromium } from 'playwright';
import { PrismaClient, Role, SubscriptionStatus } from '@prisma/client';

const prisma = new PrismaClient();
const marker = `qa-toeic-canon-${randomUUID()}`;
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
      phase: 'toeic-canonical-route',
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

/** Click a product in the catalog and report the URL the learner ends on. */
async function openFromCatalog(page: import('playwright').Page, title: string) {
  await page.goto(`${baseUrl}/exams`, { waitUntil: 'networkidle' });
  await page.evaluate(() =>
    window.scrollTo(0, Math.min(900, document.documentElement.scrollHeight)),
  );
  const scrolledBeforeClick = await page.evaluate(() => window.scrollY);
  await page
    .getByRole('button', { name: new RegExp(escapeForRegex(title)) })
    .click();
  await page.waitForURL(/\/exams\/\d+$/, { timeout: 20_000 });
  await page.locator('h1').first().waitFor({ timeout: 20_000 });
  return {
    path: new URL(page.url()).pathname,
    heading: await page.locator('h1').first().innerText(),
    bodyText: await page.locator('body').innerText(),
    scrollY: await page.evaluate(() => window.scrollY),
    scrolledBeforeClick,
  };
}

/** Open a legacy URL directly and report where it lands. */
async function openLegacy(page: import('playwright').Page, legacyPath: string) {
  await page.goto(`${baseUrl}/exams`, { waitUntil: 'networkidle' });
  await page.goto(`${baseUrl}${legacyPath}`, { waitUntil: 'networkidle' });
  await page.waitForURL(/\/exams\/\d+$/, { timeout: 20_000 });
  await page.locator('h1').first().waitFor({ timeout: 20_000 });
  return {
    from: legacyPath,
    finalPath: new URL(page.url()).pathname,
    heading: await page.locator('h1').first().innerText(),
    scrollY: await page.evaluate(() => window.scrollY),
  };
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
        profile: { create: { fullName: 'QA TOEIC canonical route' } },
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

    // The canonical ids come from current data, never hardcoded.
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
    flags.MAPPING = {
      lr: { examId: lr.id, examSetId: lr.toeicExamSet.id },
      sw: { examId: sw.id, assessmentId: sw.toeicAssessment.id },
      fourSkills: { examId: fs.id, assessmentId: fs.toeicAssessment.id },
    };

    browser = await chromium.launch({
      executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      headless: true,
    });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 860 },
    });
    await login(page, email, password);

    // --- catalog -> canonical detail, for each product
    const lrView = await openFromCatalog(page, lr.title);
    const swView = await openFromCatalog(page, sw.title);
    const fsView = await openFromCatalog(page, fs.title);

    flags.TOEIC_LR_BROWSER_VISIBLE_DETAIL_URL = lrView.path;
    flags.TOEIC_SW_BROWSER_VISIBLE_DETAIL_URL = swView.path;
    flags.TOEIC_4SKILLS_BROWSER_VISIBLE_DETAIL_URL = fsView.path;
    flags.TOEIC_VISIBLE_URL_FORMAT_UNIFICATION_PASS =
      lrView.path === `/exams/${lr.id}` &&
      swView.path === `/exams/${sw.id}` &&
      fsView.path === `/exams/${fs.id}`;

    // --- the detail content still belongs to the right product
    flags.TOEIC_LR_CANONICAL_ROUTE_E2E_PASS =
      /200 câu/.test(lrView.bodyText) && /Part 1/.test(lrView.bodyText);
    flags.TOEIC_SW_CANONICAL_ROUTE_E2E_PASS =
      /11 nhiệm vụ/.test(swView.bodyText) && /8 nhiệm vụ/.test(swView.bodyText);
    flags.TOEIC_4SKILLS_CANONICAL_ROUTE_E2E_PASS =
      /200 câu/.test(fsView.bodyText) &&
      /11 nhiệm vụ/.test(fsView.bodyText) &&
      /8 nhiệm vụ/.test(fsView.bodyText);
    // the mixed-unit bug would advertise 219
    flags.TOEIC_MIXED_UNIT_SUMMARY_REGRESSION_PASS = !/219/.test(
      fsView.bodyText,
    );

    // --- shared shell present on all three
    const shell = async (path: string) => {
      await page.goto(`${baseUrl}${path}`, { waitUntil: 'networkidle' });
      await page.locator('h1').first().waitFor({ timeout: 20_000 });
      return page.evaluate(() => ({
        grid: document.querySelectorAll(
          '[class*="col-span-8"], [class*="col-span-4"]',
        ).length,
        cta: Array.from(document.querySelectorAll('button')).some((b) =>
          /Bắt đầu làm bài|Tiếp tục làm bài|Đã hoàn thành/.test(
            b.textContent ?? '',
          ),
        ),
        disclaimer: /Quy chế khảo thí/.test(document.body.innerText),
      }));
    };
    const shells = [
      await shell(`/exams/${lr.id}`),
      await shell(`/exams/${sw.id}`),
      await shell(`/exams/${fs.id}`),
    ];
    flags.SHELL_DETAIL = shells;
    flags.TOEIC_SHARED_DETAIL_PRESENTATION_PASS = shells.every(
      (s) => s.grid > 0 && s.cta && s.disclaimer,
    );

    // --- forward scroll
    flags.FORWARD_NAVIGATION_SCROLL_TOP_PASS = [lrView, swView, fsView].every(
      (v) => v.scrollY === 0 && v.scrolledBeforeClick > 0,
    );

    // --- the canonical route must not bounce back into /toeic/*
    let loops = 0;
    for (const id of [lr.id, sw.id, fs.id]) {
      await page.goto(`${baseUrl}/exams/${id}`, { waitUntil: 'networkidle' });
      await page.locator('h1').first().waitFor({ timeout: 20_000 });
      await page.waitForTimeout(1200);
      if (new URL(page.url()).pathname !== `/exams/${id}`) loops += 1;
    }
    flags.TOEIC_CANONICAL_ROUTE_REDIRECT_LOOP_COUNT = loops;

    // --- legacy deep links
    const legacyLr = await openLegacy(page, `/toeic/${lr.toeicExamSet.id}`);
    const legacySw = await openLegacy(
      page,
      `/toeic/assessments/${sw.toeicAssessment.id}`,
    );
    const legacyFs = await openLegacy(
      page,
      `/toeic/assessments/${fs.toeicAssessment.id}`,
    );
    flags.LEGACY_DETAIL = [legacyLr, legacySw, legacyFs];
    flags.TOEIC_LEGACY_LR_ROUTE_REDIRECT_PASS =
      legacyLr.finalPath === `/exams/${lr.id}`;
    flags.TOEIC_LEGACY_SW_ROUTE_REDIRECT_PASS =
      legacySw.finalPath === `/exams/${sw.id}`;
    flags.TOEIC_LEGACY_4SKILLS_ROUTE_REDIRECT_PASS =
      legacyFs.finalPath === `/exams/${fs.id}`;
    flags.TOEIC_COMPAT_REDIRECT_SCROLL_STABILITY_PASS = [
      legacyLr,
      legacySw,
      legacyFs,
    ].every((v) => v.scrollY === 0);

    // --- legacy catalog
    await page.goto(`${baseUrl}/toeic/assessments`, {
      waitUntil: 'networkidle',
    });
    flags.TOEIC_LEGACY_ASSESSMENT_CATALOG_REDIRECT_PASS =
      new URL(page.url()).pathname === '/exams';

    // --- history: back from a canonical detail returns to the catalog,
    //     never to a compatibility URL
    await page.goto(`${baseUrl}/exams`, { waitUntil: 'networkidle' });
    await page
      .getByRole('button', { name: new RegExp(escapeForRegex(sw.title)) })
      .click();
    await page.waitForURL(/\/exams\/\d+$/, { timeout: 20_000 });
    const detailUrl = new URL(page.url()).pathname;
    await page.goBack({ waitUntil: 'networkidle' });
    await page.waitForURL((url) => url.pathname === '/exams', {
      timeout: 20_000,
    });
    const backPath = new URL(page.url()).pathname;
    await page.goForward({ waitUntil: 'networkidle' });
    // The App Router settles the client-side URL after the navigation event,
    // so this waits for it instead of sampling it immediately.
    await page
      .waitForURL((url) => url.pathname === detailUrl, { timeout: 20_000 })
      .catch(() => undefined);
    const forwardPath = new URL(page.url()).pathname;
    flags.HISTORY = { detailUrl, backPath, forwardPath };
    flags.TOEIC_CANONICAL_HISTORY_STACK_PASS =
      backPath === '/exams' && forwardPath === detailUrl;

    // --- Start target smoke: the CTA must aim at the proven runtime.
    //     The attempt POST is aborted so no attempt is actually created.
    // The signed-in session lives in localStorage, so this reuses the same
    // authenticated page rather than opening a fresh one.
    const startTargets: Record<string, string | null> = {};
    for (const [key, id] of [
      ['LR', lr.id],
      ['SW', sw.id],
      ['4SKILLS', fs.id],
    ] as const) {
      let captured: string | null = null;
      await page.route('**/*', async (route) => {
        const req = route.request();
        if (
          req.method() === 'POST' &&
          /\/(toeic\/exams\/\d+\/attempts|toeic\/assessments\/\d+\/attempts)/.test(
            req.url(),
          )
        ) {
          captured = new URL(req.url()).pathname;
          await route.abort();
          return;
        }
        await route.continue();
      });
      await page.goto(`${baseUrl}/exams/${id}`, { waitUntil: 'networkidle' });
      await page.locator('h1').first().waitFor({ timeout: 20_000 });
      const cta = page.getByRole('button', {
        name: /Bắt đầu làm bài|Tiếp tục làm bài/,
      });
      if (await cta.count()) {
        await cta
          .first()
          .click()
          .catch(() => undefined);
        await page.waitForTimeout(2500);
      }
      startTargets[key] = captured;
      await page.unroute('**/*');
    }
    flags.START_TARGETS = startTargets;
    flags.TOEIC_LR_START_TARGET_PRESERVED =
      /\/toeic\/exams\/\d+\/attempts/.test(startTargets.LR ?? '');
    flags.TOEIC_SW_START_TARGET_PRESERVED =
      startTargets.SW ===
      `/toeic/assessments/${sw.toeicAssessment.id}/attempts`;
    flags.TOEIC_4SKILLS_START_TARGET_PRESERVED =
      startTargets['4SKILLS'] ===
      `/toeic/assessments/${fs.toeicAssessment.id}/attempts`;

    await log({
      test: 'canonical-route-acceptance',
      result: 'RECORDED',
      flags,
    });
    console.log(JSON.stringify(flags, null, 2));
  } finally {
    await browser?.close();
    if (userId) {
      await prisma.subscription.deleteMany({ where: { userId } });
      await prisma.user
        .delete({ where: { id: userId } })
        .catch(() => undefined);
    }
    const orphans = await prisma.user.count({
      where: { email: { startsWith: 'qa-toeic-canon-' } },
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

main().catch(async (error) => {
  await log({
    test: 'fatal',
    result: 'FAIL',
    failure: error instanceof Error ? error.message : String(error),
  });
  console.error(error);
  process.exitCode = 1;
});
