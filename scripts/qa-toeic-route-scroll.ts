import './qa/qa-legacy-guard';
import 'dotenv/config';

import { randomUUID } from 'crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import * as bcrypt from 'bcrypt';
import { chromium } from 'playwright';
import { PrismaClient, Role, SubscriptionStatus } from '@prisma/client';

const prisma = new PrismaClient();
const marker = `qa-toeic-route-${randomUUID()}`;
const evidencePath = resolve('artifacts/learner-runtime-qa.jsonl');
const baseUrl = process.env.RECOVERY_FE_BASE_URL ?? 'http://localhost:3000';
let userId: number | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

async function log(value: Record<string, unknown>) {
  await mkdir(dirname(evidencePath), { recursive: true });
  await appendFile(evidencePath, `${JSON.stringify({ timestamp: new Date().toISOString(), marker, phase: 'toeic-route-scroll', ...value })}\n`);
}

async function login(page: import('playwright').Page, email: string, password: string) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
  await page.locator('[aria-controls="email-login-panel"]').click();
  await page.locator('#emailInput').fill(email);
  await page.locator('#passwordInput').fill(password);
  const response = page.waitForResponse(
    (item) => item.url().includes('/auth/login') && item.request().method() === 'POST',
    { timeout: 15_000 },
  );
  await page.locator('#email-login-panel button[type="submit"]').click();
  if ((await response).status() !== 200) throw new Error('AUTH_FAILED');
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), undefined, { timeout: 15_000 });
}

async function openFromCatalog(
  page: import('playwright').Page,
  title: string,
  expectedPath: RegExp,
) {
  await page.goto(`${baseUrl}/exams`, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.scrollTo(0, Math.min(900, document.documentElement.scrollHeight)));
  const beforeClick = await page.evaluate(() => window.scrollY);
  if (beforeClick === 0) throw new Error(`CATALOG_NOT_SCROLLABLE:${title}`);
  await page.getByRole('button', { name: new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click();
  await page.waitForURL(expectedPath, { timeout: 15_000 });
  await page.waitForFunction(() => window.scrollY === 0, undefined, { timeout: 5_000 });
  const scrollY = await page.evaluate(() => window.scrollY);
  const heading = await page.locator('h1').innerText();
  return { route: page.url(), heading, scrollY };
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
        profile: { create: { fullName: 'QA TOEIC route scroll' } },
      },
    });
    userId = user.id;
    const planVersion = await prisma.planVersion.findFirstOrThrow({
      where: { isCurrent: true, status: 'PUBLISHED', plan: { code: 'PLUS', status: 'ACTIVE' } },
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
    await log({ test: 'setup', result: 'PASS', user: marker, route: '/exams' });

    browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
    await login(page, email, password);

    const routes = await Promise.all([
      openFromCatalog(page, 'TOEIC 2 Skills: Listening & Reading — Đề luyện tập 01', /\/toeic\/1$/),
    ]);
    const sw = await openFromCatalog(page, 'TOEIC 2 Skills: Speaking & Writing — Đề luyện tập 01', /\/toeic\/assessments\/1$/);
    const fourSkills = await openFromCatalog(page, 'TOEIC 4 Skills — Đề luyện tập 01', /\/toeic\/assessments\/2$/);
    await log({
      test: 'catalog-detail-forward-scroll',
      result: routes[0].scrollY === 0 && sw.scrollY === 0 && fourSkills.scrollY === 0 ? 'PASS' : 'FAIL',
      details: { listeningReading: routes[0], speakingWriting: sw, fourSkills },
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${baseUrl}/toeic/assessments/2`, { waitUntil: 'networkidle' });
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    const mobileHeading = await page.locator('h1').innerText();
    await log({ test: 'assessment-mobile-smoke', result: !mobileOverflow && Boolean(mobileHeading) ? 'PASS' : 'FAIL', route: page.url(), mobileOverflow, mobileHeading });
  } finally {
    await browser?.close();
    if (userId) {
      await prisma.subscription.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
    const orphans = await prisma.user.count({ where: { email: { startsWith: 'qa-toeic-route-' } } });
    await log({ test: 'cleanup', result: orphans === 0 ? 'PASS' : 'FAIL', orphanRecords: orphans });
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  await log({ test: 'fatal', result: 'FAIL', failure: error instanceof Error ? error.message : String(error) });
  console.error(error);
  process.exitCode = 1;
});
