/**
 * Vocabulary Arena in two real Chromium sessions on the disposable harness:
 * both learners open /arena, pick the 20 Bánh Mì stake, press "Tìm đối thủ",
 * play five rounds by clicking the options (A always right, B always wrong;
 * the answer key is read from the harness Redis), and see the result dialog.
 * Balances, XP and the ledger are checked in the harness database; after
 * "Về sảnh" both lobbies must show the new balance without a reload.
 * SHOTS=<dir> also saves the intro, a round, a reveal and the results there.
 */
import Redis from 'ioredis';
import type { Page } from 'playwright';

import { check, failureCount } from './harness-api';
import { FE, hidePet, studentPage } from './harness-browser';
import { harnessExec, harnessQuery } from './harness-db';

const SHOTS = process.env.SHOTS ?? 'artifacts/finalization/evidence';
const EXTRA = Boolean(process.env.SHOTS);
/** ARENA_WIDTH=390 runs the same match at phone width. */
const WIDTH = Number(process.env.ARENA_WIDTH ?? 1366);
const redis = new Redis({ host: '127.0.0.1', port: 6392 });
const bread = (u: number) =>
  Number(harnessQuery(`select coalesce(max("totalBanhRan"),0) from "UserStats" where "userId" = ${u}`)[0][0]);
const xp = (u: number) =>
  Number(harnessQuery(`select coalesce(sum(points),0) from "PointHistory" where "userId" = ${u}`)[0][0]);
const fund = (u: number) =>
  harnessExec(`insert into "UserStats" ("userId","totalBanhRan") values (${u}, 100) on conflict ("userId") do update set "totalBanhRan" = 100`);

async function questions(userId: number) {
  for (let i = 0; i < 40; i += 1) {
    const id = await redis.get(`arena:user_match:${userId}`);
    const raw = id ? await redis.get(`arena:match:${id}`) : null;
    if (raw) return { matchId: id!, qs: JSON.parse(raw).questions as Array<{ prompt: string; correctAnswer: string; options: string[] }> };
    await new Promise((ok) => setTimeout(ok, 250));
  }
  return null;
}

/** Click an option of the round whose prompt is on screen. */
async function answer(page: Page, qs: Array<{ prompt: string; correctAnswer: string; options: string[] }>, right: boolean) {
  for (let i = 0; i < 80; i += 1) {
    const text = await page.locator('body').innerText();
    // A fill-the-blank prompt is drawn with a gap, so match the text around it.
    const flat = text.replace(/\s+/g, ' ');
    const q = qs.find((x) =>
      x.prompt
        .split('_____')
        .map((part) => part.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .every((part) => flat.includes(part)),
    );
    const optionButton = (option: string) =>
      page.locator('button:not([disabled])').filter({ has: page.getByText(option, { exact: true }) });
    if (q && (await optionButton(q.correctAnswer).count())) {
      const option = right ? q.correctAnswer : q.options.find((o) => o !== q.correctAnswer)!;
      await optionButton(option).first().click();
      return q.prompt;
    }
    await page.waitForTimeout(250);
  }
  return null;
}

async function main() {
  const A = await studentPage('arena-ui-a', WIDTH);
  const B = await studentPage('arena-ui-b', WIDTH);
  for (const s of [A, B]) {
    await hidePet(s.page);
    fund(s.account.userId);
  }
  const xpBefore = [xp(A.account.userId), xp(B.account.userId)];
  for (const s of [A, B]) {
    await s.page.goto(`${FE}/arena`, { waitUntil: 'networkidle', timeout: 120_000 });
    await s.page.getByRole('button', { name: '20 Bánh Mì', exact: true }).click();
  }
  await A.page.getByRole('button', { name: /^Tìm đối thủ/ }).click();
  await A.page.getByText(/Đang tìm đối thủ/).waitFor({ timeout: 15_000 });
  check('A waits in the queue', true);
  if (EXTRA) await A.page.screenshot({ path: `${SHOTS}/arena-searching-${WIDTH}.png` });
  const pet = (page: typeof A.page) => page.getByRole('button', { name: /^Thú cưng đồng hành/ }).count();
  const petInLobby = await pet(A.page);
  await B.page.getByRole('button', { name: /^Tìm đối thủ/ }).click();
  const match = await questions(A.account.userId);
  check('two browsers matched', Boolean(match), match?.matchId ?? '');
  if (!match) throw new Error('no match');
  await A.page.waitForTimeout(900);
  await A.page.screenshot({ path: `${SHOTS}/arena-match-a-${WIDTH}.png` });
  // Owner 2026-11-08: the floating pet stays away while two learners play.
  if (petInLobby === 0) console.log('NOT_VERIFIED  pet hidden in a match: no pet shown in the lobby for this account');
  else check('the floating pet shows in the lobby and hides in the match', (await pet(A.page)) === 0, `lobby ${petInLobby}`);
  if (EXTRA) await B.page.screenshot({ path: `${SHOTS}/arena-intro-b-${WIDTH}.png` });

  const asked: string[] = [];
  for (let r = 0; r < 10; r += 1) {
    if (EXTRA && r === 0) {
      await A.page.locator('[role="timer"]').first().waitFor({ timeout: 15_000 });
      await A.page.evaluate(() => window.scrollTo(0, 0));
      await A.page.waitForTimeout(2500);
      await A.page.screenshot({ path: `${SHOTS}/arena-round-live-${WIDTH}.png` });
    }
    const [pa] = await Promise.all([answer(A.page, match.qs, true), answer(B.page, match.qs, false)]);
    if (pa) asked.push(pa);
    if (EXTRA && r === 1) {
      await A.page.screenshot({ path: `${SHOTS}/arena-round-answered-${WIDTH}.png` });
      await A.page.waitForTimeout(1200);
      await A.page.screenshot({ path: `${SHOTS}/arena-round-reveal-a-${WIDTH}.png` });
      await B.page.screenshot({ path: `${SHOTS}/arena-round-reveal-b-${WIDTH}.png` });
    }
    // Wait for this round's reveal before the next prompt.
    await A.page.waitForTimeout(3500);
  }
  check('ten rounds answered in the UI', asked.length === 10 && new Set(asked).size === 10, String(asked.length));
  await A.page.getByRole('heading', { name: 'Bạn thắng!' }).waitFor({ timeout: 40_000 });
  const bodyB = (await B.page.locator('body').innerText()).replace(/\s+/g, ' ');
  check('A sees the win dialog; B sees the loss of 20 Bánh Mì', /Bạn thua/.test(bodyB) && /[−-]20/.test(bodyB));
  await A.page.screenshot({ path: `${SHOTS}/arena-result-winner-${WIDTH}.png` });
  await B.page.screenshot({ path: `${SHOTS}/arena-result-loser-${WIDTH}.png` });
  // Owner 2026-11-08: the sticky header covered the top of the dialog. The
  // element at the dialog's top edge must not belong to the header (a passing
  // reward toast may sit there; it is meant to be on top).
  for (const [s, name] of [[A, 'A'], [B, 'B']] as const) {
    const onTop = await s.page.evaluate(() => {
      const d = document.querySelector('[role="dialog"][aria-labelledby="result-title"]');
      if (!d) return false;
      const r = d.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, Math.max(r.top + 4, 1));
      return Boolean(hit && !hit.closest('header'));
    });
    check(`${name}: the result dialog is above the header`, onTop);
  }
  const bodyA = (await A.page.locator('body').innerText()).replace(/\s+/g, ' ');
  check(
    'the result says the XP: A +50, B none (no correct answer)',
    /\+50 XP/.test(bodyA) && /Chưa có câu đúng nào/.test(bodyB),
  );
  await new Promise((ok) => setTimeout(ok, 1500));
  check(
    'balances 120 / 80; XP 50 for A (10 right), 0 for B (owner decision 2026-11-08)',
    bread(A.account.userId) === 120 && bread(B.account.userId) === 80 && xp(A.account.userId) - xpBefore[0] === 50 && xp(B.account.userId) - xpBefore[1] === 0,
    `(${bread(A.account.userId)}, ${bread(B.account.userId)}, xp ${xp(A.account.userId) - xpBefore[0]}/${xp(B.account.userId) - xpBefore[1]})`,
  );
  // The original bug: back in the lobby the balance stayed stale until a reload.
  for (const [s, expected] of [[A, 120], [B, 80]] as const) {
    await s.page.getByRole('button', { name: 'Về sảnh' }).click();
    const ok = await s.page
      .getByText(new RegExp(`Bạn có ${expected} Bánh Mì`))
      .waitFor({ timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    check(`${s === A ? 'A' : 'B'}: lobby shows ${expected} Bánh Mì without a reload`, ok);
  }
  if (EXTRA) await A.page.screenshot({ path: `${SHOTS}/arena-lobby-after-${WIDTH}.png`, fullPage: true });
  const ledger = harnessQuery(`select source, count(*) from "BanhTransaction" where reference like 'arena:match:${match.matchId}:%' group by source order by source`).map(([s, n]) => `${s}=${n}`);
  check('ledger ARENA_STAKE=2, ARENA_WIN=1', ledger.join(',') === 'ARENA_STAKE=2,ARENA_WIN=1', ledger.join(','));
  for (const s of [A, B])
    check(`${s === A ? 'A' : 'B'}: no server or page error`, !s.issues.some((x) => x.startsWith('api 5') || x.startsWith('pageerror')), s.issues.join(' | ').slice(0, 200));
  await A.browser.close();
  await B.browser.close();
  await redis.quit();
  console.log(`\nARENA_BROWSER_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch(async (e) => {
  console.error('ERROR', e);
  await redis.quit().catch(() => undefined);
  process.exit(2);
});
