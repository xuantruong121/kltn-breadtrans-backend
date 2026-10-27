/**
 * Vocabulary Arena in two real Chromium sessions on the disposable harness:
 * both learners open /arena, pick 20 Bánh, press "Tìm đối thủ ngay", play
 * five rounds by clicking the options (A always right, B always wrong; the
 * answer key is read from the harness Redis), and see the result screen.
 * Balances, XP and the ledger are checked in the harness database.
 */
import Redis from 'ioredis';
import type { Page } from 'playwright';

import { check, failureCount } from './harness-api';
import { FE, hidePet, studentPage } from './harness-browser';
import { harnessExec, harnessQuery } from './harness-db';

const SHOTS = 'artifacts/finalization/evidence';
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
    const q = qs.find((x) => text.includes(x.prompt));
    const enabled = page.locator('button:not([disabled])').filter({ hasText: q?.correctAnswer ?? '\u0000' });
    if (q && (await enabled.count())) {
      const option = right ? q.correctAnswer : q.options.find((o) => o !== q.correctAnswer)!;
      await page.locator('button:not([disabled])').filter({ hasText: option }).first().click();
      return q.prompt;
    }
    await page.waitForTimeout(250);
  }
  return null;
}

async function main() {
  const A = await studentPage('arena-ui-a', 1366);
  const B = await studentPage('arena-ui-b', 1366);
  for (const s of [A, B]) {
    await hidePet(s.page);
    fund(s.account.userId);
  }
  const xpBefore = [xp(A.account.userId), xp(B.account.userId)];
  for (const s of [A, B]) {
    await s.page.goto(`${FE}/arena`, { waitUntil: 'networkidle', timeout: 120_000 });
    await s.page.getByRole('button', { name: '20 Bánh' }).click();
  }
  await A.page.getByRole('button', { name: /Tìm đối thủ ngay/ }).click();
  await A.page.getByText(/Đang tìm đối thủ/).waitFor({ timeout: 15_000 });
  check('A waits in the queue', true);
  await B.page.getByRole('button', { name: /Tìm đối thủ ngay/ }).click();
  const match = await questions(A.account.userId);
  check('two browsers matched', Boolean(match), match?.matchId ?? '');
  if (!match) throw new Error('no match');
  await A.page.screenshot({ path: `${SHOTS}/arena-match-a-1366.png` });

  const asked: string[] = [];
  for (let r = 0; r < 5; r += 1) {
    const [pa] = await Promise.all([answer(A.page, match.qs, true), answer(B.page, match.qs, false)]);
    if (pa) asked.push(pa);
    // Wait for this round's reveal before the next prompt.
    await A.page.waitForTimeout(3500);
  }
  check('five rounds answered in the UI', asked.length === 5 && new Set(asked).size === 5, String(asked.length));
  await A.page.getByText(/Xuất sắc! Bạn đã đánh bại đối thủ/).waitFor({ timeout: 40_000 });
  const bodyB = (await B.page.locator('body').innerText()).replace(/\s+/g, ' ');
  check('A sees the win screen; B sees the loss of 20 Bánh', /-20/.test(bodyB));
  await A.page.screenshot({ path: `${SHOTS}/arena-result-winner-1366.png` });
  await B.page.screenshot({ path: `${SHOTS}/arena-result-loser-1366.png` });
  await new Promise((ok) => setTimeout(ok, 1500));
  check(
    'balances 120 / 80; XP +40 winner only',
    bread(A.account.userId) === 120 && bread(B.account.userId) === 80 && xp(A.account.userId) - xpBefore[0] === 40 && xp(B.account.userId) - xpBefore[1] === 0,
    `(${bread(A.account.userId)}, ${bread(B.account.userId)}, xp ${xp(A.account.userId) - xpBefore[0]}/${xp(B.account.userId) - xpBefore[1]})`,
  );
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
