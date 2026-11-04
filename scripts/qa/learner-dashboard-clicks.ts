/**
 * Every link and button on the learner dashboard, for several kinds of
 * account, at 1366 px and 390 px: a link must open a page that loads (no 404,
 * no "Không tìm thấy", no API 4xx/5xx besides harness audio), and a button
 * must do something visible (open a dialog, navigate, or change the panel).
 * Buttons with irreversible effects are listed as NOT_RUN. Harness only.
 *
 * Usage: HARNESS_DB=<db> npx ts-node --transpile-only scripts/qa/learner-dashboard-clicks.ts
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { sign } from 'jsonwebtoken';
import { chromium, type Browser, type Page } from 'playwright';

import {
  BE,
  call,
  check,
  failureCount,
  newProStudent,
  newStudent,
} from './harness-api';
import { FE, hidePet } from './harness-browser';
import { harnessQuery } from './harness-db';

const OUT = `${process.env.TEMP ?? '.'}/breadtrans-harness/audit/clicks`;
const SKIP =
  /đăng xuất|mua|thanh toán|nâng cấp ngay|cho ăn|nộp|xoá|xóa|huỷ|hủy|gửi/i;
// "Không thể tải audio" is not listed: practice audio sits in the private
// bucket, which the harness fakes empty (checked on the real bucket apart).
const ERROR_COPY =
  /Không tìm thấy|This page could not be found|404|Đã xảy ra lỗi|Có lỗi xảy ra|Không thể tải (?!audio)/i;

type Account = {
  label: string;
  token: string;
  user: { id: number; email: string; role: string };
};
type Row = {
  account: string;
  width: number;
  kind: string;
  label: string;
  target: string;
  result: string;
};
const rows: Row[] = [];

function mint(id: number, email: string, role: string): string {
  return sign(
    {
      sub: id,
      email,
      role,
      deviceId: 'harness-clicks',
      type: 'access',
      jti: randomUUID(),
    },
    'harness-only-jwt-secret',
    { expiresIn: '2h' },
  );
}

async function accounts(): Promise<Account[]> {
  const list: Account[] = [];
  const onboard = (token: string, extra: Record<string, unknown> = {}) =>
    call('PUT', '/learning-path/profile', token, {
      onboarded: true,
      goal: 'GENERAL',
      track: 'GENERAL',
      minutesPerDay: 15,
      ...extra,
    });
  const free = await newStudent('clicks-free');
  await onboard(free.token);
  list.push({
    label: 'new FREE',
    token: free.token,
    user: { id: free.userId, email: free.email, role: 'STUDENT' },
  });
  const basic = await newStudent('clicks-basic');
  await onboard(basic.token, { selfLevel: 'BASIC' });
  list.push({
    label: 'self-placed Cơ bản',
    token: basic.token,
    user: { id: basic.userId, email: basic.email, role: 'STUDENT' },
  });
  const pro = await newProStudent('clicks-pro');
  await onboard(pro.token);
  list.push({
    label: 'PRO',
    token: pro.token,
    user: { id: pro.userId, email: pro.email, role: 'STUDENT' },
  });
  // The real accounts of the cloned database, as they are today.
  for (const [id, email, role] of harnessQuery(
    `select id, email, role from "User" where role = 'STUDENT' and coalesce("mustChangePassword", false) = false and email not like '%@harness.local' order by id`,
  ))
    list.push({
      label: `real #${id}`,
      token: mint(Number(id), email, role),
      user: { id: Number(id), email, role },
    });
  return list;
}

async function open(
  browser: Browser,
  account: Account,
  width: number,
): Promise<{ page: Page; issues: string[] }> {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
  });
  await context.addInitScript(
    ([state]) => {
      window.localStorage.setItem('auth-storage-junior', state);
    },
    [
      JSON.stringify({
        state: {
          accessToken: account.token,
          refreshToken: '',
          user: account.user,
        },
        version: 0,
      }),
    ],
  );
  const page = await context.newPage();
  const issues: string[] = [];
  page.on('pageerror', (e) =>
    issues.push(`pageerror ${e.message.slice(0, 120)}`),
  );
  page.on('response', (r) => {
    const url = r.url();
    if (!url.startsWith(BE) || /\/audio(\?|$)/.test(url)) return;
    // The Listening page asks for the transcript first and handles the 403
    // "not unlocked yet" itself (listeningTranscriptResources.ts).
    if (/\/transcript$/.test(new URL(url).pathname) && r.status() === 403)
      return;
    if (r.status() >= 400 && r.status() !== 401)
      issues.push(`api ${r.status()} ${r.request().method()} ${url.slice(21)}`);
  });
  return { page, issues };
}

/** Opens each link in one fresh context; a crashed page is recorded and replaced. */
async function checkLinks(
  browser: Browser,
  account: Account,
  width: number,
  links: Map<string, string>,
) {
  let session = await open(browser, account, width);
  for (const [href, label] of links) {
    session.issues.length = 0;
    let bad: string[] = [];
    try {
      const { page, issues } = session;
      await page
        .goto(`${FE}${href}`, { waitUntil: 'networkidle', timeout: 90_000 })
        .catch(() => undefined);
      await page.waitForTimeout(1200);
      const text = await page
        .locator('body')
        .innerText()
        .catch(() => '');
      const path = new URL(page.url()).pathname;
      bad = [
        path.startsWith('/login') ? 'sent to login' : '',
        ERROR_COPY.exec(text)?.[0] ?? '',
        text.trim().length < 80 ? 'empty page' : '',
        ...issues,
      ].filter(Boolean);
      if (bad.length)
        await page
          .screenshot({
            path: `${OUT}/${account.label}@${width}-${href.replace(/[^w]+/g, '_')}.png`.slice(
              0,
              220,
            ),
          })
          .catch(() => undefined);
    } catch (error) {
      bad = [`page crashed: ${String(error).slice(0, 80)}`];
      await session.page
        .context()
        .close()
        .catch(() => undefined);
      session = await open(browser, account, width);
    }
    rows.push({
      account: account.label,
      width,
      kind: 'link',
      label,
      target: href,
      result: bad.length ? `FAIL ${bad.join(' | ')}` : 'PASS',
    });
  }
  await session.page
    .context()
    .close()
    .catch(() => undefined);
}

async function dashboard(browser: Browser, account: Account, width: number) {
  const { page, issues } = await open(browser, account, width);
  await page.goto(`${FE}/dashboard`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page
    .getByText('Nhiệm vụ hôm nay')
    .first()
    .waitFor({ timeout: 60_000 })
    .catch(() => undefined);
  await hidePet(page).catch(() => undefined);
  await page.waitForTimeout(1500);
  const links = new Map<string, string>();
  const collect = async () => {
    for (const a of await page.locator('main a[href]').all()) {
      const href = (await a.getAttribute('href')) ?? '';
      if (!href.startsWith('/') || href === '/dashboard') continue;
      if (!links.has(href))
        links.set(
          href,
          ((await a.innerText().catch(() => '')) || '').trim().slice(0, 60),
        );
    }
  };
  await collect();
  // Buttons: click each and see what it does; tabs reveal more links.
  const buttons = await page.locator('main button:visible').all();
  const labels: string[] = [];
  for (const b of buttons)
    labels.push(
      (
        (await b.innerText().catch(() => '')) ||
        (await b.getAttribute('aria-label')) ||
        ''
      )
        .trim()
        .slice(0, 60),
    );
  for (let i = 0; i < labels.length; i += 1) {
    const label = labels[i];
    if (!label) continue;
    if (SKIP.test(label)) {
      rows.push({
        account: account.label,
        width,
        kind: 'button',
        label,
        target: '',
        result: 'NOT_RUN irreversible',
      });
      continue;
    }
    const button = page.locator('main button:visible').nth(i);
    if (!(await button.count())) continue;
    // What a click can change: text, ARIA state (a toggle such as "Lưu bài
    // này" only changes its label), a request, a dialog or the URL.
    const state = () =>
      page
        .evaluate(() => {
          const main = document.querySelector('main');
          const aria = [
            ...(main?.querySelectorAll(
              '[aria-label],[aria-pressed],[aria-expanded],[aria-selected]',
            ) ?? []),
          ]
            .map((el) =>
              ['aria-label', 'aria-pressed', 'aria-expanded', 'aria-selected']
                .map((k) => el.getAttribute(k))
                .join('|'),
            )
            .join(';');
          return (main?.textContent ?? '') + aria;
        })
        .catch(() => '');
    if ((await button.getAttribute('aria-pressed')) === 'true') {
      rows.push({
        account: account.label,
        width,
        kind: 'button',
        label,
        target: '',
        result: 'PASS already selected',
      });
      continue;
    }
    const before = await state();
    const url = page.url();
    let requested = false;
    const onRequest = (request: {
      url: () => string;
      method: () => string;
    }) => {
      if (request.url().startsWith(BE) && request.method() !== 'GET')
        requested = true;
    };
    page.on('request', onRequest);
    await button.click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(900);
    page.off('request', onRequest);
    const dialog = await page
      .locator('[role="dialog"]:visible, [role="alertdialog"]:visible')
      .count();
    const moved = page.url() !== url;
    const after = moved ? '' : await state();
    let result = dialog
      ? 'PASS dialog'
      : moved
        ? `PASS navigated ${new URL(page.url()).pathname}`
        : after !== before
          ? 'PASS panel changed'
          : requested
            ? 'PASS request sent'
            : 'FAIL no visible effect';
    if (moved) {
      const text = await page
        .locator('body')
        .innerText()
        .catch(() => '');
      if (ERROR_COPY.test(text))
        result = `FAIL navigated to an error: ${ERROR_COPY.exec(text)?.[0]}`;
      await page.goto(`${FE}/dashboard`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1200);
      await hidePet(page).catch(() => undefined);
    } else {
      await collect();
      if (dialog) {
        // A modal must close with Escape; reload to reset whatever stays.
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
        if (await page.locator('[role="dialog"]:visible').count())
          result = 'FAIL dialog does not close with Escape';
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForTimeout(1000);
        await hidePet(page).catch(() => undefined);
      }
      await page.waitForTimeout(300);
    }
    rows.push({
      account: account.label,
      width,
      kind: 'button',
      label,
      target: '',
      result,
    });
  }
  rows.push({
    account: account.label,
    width,
    kind: 'page',
    label: '/dashboard',
    target: '',
    result: issues.length ? `FAIL ${issues.join(' | ').slice(0, 200)}` : 'PASS',
  });
  await page.context().close();
  // Links are the same at both widths; open them once per account.
  if (width === 1366) await checkLinks(browser, account, width, links);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  for (const account of await accounts()) {
    // A fresh browser per account: one long session ran Chromium out of memory.
    const browser = await chromium.launch();
    for (const width of [1366, 390])
      await dashboard(browser, account, width).catch((error) =>
        rows.push({
          account: account.label,
          width,
          kind: 'page',
          label: '/dashboard',
          target: '',
          result: `FAIL run stopped: ${String(error).slice(0, 160)}`,
        }),
      );
    await browser.close().catch(() => undefined);
    writeFileSync(`${OUT}/clicks.json`, JSON.stringify(rows, null, 1));
  }
  const fails = rows.filter((row) => row.result.startsWith('FAIL'));
  for (const row of fails)
    console.log(
      `FAIL  ${row.account}@${row.width} ${row.kind} "${row.label}" ${row.target} -> ${row.result}`,
    );
  check(
    `every dashboard link and button works (${rows.length} checked, ${rows.filter((r) => r.result.startsWith('NOT_RUN')).length} not run)`,
    fails.length === 0,
    `${fails.length} failed`,
  );
  console.log(`failures: ${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

void main();
