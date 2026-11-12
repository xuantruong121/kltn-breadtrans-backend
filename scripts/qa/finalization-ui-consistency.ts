/**
 * One name and one icon for each thing, and the pet speaking on a phone, on
 * the disposable harness (owner 2026-11-12; glossary in the frontend's
 * src/lib/ui/glossary.ts).
 *
 * Browser at 1366 and 390 px: the account menu shows "Cấp", "ngày" and the
 * Bánh Mì wheat icon; the shop uses the same icon; the notification inbox
 * draws each kind with its own icon; listening cards show the format icon; a
 * system badge on the avatar is an icon, not an emoji; on a phone a hungry pet
 * shows a dot, the line is at the top of its panel, and the dot is gone after
 * the panel was opened (a reload before opening keeps it).
 *
 *   HARNESS_DB=<db> [SHOTS=<dir>] npx ts-node --transpile-only scripts/qa/finalization-ui-consistency.ts
 */
import { call, check, failureCount, onboard } from './harness-api';
import { FE, studentPage } from './harness-browser';
import { harnessExec } from './harness-db';

const SHOTS = process.env.SHOTS ?? 'artifacts/finalization/evidence';
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
/** Lucide draws <svg class="lucide lucide-<name>">. */
const icon = (name: string) => `svg.lucide-${name}`;
const EMOJI = /(?![©®™])\p{Extended_Pictographic}/u;

const KINDS: Array<[string, string]> = [
  ['vocab_review', 'layers'],
  ['study_reminder', 'flame'],
  ['streak_shield_used', 'shield-check'],
  ['weekly_report:qa', 'activity'],
  ['plan_expiry:qa', 'crown'],
  ['winback:qa', 'gift'],
  ['MARKET_ORDER_RESULT', 'shopping-bag'],
  ['NEW_MESSAGE', 'croissant'],
  ['SUGGESTION_RESPONSE', 'lightbulb'],
  ['ISSUE_REPORT_RESULT', 'flag'],
];

async function main() {
  const { browser, page, account, issues } = await studentPage('ui-con');
  await onboard(account.token);
  harnessExec(
    `insert into "UserStats" ("userId", "streakCount", "totalBanhRan", "lastStreakUpdate") values (${account.userId}, 3, 40, now())
     on conflict ("userId") do update set "streakCount" = 3, "totalBanhRan" = 40, "lastStreakUpdate" = now()`,
  );
  for (const [type, kind] of KINDS)
    harnessExec(
      `insert into "Notification" ("userId", type, title, body) values (${account.userId}, '${type}', 'QA ${kind}', 'QA')`,
    );

  // ------------------------------------------------ desktop
  await page.goto(`${FE}/ranking`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page.getByRole('button', { name: 'Menu tài khoản' }).click();
  await sleep(800);
  const menu = page
    .locator('[role="menu"], [aria-labelledby], div')
    .filter({ hasText: 'Thông tin cá nhân' })
    .last();
  const menuText = (await menu.innerText()).replace(/\s+/g, ' ');
  check(
    'the account menu says "Cấp", never "Lv."',
    menuText.includes('Cấp ') &&
      !menuText.includes('Lv.') &&
      menuText.includes('40 Bánh Mì') &&
      menuText.includes('3 ngày'),
    menuText.slice(0, 160),
  );
  check(
    'the Bánh Mì amount in the menu has the wheat icon, not a croissant or an emoji',
    (await page.locator(`a[href="/market"] ${icon('wheat')}`).count()) >= 1 &&
      (await page.locator(`a[href="/market"] ${icon('croissant')}`).count()) ===
        0 &&
      !EMOJI.test(menuText),
  );
  check(
    'the pet entry in the menu uses the paw icon',
    (await page.locator(`a[href="/pet"] ${icon('paw-print')}`).count()) >= 1,
  );
  const navText = await page.locator('header nav').first().innerText();
  check(
    'the top menu is Vietnamese: "Thêm", not "More"',
    navText.includes('Thêm') && !/\bMore\b/.test(navText),
    navText.replace(/\s+/g, ' ').slice(0, 140),
  );
  await page.screenshot({ path: `${SHOTS}/ui-menu-1366.png` });
  await page.keyboard.press('Escape');

  await page.goto(`${FE}/notifications`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page.getByText('QA layers').waitFor({ timeout: 30_000 });
  const wrongIcons: string[] = [];
  for (const [, kind] of KINDS) {
    const row = page.locator('article').filter({ hasText: `QA ${kind}` });
    if ((await row.locator(icon(kind)).count()) !== 1) wrongIcons.push(kind);
  }
  check(
    'each kind of notification has its own icon',
    wrongIcons.length === 0,
    wrongIcons.join(','),
  );
  await page.screenshot({
    path: `${SHOTS}/ui-notifications-1366.png`,
    fullPage: true,
  });

  await page.goto(`${FE}/market`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await sleep(2000);
  check(
    'the shop draws prices with the same wheat icon',
    (await page.locator(icon('wheat')).count()) >= 1 &&
      (await page.locator(`main ${icon('croissant')}`).count()) === 0,
  );

  await page.goto(`${FE}/listening`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await sleep(2500);
  check(
    'listening cards show the format icon (two people for a dialogue, a megaphone for a talk)',
    (await page.locator(`${icon('users')}, ${icon('megaphone')}`).count()) >= 1,
  );

  // A system badge on the avatar: an icon.
  await page.evaluate(() => {
    const key = 'breadtrans_gamification_storage';
    const raw = JSON.parse(
      localStorage.getItem(key) ?? '{"state":{},"version":0}',
    );
    raw.state = { ...(raw.state ?? {}), equippedBadge: 'badge_1' };
    localStorage.setItem(key, JSON.stringify(raw));
  });
  await page.goto(`${FE}/hub?tab=account-profile`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await sleep(2500);
  const header = page.locator('header');
  check(
    'a system badge on the avatar is drawn as an icon, with no emoji',
    (await header.locator(`[title="Tân Binh"] ${icon('shield')}`).count()) >=
      1 && !EMOJI.test(await header.innerText()),
    String(await header.locator('[title="Tân Binh"]').count()),
  );

  // ------------------------------------------------ phone: the pet speaks in its panel
  await call('GET', '/gamification/pet', account.token);
  harnessExec(
    `update "UserPet" set roster = (select jsonb_object_agg(key, value || jsonb_build_object('satiety', 30, 'stateUpdatedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) from jsonb_each(roster)) where "userId" = ${account.userId}`,
  );
  await page.evaluate(() => {
    localStorage.removeItem('breadtrans.pet.nudges');
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${FE}/ranking`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  const dot = page.locator('[data-pet-dot="nudge"]');
  const hasDot = await dot
    .waitFor({ timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  check(
    'on a phone a hungry pet shows a dot and no bubble',
    hasDot &&
      (await page
        .locator('[role="dialog"][aria-label$="Đang đói"]')
        .isVisible()
        .catch(() => false)) === false,
  );
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(3000);
  check(
    'a reload before opening the panel keeps the dot',
    (await dot.count()) === 1,
  );
  await page.screenshot({ path: `${SHOTS}/ui-pet-dot-390.png` });

  await page.getByRole('button', { name: /Thú ảo đồng hành/ }).click();
  const nudge = page.locator('[data-pet-nudge="HUNGRY"]');
  const inPanel = await nudge
    .waitFor({ timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  check(
    'the open panel says it is hungry at the top, and feeding is one button (the panel one)',
    inPanel &&
      (await nudge.innerText()).includes('Đang đói') &&
      (await nudge.locator('a, button').count()) === 0 &&
      (await page.getByRole('button', { name: /^Cho thú ảo ăn/ }).count()) === 1,
    inPanel
      ? (await nudge.innerText()).replace(/\s+/g, ' ').slice(0, 120)
      : 'no line',
  );
  await page.screenshot({ path: `${SHOTS}/ui-pet-panel-390.png` });
  await page.keyboard.press('Escape');
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(3000);
  check(
    'after the panel was opened, the dot is gone',
    (await dot.count()) === 0,
  );

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  check('no sideways scroll at 390 px', overflow <= 0, `overflow ${overflow}`);

  // ------------------------------------------------ desktop again
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.evaluate(() => localStorage.removeItem('breadtrans.pet.nudges'));
  await page.goto(`${FE}/ranking`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  const bubble = page.locator('[role="dialog"][aria-label*="Đang đói"]');
  check(
    'on a computer the pet still speaks in its bubble, with no dot',
    await bubble
      .waitFor({ timeout: 20_000 })
      .then(() => true)
      .catch(() => false),
  );
  check(
    'no phone dot on a computer',
    (await page.locator('[data-pet-dot="nudge"]').count()) === 0,
  );
  await page.screenshot({ path: `${SHOTS}/ui-pet-bubble-1366.png` });

  await page.goto(`${FE}/arena`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await sleep(2500);
  const arenaText = await page.locator('main').innerText();
  check(
    'the arena draws Bánh Mì with the wheat icon, with no emoji',
    (await page.locator(`main ${icon('wheat')}`).count()) >= 1 &&
      (await page.locator(`main ${icon('croissant')}`).count()) === 0 &&
      !EMOJI.test(arenaText),
  );
  await page.screenshot({ path: `${SHOTS}/ui-arena-1366.png` });

  await page.goto(`${FE}/plans`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await sleep(2500);
  // textContent: innerText would follow a CSS uppercase on a badge.
  const plansText = (await page.locator('main').textContent()) ?? '';
  check(
    'the plans page writes Free / Plus / Pro',
    /\bPlus\b/.test(plansText) &&
      /\bPro\b/.test(plansText) &&
      !/\b(gói|BreadTrans) (FREE|PLUS|PRO)\b/.test(plansText),
    (plansText.match(/\b(FREE|PLUS|PRO)\b/g) ?? []).join(','),
  );
  await page.screenshot({ path: `${SHOTS}/ui-plans-1366.png`, fullPage: true });

  check(
    'no console or network errors',
    issues.length === 0,
    issues.slice(0, 3).join(' | '),
  );
  await browser.close();
}

void (async () => {
  await main();
  console.log(`\nFAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
})();
