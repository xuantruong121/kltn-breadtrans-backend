/**
 * CP60.1 (harness, desktop Chromium 1366 and 1440): Admin course management
 * works without classes; retired classroom and tuition pages redirect; a
 * learner's old class link lands on the course catalog.
 *
 * Read-only on course content: no create, edit or publish is submitted.
 *
 * Run: npx ts-node --transpile-only scripts/qa/cp601-admin-course-browser.ts
 */
import { chromium, type Page } from 'playwright';
import { check, failureCount, newAdmin } from './harness-api';
import { FE, studentPage } from './harness-browser';
import { harnessQuery } from './harness-db';

// Product wording only: "lớp học" also appears in lesson content (a classroom as a scenario).
const CLASSROOM_WORDS = /gói học|học phí|ghi danh|giáo viên|sức chứa|lớp legacy/i;

async function text(page: Page) {
  return (await page.locator('main').first().innerText()).replace(/\s+/g, ' ');
}

async function open(page: Page, path: string, ready: RegExp) {
  await page.goto(`${FE}${path}`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page
    .getByText(ready)
    .first()
    .waitFor({ timeout: 60_000 })
    .catch(() => undefined);
}

async function main() {
  const courseId = Number(
    harnessQuery(
      `select id from "Course" where status = 'PUBLISHED' order by id limit 1`,
    )[0][0],
  );
  const admin = await newAdmin('cp601-admin-ui');
  for (const width of [1366, 1440]) {
    console.log(`\n== Admin at ${width}px`);
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const issues: string[] = [];
    page.on('pageerror', (e) =>
      issues.push(`pageerror: ${e.message.slice(0, 160)}`),
    );
    page.on('response', (r) => {
      if (r.url().startsWith('http://localhost:3101') && r.status() >= 400)
        issues.push(
          `api ${r.status()} ${r.request().method()} ${r.url().slice(21)}`,
        );
    });
    await page.goto(`${FE}/login`, {
      waitUntil: 'networkidle',
      timeout: 120_000,
    });
    await page.click('button[aria-controls="email-login-panel"]');
    await page.fill('input[name="email"]', admin.email);
    await page.fill('input[name="password"]', admin.password);
    await page.click('#email-login-panel button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), {
      timeout: 60_000,
    });

    await open(page, '/admin/courses', /Soạn bài học/);
    const list = await text(page);
    check(
      `@${width} /admin/courses lists courses with the Studio link`,
      list.includes('Quản lý Khóa học') && list.includes('Soạn bài học'),
    );
    check(
      `@${width} /admin/courses shows no classroom wording`,
      !CLASSROOM_WORDS.test(list),
      list.match(CLASSROOM_WORDS)?.[0],
    );
    await page.screenshot({
      path: `artifacts/qa-screens/cp601-admin-courses-${width}.png`,
    });

    await open(
      page,
      `/admin/courses/${courseId}/edit`,
      /Chuyển về Bản nháp|Bản nháp|Xuất bản/,
    );
    const edit = await text(page);
    check(
      `@${width} course ${courseId} edit page renders and offers revert to draft`,
      edit.includes('Chuyển về Bản nháp') && !/lớp legacy/i.test(edit),
    );

    await open(
      page,
      `/admin/courses/${courseId}/curriculum`,
      /Bài học|bài học/,
    );
    check(
      `@${width} course ${courseId} Studio (curriculum) renders`,
      /bài học/i.test(await text(page)),
    );

    for (const [from, to] of [
      ['/admin/assignments', '/admin/courses'],
      ['/admin/payments', '/admin/plan-purchases'],
      ['/admin/enroll', '/admin/plan-purchases'],
    ]) {
      await page.goto(`${FE}${from}`, {
        waitUntil: 'networkidle',
        timeout: 120_000,
      });
      check(
        `@${width} ${from} redirects to ${to}`,
        new URL(page.url()).pathname === to,
        page.url(),
      );
    }

    await open(page, '/admin/ai-tools', /AI|Tạo/);
    const ai = await text(page);
    check(
      `@${width} AI tools has no class picker`,
      !/Gán vào gói học|gói học đích/i.test(ai),
    );

    check(
      `@${width} no 4xx/5xx API call and no page error on admin pages`,
      issues.length === 0,
      issues.slice(0, 4).join(' | '),
    );
    await browser.close();
  }

  console.log('\n== Learner old class links');
  const { browser, page, issues } = await studentPage(
    'cp601-classlink',
    1366,
    true,
  );
  for (const path of ['/classes', '/classes/2']) {
    await page.goto(`${FE}${path}`, {
      waitUntil: 'networkidle',
      timeout: 120_000,
    });
    check(
      `${path} redirects to /courses`,
      new URL(page.url()).pathname === '/courses',
      page.url(),
    );
  }
  await open(page, `/courses/${courseId}`, /bài học/);
  const detail = await text(page);
  check(
    'course detail shows no classroom wording',
    !CLASSROOM_WORDS.test(detail),
    detail.match(CLASSROOM_WORDS)?.[0],
  );
  check(
    'no server error',
    !issues.some((x) => x.startsWith('api 5')),
    issues.join(' | '),
  );
  await browser.close();

  console.log(`\nCP601_ADMIN_COURSE_BROWSER_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR', e);
  process.exit(2);
});
