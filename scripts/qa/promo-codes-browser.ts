/**
 * Promo codes in the browser, on the disposable harness (fake PayOS).
 *
 * - Admin: /admin/promo-codes creates a PLUS-only 20% code through the form
 *   and lists it; switching it off and on works.
 * - Learner: /plans?promo=CODE (the win-back link shape) applies the code,
 *   the PLUS card shows 56.000 ₫ with 69.000 ₫ struck through, PRO says the
 *   code does not apply, and "Nâng cấp Plus" creates a 56,000 purchase.
 *
 * Usage: HARNESS_DB=<db> npx ts-node --transpile-only scripts/qa/promo-codes-browser.ts
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

import { call, check, failureCount, newAdmin } from './harness-api';
import { FE, hidePet, studentPage } from './harness-browser';

const SHOTS = `${process.env.TEMP ?? '.'}/breadtrans-harness/shots/promo`;

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const code = `UI-${randomUUID().slice(0, 6).toUpperCase()}`;

  // Admin form.
  const admin = await newAdmin('promo-ui-admin');
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1366, height: 900 },
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
    waitUntil: 'commit',
  });
  await page.goto(`${FE}/admin/promo-codes`);
  await hidePet(page);
  await page
    .getByRole('heading', { name: 'Mã giảm giá' })
    .waitFor({ timeout: 60_000 });
  const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
  check(
    'the expiry date cannot be set before today',
    (await page.getByLabel('Hết hạn (hết ngày)').getAttribute('min')) === today,
  );
  await page.getByLabel('Lượt tối đa').fill('-1');
  check(
    'a negative use count cannot be typed',
    (await page.getByLabel('Lượt tối đa').inputValue()) === '1',
  );
  await page.getByLabel('Lượt tối đa').fill('');
  const past = await call('POST', '/admin/promo-codes', admin.token, {
    code: `PAST-${code.slice(3)}`,
    percentOff: 10,
    validTo: new Date(Date.now() - 86_400_000).toISOString(),
  });
  check(
    'the API refuses an expiry date that has passed',
    past.status === 400,
    `(${past.status})`,
  );
  await page.getByLabel('Mã', { exact: true }).fill(code.toLowerCase());
  await page.getByLabel('Gói áp dụng').selectOption('PLUS');
  await page.getByRole('button', { name: 'Tạo mã' }).click();
  const row = page.getByRole('row', { name: new RegExp(code) });
  await row.waitFor({ timeout: 30_000 });
  check(
    'admin form creates the code and lists it',
    (await row.innerText()).includes('Còn hiệu lực'),
  );
  await row.getByRole('button', { name: 'Tắt' }).click();
  await page
    .getByRole('row', { name: new RegExp(`${code}.*Đã tắt`) })
    .waitFor({ timeout: 30_000 });
  check('switching the code off shows "Đã tắt"', true);
  await page
    .getByRole('row', { name: new RegExp(code) })
    .getByRole('button', { name: 'Bật' })
    .click();
  await page
    .getByRole('row', { name: new RegExp(`${code}.*Còn hiệu lực`) })
    .waitFor({ timeout: 30_000 });
  check('switching it back on shows "Còn hiệu lực"', true);
  await page.screenshot({ path: `${SHOTS}/admin-promo.png`, fullPage: true });
  await browser.close();

  // Learner, at both widths.
  for (const width of [1366, 390]) {
    const learner = await studentPage(`promo-ui-${width}`, width);
    const p = learner.page;
    await p.goto(`${FE}/plans?promo=${code.toLowerCase()}`);
    await hidePet(p);
    await p.getByText('Plus: giảm 20%, còn').waitFor({ timeout: 60_000 });
    const text = (await p.locator('main').last().innerText()).replace(
      /\s+/g,
      ' ',
    );
    check(
      `${width}px: the link fills and applies the code`,
      (
        await p.getByRole('textbox', { name: 'Mã giảm giá' }).inputValue()
      ).toUpperCase() === code,
    );
    check(
      `${width}px: PLUS shows 56.000 ₫ and the struck 69.000 ₫`,
      /56\.000\s?₫/.test(text) &&
        new RegExp(`69\\.000\\s?₫ giảm 13\\.000\\s?₫ với mã ${code}`).test(
          text,
        ),
      text.slice(0, 0),
    );
    check(
      `${width}px: PRO says the code does not apply`,
      text.includes('Pro: Mã giảm giá không áp dụng cho gói này.'),
    );
    const overflow = await p.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    check(
      `${width}px: no sideways page scroll`,
      overflow <= 0,
      String(overflow),
    );
    await p.screenshot({
      path: `${SHOTS}/plans-promo-${width}.png`,
      fullPage: false,
    });

    if (width === 1366) {
      await p.getByRole('button', { name: 'Nâng cấp Plus' }).click();
      await p.waitForResponse(
        (r) =>
          r.url().endsWith('/plan-purchases') &&
          r.request().method() === 'POST',
        { timeout: 30_000 },
      );
      const mine =
        (await call('GET', '/plan-purchases/me', learner.account.token)).data ??
        [];
      const latest = mine[0];
      check(
        'buying from the card creates a 56,000 purchase with the code',
        latest?.amountVnd === 56000 &&
          latest?.discountVnd === 13000 &&
          latest?.promoCode === code,
        JSON.stringify({
          a: latest?.amountVnd,
          d: latest?.discountVnd,
          c: latest?.promoCode,
        }),
      );
    }
    await learner.browser.close();
  }

  console.log(`\nPROMO_CODES_BROWSER_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch((error) => {
  console.error('ERROR', error);
  process.exit(2);
});
