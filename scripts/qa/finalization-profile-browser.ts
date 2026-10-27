/**
 * Profile regressions in real Chromium on the disposable harness.
 *
 *  1. "Đổi mật khẩu" tab: visible for a password account, still visible after
 *     that account is linked to Google, hidden for an account without a
 *     password (Google sign-up, password NULL), and its API cannot be used
 *     without the current password.
 *  2. Account form: an invalid phone is refused in the form before any
 *     request, typed values stay, nothing is saved; a valid save persists
 *     across a reload.
 */
import type { Page } from 'playwright';

import { BE, call, check, failureCount } from './harness-api';
import { FE, hidePet, studentPage } from './harness-browser';
import { harnessExec, harnessQuery } from './harness-db';

const SHOTS = 'artifacts/finalization/evidence';

async function passwordTabVisible(page: Page) {
  await page.goto(`${FE}/hub?tab=account-profile`, {
    waitUntil: 'networkidle',
    timeout: 90_000,
  });
  await page
    .getByRole('navigation', { name: 'Menu tài khoản' })
    .waitFor({ timeout: 30_000 });
  await page.waitForTimeout(800);
  return (
    (await page
      .getByRole('navigation', { name: 'Menu tài khoản' })
      .getByRole('button', { name: 'Đổi mật khẩu' })
      .count()) > 0
  );
}

async function pickAddress(page: Page, id: string, text: string) {
  const input = page.locator(`#${id}`);
  await input.click();
  await input.fill(text);
  await page.getByRole('option').first().click();
}

async function main() {
  console.log('\n== Change-password tab visibility');
  const { browser, page, account, issues } = await studentPage(
    'profile-ui',
    1366,
    false,
  );
  await hidePet(page);
  check('password-signup account sees the tab', await passwordTabVisible(page));

  harnessExec(
    `insert into "AuthAccount" (provider, "providerAccountId", "userId") values ('GOOGLE', 'qa-link-${account.userId}', ${account.userId})`,
  );
  check(
    'the same account linked to Google later still sees the tab',
    await passwordTabVisible(page),
  );

  // A Google sign-up stores no password. Simulate it on this signed-in session.
  harnessExec(`update "User" set password = null where id = ${account.userId}`);
  check(
    'account without a password (Google sign-up) does not see the tab',
    !(await passwordTabVisible(page)),
  );
  await page.goto(`${FE}/hub?tab=account-password`, {
    waitUntil: 'networkidle',
    timeout: 90_000,
  });
  await page.waitForTimeout(800);
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check(
    'opening ?tab=account-password directly shows the profile tab instead',
    !body.includes('Mật khẩu hiện tại') && body.includes('Tên hiển thị'),
  );
  // The token from the harness login is still valid; the password was nulled afterwards.
  const token = account.token;
  const direct = await call(
    'POST',
    '/auth/change-password',
    token ?? undefined,
    {
      currentPassword: 'anything-at-all',
      newPassword: 'NewStrongPassword123!',
    },
  );
  check(
    'direct API change-password without a real current password is refused (400)',
    direct.status === 400,
    `(status ${direct.status})`,
  );
  check(
    'password stays NULL after the refused call',
    harnessQuery(
      `select password is null from "User" where id = ${account.userId}`,
    )[0][0] === 't',
  );
  await browser.close();

  console.log(
    '\n== Account form: invalid phone keeps the form and saves nothing',
  );
  const s = await studentPage('profile-form', 1366, false);
  await hidePet(s.page);
  const p = s.page;
  const uid = s.account.userId;
  const nameBefore = harnessQuery(
    `select "fullName" from "Profile" where "userId" = ${uid}`,
  )[0]?.[0];
  await p.goto(`${FE}/hub?tab=account-profile`, {
    waitUntil: 'networkidle',
    timeout: 90_000,
  });
  const nameInput = p.getByPlaceholder('Nhập họ và tên của bạn');
  await nameInput.fill('Học viên QA Đổi Tên');
  await p
    .getByText('Tên người nhận')
    .locator('xpath=following-sibling::input')
    .fill('Người Nhận QA');
  await p.locator('#shipping-phone').fill('0123');
  await pickAddress(p, 'shipping-province-select', 'Hà Nội');
  await p.waitForTimeout(1500);
  await pickAddress(p, 'shipping-ward-select', 'Ba Đình');
  await p
    .getByPlaceholder('Số nhà, tên đường, thôn/ấp, tòa nhà...')
    .fill('12 Phố QA');
  const requests: string[] = [];
  p.on('request', (r) => {
    if (r.url().startsWith(BE) && ['PATCH', 'PUT', 'POST'].includes(r.method()))
      requests.push(`${r.method()} ${r.url().slice(BE.length)}`);
  });
  await p.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await p.locator('#shipping-phone-error').waitFor({ timeout: 10_000 });
  const err = await p.locator('#shipping-phone-error').innerText();
  check(
    'invalid phone shows a Vietnamese error under the phone field',
    err.includes('Số điện thoại không hợp lệ'),
    `(${err})`,
  );
  check(
    'no update request was sent',
    requests.length === 0,
    requests.join(', '),
  );
  check(
    'typed values are kept (name, phone, address line)',
    (await nameInput.inputValue()) === 'Học viên QA Đổi Tên' &&
      (await p.locator('#shipping-phone').inputValue()) === '0123' &&
      (await p
        .getByPlaceholder('Số nhà, tên đường, thôn/ấp, tòa nhà...')
        .inputValue()) === '12 Phố QA',
  );
  await p.screenshot({
    path: `${SHOTS}/profile-invalid-phone.png`,
    fullPage: false,
  });
  check(
    'nothing was saved (name unchanged, no shipping profile)',
    harnessQuery(
      `select "fullName" from "Profile" where "userId" = ${uid}`,
    )[0]?.[0] === nameBefore &&
      harnessQuery(
        `select count(*) from "UserShippingProfile" where "userId" = ${uid}`,
      )[0][0] === '0',
  );

  console.log('\n== Account form: a valid save persists');
  await p.locator('#shipping-phone').fill('0912345678');
  await p.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await p
    .getByText('Cập nhật thông tin thành công!')
    .waitFor({ timeout: 20_000 });
  check('valid save reports success', true);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1000);
  check(
    'after reload the saved name, phone and address line are shown',
    (await nameInput.inputValue()) === 'Học viên QA Đổi Tên' &&
      (await p.locator('#shipping-phone').inputValue())
        .replace(/\D/g, '')
        .endsWith('912345678') &&
      (await p
        .getByPlaceholder('Số nhà, tên đường, thôn/ấp, tòa nhà...')
        .inputValue()) === '12 Phố QA',
  );
  check(
    'database holds the saved values',
    harnessQuery(
      `select "fullName" from "Profile" where "userId" = ${uid}`,
    )[0]?.[0] === 'Học viên QA Đổi Tên' &&
      harnessQuery(
        `select "addressLine" from "UserShippingProfile" where "userId" = ${uid}`,
      )[0]?.[0] === '12 Phố QA',
  );
  check(
    'no server error',
    ![...issues, ...s.issues].some((x) => x.startsWith('api 5')),
    [...issues, ...s.issues].filter((x) => x.startsWith('api')).join(' | '),
  );
  await s.browser.close();

  console.log(`\nPROFILE_BROWSER_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR', e);
  process.exit(2);
});
