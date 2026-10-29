/**
 * CP60 acceptance (harness only), desktop Chromium:
 *
 *   failed  T13: the result page of a GRADING_FAILED attempt withholds the
 *           observed score and offers "Chấm lại" (learner from $STATE)
 *   nav     T26: every advice link on the result page opens a real page, for
 *           a FREE and a PRO learner (from $STATE.links.json)
 */
import { readFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright';

import { check, failureCount } from './harness-api';
import { FE, hidePet } from './harness-browser';

const STATE = process.env.STATE ?? 'cp60-acc-state.json';
const SHOTS = process.env.SHOTS ?? '.';

async function login(page: Page, email: string, password: string) {
  await page.goto(`${FE}/login`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page.click('button[aria-controls="email-login-panel"]');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('#email-login-panel button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), {
    timeout: 60_000,
    waitUntil: 'commit',
  });
}

const text = async (page: Page) =>
  (await page.locator('body').innerText()).replace(/\s+/g, ' ');

async function failed() {
  const s = JSON.parse(readFileSync(STATE, 'utf8'));
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1366, height: 900 },
  });
  try {
    await login(page, s.email, s.password);
    await page.goto(`${FE}/diagnostic`, { waitUntil: 'networkidle' });
    await hidePet(page);
    await page.getByText('Điểm quan sát').first().waitFor({ timeout: 60_000 });
    const t = await text(page);
    await page.screenshot({
      path: `${SHOTS}/t13-failed-1366.png`,
      fullPage: true,
    });
    check(
      'failed grading: no observed score, reason shown, objective core still shown',
      t.includes('Chưa có điểm tổng') &&
        t.includes('chưa chấm được') &&
        t.includes('Điểm cốt lõi khách quan'),
    );
    const retryButtons = await page
      .getByRole('button', { name: 'Chấm lại' })
      .count();
    check(
      'a "Chấm lại" button is offered for each failed task',
      retryButtons === 2,
      `${retryButtons}`,
    );
  } finally {
    await browser.close();
  }
}

async function nav() {
  const accounts = JSON.parse(readFileSync(`${STATE}.links.json`, 'utf8'));
  for (const label of ['FREE', 'PRO'] as const) {
    const browser = await chromium.launch();
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
    try {
      await login(page, accounts[label].email, accounts[label].password);
      await page.goto(`${FE}/diagnostic`, { waitUntil: 'networkidle' });
      await page
        .getByText('Nên luyện gì tiếp theo')
        .first()
        .waitFor({ timeout: 60_000 });
      const hrefs = [
        ...new Set(
          await page
            .locator(
              'section[aria-labelledby="diagnostic-advice-title"] a[href]',
            )
            .evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? '')),
        ),
      ].filter((h) => h.startsWith('/'));
      check(
        `${label}: advice links found`,
        hrefs.length > 0,
        `${hrefs.length}`,
      );
      for (const href of hrefs) {
        const res = await page.goto(`${FE}${href}`, {
          waitUntil: 'networkidle',
          timeout: 120_000,
        });
        // Practice rooms show a loading screen until their data (or a 403
        // lock) arrives.
        const settled = await page
          .waitForFunction(
            () => {
              const body = document.body?.innerText ?? '';
              return (
                body.trim().length > 50 && !/Đang tải|Đang chuẩn bị/.test(body)
              );
            },
            undefined,
            { timeout: 45_000 },
          )
          .then(() => true)
          .catch(() => false);
        const t = await text(page);
        if (process.env.DUMP)
          console.log(`--- ${label} ${href}: ${t.slice(0, 700)}`);
        const notFound =
          /This page could not be found|404|Không tìm thấy (bài|nội dung|trang)/i.test(
            t,
          );
        // The lock screen heading, not the header's plan link.
        const locked = /Nội dung dành cho (PLUS|PRO)/.test(t);
        check(
          `${label} ${href}: opens (${res?.status()})${locked ? ', shows plan lock' : ''}`,
          (res?.status() ?? 0) < 400 && settled && !notFound,
          `(len ${t.length}, notFound ${notFound}: ${t.slice(0, 120)})`,
        );
      }
      check(`${label}: no page errors`, errors.length === 0, errors.join('; '));
    } finally {
      await browser.close();
    }
  }
}

async function main() {
  const phase = process.argv[2];
  if (phase === 'failed') await failed();
  else if (phase === 'nav') await nav();
  else throw new Error('phase: failed | nav');
  console.log(
    `\nCP60_ACC_NAV_${phase.toUpperCase()}_FAILURES=${failureCount()}`,
  );
  process.exit(failureCount() ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR', e);
  process.exit(2);
});
