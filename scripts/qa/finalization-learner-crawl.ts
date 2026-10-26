/**
 * Finalization P1 discovery crawl: every learner route, as a fresh STUDENT,
 * against the disposable harness only (FE :3100, BE :3101). It writes nothing
 * except what registering the crawl account and opening pages writes to the
 * harness clone. Refuses any other target.
 *
 * Records per page: API responses >= 400, console errors, uncaught page
 * errors, visible error copy, and leaked "undefined"/"NaN"/"[object Object]".
 *
 * Usage: npx ts-node --transpile-only scripts/qa/finalization-learner-crawl.ts [out.json]
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

import { chromium, type Page } from 'playwright';

const FE = 'http://localhost:3100';
const BE = 'http://localhost:3101';
const OUT =
  process.argv[2] ?? 'artifacts/finalization/evidence/learner-crawl.json';

const STATIC_ROUTES = [
  '/',
  '/help',
  '/privacy',
  '/terms',
  '/courses',
  '/dashboard',
  '/student-home',
  '/hub',
  '/learn',
  '/diagnostic',
  '/my-courses',
  '/listening',
  '/reading',
  '/reading/mistakes',
  '/speaking',
  '/writing',
  '/exams',
  '/toeic/assessments',
  '/toeic/history',
  '/flashcard',
  '/grammar',
  '/vocabulary/saved',
  '/vocabulary/study',
  '/arena',
  '/classes',
  '/market',
  '/messages',
  '/notifications',
  '/pet',
  '/plans',
  '/change-password',
];
/** Catalog page -> first detail link to follow. */
const DETAIL_FROM: Array<[string, RegExp]> = [
  ['/courses', /^\/courses\/\d+$/],
  ['/listening', /^\/listening\/\d+$/],
  ['/reading', /^\/reading\/\d+$/],
  ['/speaking', /^\/speaking\/\d+$/],
  ['/writing', /^\/writing\/\d+$/],
  ['/exams', /^\/exams\/\d+$/],
  ['/toeic/assessments', /^\/toeic\/assessments\/\d+$/],
  ['/flashcard', /^\/flashcard\/\d+$/],
  ['/classes', /^\/classes\/\d+$/],
];
const ERROR_COPY =
  /Đã xảy ra lỗi|Something went wrong|Application error|Không thể tải|Lỗi tải|Unhandled Runtime Error|404 \| This page could not be found/i;
const LEAK = /\bundefined\b|\bNaN\b|\[object Object\]/;

type PageReport = {
  route: string;
  finalUrl: string;
  apiFailures: string[];
  consoleErrors: string[];
  pageErrors: string[];
  errorCopy: string[];
  leaks: string[];
};

async function visit(page: Page, route: string): Promise<PageReport> {
  const report: PageReport = {
    route,
    finalUrl: '',
    apiFailures: [],
    consoleErrors: [],
    pageErrors: [],
    errorCopy: [],
    leaks: [],
  };
  const onResponse = async (res: any) => {
    if (!res.url().startsWith(BE) || res.status() < 400) return;
    let detail = '';
    try {
      detail = JSON.stringify((await res.json())?.message ?? '').slice(0, 160);
    } catch {
      /* not JSON */
    }
    report.apiFailures.push(
      `${res.request().method()} ${res.url().replace(BE, '')} -> ${res.status()} ${detail}`,
    );
  };
  const onConsole = (msg: any) => {
    if (msg.type() === 'error')
      report.consoleErrors.push(msg.text().slice(0, 240));
  };
  const onPageError = (err: Error) =>
    report.pageErrors.push(err.message.slice(0, 240));
  page.on('response', onResponse);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  try {
    await page.goto(FE + route, { waitUntil: 'networkidle', timeout: 90_000 });
  } catch (e) {
    report.pageErrors.push(
      `navigation: ${(e as Error).message.split('\n')[0]}`,
    );
  }
  await page.waitForTimeout(1500);
  report.finalUrl = page.url().replace(FE, '');
  const text = await page
    .locator('body')
    .innerText()
    .catch(() => '');
  for (const line of text.split('\n')) {
    if (ERROR_COPY.test(line)) report.errorCopy.push(line.trim().slice(0, 160));
    if (LEAK.test(line)) report.leaks.push(line.trim().slice(0, 160));
  }
  page.off('response', onResponse);
  page.off('console', onConsole);
  page.off('pageerror', onPageError);
  return report;
}

async function main() {
  const email = `crawl-${randomUUID().slice(0, 8)}@harness.local`;
  const password = `Harness-${randomUUID().slice(0, 8)}-Aa1!`;
  const reg = await fetch(`${BE}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, fullName: 'Crawl Learner' }),
  });
  if (!reg.ok)
    throw new Error(`register failed ${reg.status} ${await reg.text()}`);

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1366, height: 900 },
  });
  await page.goto(`${FE}/login`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  // Email login sits behind a disclosure under the Google button.
  await page.click('button[aria-controls="email-login-panel"]');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('#email-login-panel button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), {
    timeout: 60_000,
  });
  console.log(
    `logged in as fresh student, landed on ${page.url().replace(FE, '')}`,
  );

  const reports: PageReport[] = [];
  for (const route of STATIC_ROUTES) {
    const r = await visit(page, route);
    reports.push(r);
    console.log(
      `${route} -> ${r.finalUrl}  api=${r.apiFailures.length} console=${r.consoleErrors.length} pageErr=${r.pageErrors.length} copy=${r.errorCopy.length} leak=${r.leaks.length}`,
    );
  }
  for (const [catalog, pattern] of DETAIL_FROM) {
    await page
      .goto(FE + catalog, { waitUntil: 'networkidle', timeout: 90_000 })
      .catch(() => undefined);
    const hrefs = await page.$$eval('a[href]', (as) =>
      as.map((a) => a.getAttribute('href') ?? ''),
    );
    const target = hrefs.find((h) => pattern.test(h));
    if (!target) {
      reports.push({
        route: `${catalog} (detail)`,
        finalUrl: '',
        apiFailures: [],
        consoleErrors: [],
        pageErrors: [],
        errorCopy: [`no detail link matching ${pattern}`],
        leaks: [],
      });
      console.log(`${catalog}: no detail link`);
      continue;
    }
    const r = await visit(page, target);
    reports.push(r);
    console.log(
      `${target} -> ${r.finalUrl}  api=${r.apiFailures.length} console=${r.consoleErrors.length} pageErr=${r.pageErrors.length} copy=${r.errorCopy.length} leak=${r.leaks.length}`,
    );
  }
  await browser.close();
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        target: { FE, BE },
        account: 'fresh STUDENT on harness clone',
        reports,
      },
      null,
      2,
    ),
  );
  console.log(`-> ${OUT}`);
}

main().catch((e) => {
  console.error('CRAWL FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
