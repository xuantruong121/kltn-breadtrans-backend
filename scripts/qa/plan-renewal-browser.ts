/**
 * /plans for a learner who already pays (harness only, backend started with
 * QA_PAYOS=fake so a payment link can be created; nothing reaches payOS):
 *
 *  - PLUS running: the PLUS card offers "Gia hạn thêm" with the date the new
 *    plan starts, the PRO card offers "Nâng lên Pro ngay" with converted days,
 *    and renewing opens the payment dialog;
 *  - PRO running: the PLUS card cannot be bought, the PRO card renews;
 *  - 390 px: no page-level horizontal overflow.
 *
 * Usage: HARNESS_DB=<db> npx ts-node --transpile-only scripts/qa/plan-renewal-browser.ts
 */
import { call, check, failureCount, newAdmin, onboard } from './harness-api';
import { FE, hidePet, studentPage } from './harness-browser';
import { harnessExec, harnessQuery } from './harness-db';

const one = (sql: string) => harnessQuery(sql)[0]?.[0];

async function grant(admin: string, userId: number, code: 'PLUS' | 'PRO') {
  const planVersionId = Number(
    one(
      `select pv.id from "PlanVersion" pv join "Plan" p on p.id = pv."planId" where pv."isCurrent" and pv.status = 'PUBLISHED' and p.code = '${code}'`,
    ),
  );
  const r = await call('POST', '/admin/subscriptions/grant', admin, {
    studentId: userId,
    planVersionId,
    durationDays: 30,
    reason: 'Harness: plan renewal UI',
  });
  if (r.status >= 300) throw new Error(`grant ${code} ${r.status}`);
}

/** Text of the card whose heading is the plan name. */
async function card(page: any, name: string) {
  const heading = page.getByRole('heading', { name, exact: true });
  await heading.waitFor({ timeout: 60_000 });
  return heading
    .locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]')
    .innerText();
}

async function main() {
  const admin = await newAdmin('renew-ui-admin');

  console.log('\n== PLUS running');
  const s = await studentPage('renew-ui-plus', 1366);
  await onboard(s.account.token);
  await grant(admin.token, s.account.userId, 'PLUS');
  await hidePet(s.page);
  await s.page.goto(`${FE}/plans`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await s.page.getByText('Gia hạn thêm').first().waitFor({ timeout: 60_000 });
  const plusCard = (await card(s.page, 'BreadTrans Plus')).replace(/\s+/g, ' ');
  const proCard = (await card(s.page, 'BreadTrans Pro')).replace(/\s+/g, ' ');
  check(
    'PLUS card: "Gia hạn thêm" with the date the new plan starts',
    /Gia hạn thêm/.test(plusCard) &&
      /Gói mới bắt đầu ngày \d{2}\/\d{2}\/\d{4}, ngay khi gói hiện tại hết hạn/.test(
        plusCard,
      ),
    plusCard.slice(-220),
  );
  check(
    'PRO card: "Nâng lên Pro ngay" with the PLUS days converted',
    /Nâng lên Pro ngay/.test(proCard) &&
      /cộng thêm [\d,]+ ngày quy đổi từ gói hiện tại/.test(proCard),
    proCard.slice(-220),
  );
  await s.page.getByRole('button', { name: 'Gia hạn thêm' }).click();
  const dialog = s.page.getByRole('dialog');
  await dialog.waitFor({ timeout: 60_000 }).catch(() => undefined);
  check(
    'renewing opens the payment dialog',
    (await dialog.count()) > 0,
    `(${await dialog.count()} dialog)`,
  );
  check(
    'PLUS learner: no server error',
    !s.issues.some((x) => x.startsWith('api 5')),
    s.issues.join(' | '),
  );
  await s.browser.close();

  console.log('\n== PRO running, 390 px');
  const p = await studentPage('renew-ui-pro', 390);
  await onboard(p.account.token);
  await grant(admin.token, p.account.userId, 'PRO');
  await hidePet(p.page);
  await p.page.goto(`${FE}/plans`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  // The server's answer has arrived once the PRO card offers a renewal.
  await p.page.getByText('Gia hạn thêm').first().waitFor({ timeout: 60_000 });
  const plusForPro = (await card(p.page, 'BreadTrans Plus')).replace(
    /\s+/g,
    ' ',
  );
  const proForPro = (await card(p.page, 'BreadTrans Pro')).replace(/\s+/g, ' ');
  const plusButton = p.page.getByRole('button', { name: 'Đang dùng Pro' });
  check(
    'PRO learner: the PLUS card cannot be bought and says why, with a Vietnamese date',
    (await plusButton.count()) === 1 &&
      (await plusButton.isDisabled()) &&
      /Bạn đang dùng gói Pro đến hết ngày \d{2}\/\d{2}\/\d{4}\. Có thể mua gói Plus sau khi gói hiện tại hết hạn/.test(
        plusForPro,
      ),
    plusForPro.slice(-200),
  );
  check(
    'PRO learner: the PRO card renews',
    /Gia hạn thêm/.test(proForPro) && /Gói mới bắt đầu ngày/.test(proForPro),
    proForPro.slice(-200),
  );
  const overflow = await p.page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  check('390 px: no horizontal overflow', overflow <= 1, `(${overflow}px)`);
  await p.browser.close();

  console.log('\n== Last days of PLUS: the expiry banner');
  const e = await studentPage('renew-ui-expiring', 1366);
  await onboard(e.account.token);
  await grant(admin.token, e.account.userId, 'PLUS');
  harnessExec(
    `update "Subscription" set "startsAt" = now() - interval '27 days', "endsAt" = now() + interval '2 days 12 hours' where "userId" = ${e.account.userId}`,
  );
  // One Writing B1 task done in this plan: PLUS content FREE locks again.
  const writingB1 = one(
    `select id from "Quiz" where title like 'Writing B1 %' and "publicationStatus" = 'PUBLISHED' order by id limit 1`,
  );
  harnessExec(
    `insert into "Submission" ("quizId", "userId", score, "submittedAt") values (${writingB1}, ${e.account.userId}, 3, now() - interval '1 day')`,
  );
  const summary = await call(
    'GET',
    '/subscriptions/me/expiry-summary',
    e.account.token,
  );
  check(
    'API: 3 days left, nothing queued, Writing Trung cấp used once',
    summary.data?.daysLeft === 3 &&
      summary.data?.queuedRenewal === null &&
      summary.data?.lockedAfterExpiry?.[0]?.label === 'Viết Trung cấp' &&
      summary.data?.lockedAfterExpiry?.[0]?.count === 1,
    JSON.stringify(summary.data),
  );
  await hidePet(e.page);
  await e.page.goto(`${FE}/dashboard`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  const banner = e.page.getByRole('region', {
    name: 'Gói dịch vụ sắp hết hạn',
  });
  await banner.waitFor({ timeout: 60_000 }).catch(() => undefined);
  const bannerText = (await banner.innerText().catch(() => '')).replace(
    /\s+/g,
    ' ',
  );
  check(
    'dashboard: banner with days left, what locks again, and a renew link',
    /Gói Plus còn 3 ngày/.test(bannerText) &&
      /Viết Trung cấp · 1 bài/.test(bannerText) &&
      (await banner.getByRole('link', { name: 'Gia hạn ngay' }).count()) === 1,
    bannerText,
  );
  await e.page.goto(`${FE}/plans`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await banner.waitFor({ timeout: 60_000 }).catch(() => undefined);
  check(
    '/plans: the same banner without its own link (the cards renew)',
    (await banner.count()) === 1 &&
      (await banner.getByRole('link', { name: 'Gia hạn ngay' }).count()) === 0,
  );
  await e.browser.close();

  console.log(`\nPLAN_RENEWAL_BROWSER_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch((error) => {
  console.error('ERROR', error);
  process.exit(2);
});
