/**
 * Bắn chữ rơi on the disposable harness (owner 2026-11-08). The answers are
 * read straight from the harness Redis, as a perfect player would know them.
 *   API: a win pays the stake back plus half (one BLASTER_RETURN, one
 *        BLASTER_WIN); a loss and leaving keep the stake; the start reply
 *        holds no answer; a game left alone is settled by the sweep.
 *   Browser: the menu shows Đấu trường, More holds Bảng xếp hạng then FAQ;
 *        /arena shows the game card; a game won by typing; a game left
 *        through Thoát.
 *
 *   HARNESS_DB=<db> [SHOTS=<dir>] npx ts-node --transpile-only scripts/qa/finalization-word-blaster.ts
 */
import Redis from 'ioredis';
import type { Page } from 'playwright';

import { call, check, failureCount, newStudent } from './harness-api';
import { FE, studentPage } from './harness-browser';
import { harnessExec, harnessQuery } from './harness-db';

const SHOTS = process.env.SHOTS ?? 'artifacts/finalization/evidence';
const redis = new Redis({ host: '127.0.0.1', port: 6392 });
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const bread = (u: number) =>
  Number(
    harnessQuery(
      `select coalesce(max("totalBanhRan"),0) from "UserStats" where "userId" = ${u}`,
    )[0][0],
  );
const fund = (u: number, amount: number) =>
  harnessExec(
    `insert into "UserStats" ("userId","totalBanhRan") values (${u}, ${amount}) on conflict ("userId") do update set "totalBanhRan" = ${amount}`,
  );
const ledger = (u: number) =>
  harnessQuery(
    `select source, amount from "BanhTransaction" where "userId" = ${u} and source like 'BLASTER_%' order by id`,
  ).map((r) => `${r[0]}:${r[1]}`);

type Stored = {
  startedAt: number;
  blocks: { id: number; spawnAtMs: number; answers: string[] }[];
};
const stored = async (id: string) =>
  JSON.parse((await redis.get(`blaster:session:${id}`))!) as Stored;

/** Waits for each block and shoots its answer: a perfect game. */
async function playPerfect(
  id: string,
  shoot: (text: string) => Promise<unknown>,
) {
  const s = await stored(id);
  for (const b of s.blocks) {
    const wait = s.startedAt + b.spawnAtMs + 150 - Date.now();
    if (wait > 0) await sleep(wait);
    await shoot(b.answers[0]);
  }
}

async function api() {
  // A win.
  const a = await newStudent('blaster-win');
  fund(a.userId, 200);
  const start = await call('POST', '/games/word-blaster/start', a.token, {
    stake: 50,
  });
  const raw = JSON.stringify(start.data);
  check(
    'start opens a game of 20 blocks',
    start.status === 200 && start.data?.blocks?.length === 20,
    String(start.status),
  );
  check(
    'the start reply holds no answer and no meaning',
    !/answers|meaningVi|displayWord/.test(raw),
  );
  check(
    'stake taken (200 → 150)',
    bread(a.userId) === 150,
    String(bread(a.userId)),
  );
  const again = await call('POST', '/games/word-blaster/start', a.token, {
    stake: 100,
  });
  check(
    'a second start returns the open game, no second stake',
    again.data?.sessionId === start.data.sessionId && bread(a.userId) === 150,
  );
  const id = start.data.sessionId as string;
  let last: any = null;
  await playPerfect(id, async (text) => {
    last = (
      await call('POST', `/games/word-blaster/${id}/shot`, a.token, { text })
    ).data;
  });
  check(
    '20 hits win',
    last?.result?.outcome === 'win' && last.result.destroyed === 20,
    JSON.stringify(last?.result)?.slice(0, 120),
  );
  check(
    'a win: 150 + 50 back + 25 bonus = 225',
    bread(a.userId) === 225,
    String(bread(a.userId)),
  );
  check(
    'ledger: one stake, one return, one bonus',
    JSON.stringify(ledger(a.userId)) ===
      JSON.stringify([
        'BLASTER_STAKE:-50',
        'BLASTER_RETURN:50',
        'BLASTER_WIN:25',
      ]),
    JSON.stringify(ledger(a.userId)),
  );
  const fin = await call(
    'POST',
    `/games/word-blaster/${id}/finish`,
    a.token,
    {},
  );
  check(
    'finishing again pays nothing more',
    fin.data?.result?.outcome === 'win' && bread(a.userId) === 225,
  );

  // Leaving.
  const b = await newStudent('blaster-leave');
  fund(b.userId, 100);
  const sb = await call('POST', '/games/word-blaster/start', b.token, {
    stake: 20,
  });
  const other = await call(
    'POST',
    `/games/word-blaster/${sb.data.sessionId}/shot`,
    a.token,
    { text: 'x' },
  );
  check(
    'another learner cannot shoot in this game',
    other.status === 403,
    String(other.status),
  );
  const left = await call(
    'POST',
    `/games/word-blaster/${sb.data.sessionId}/finish`,
    b.token,
    { forfeit: true },
  );
  check(
    'leaving loses the stake (100 → 80)',
    left.data?.result?.outcome === 'lose' && bread(b.userId) === 80,
    String(bread(b.userId)),
  );

  // A game left alone: the sweep settles it.
  const c = await newStudent('blaster-sweep');
  fund(c.userId, 100);
  const sc = await call('POST', '/games/word-blaster/start', c.token, {
    stake: 20,
  });
  const sid = sc.data.sessionId as string;
  const session = JSON.parse((await redis.get(`blaster:session:${sid}`))!);
  session.startedAt -= 600_000;
  session.deadline -= 600_000;
  await redis.set(
    `blaster:session:${sid}`,
    JSON.stringify(session),
    'EX',
    1800,
  );
  await redis.zadd('blaster:open', session.deadline, sid);
  let settled: any = null;
  for (let i = 0; i < 40 && !settled; i += 1) {
    await sleep(1000);
    settled =
      JSON.parse((await redis.get(`blaster:session:${sid}`)) ?? 'null')
        ?.result ?? null;
  }
  check(
    'a game left alone is settled by the sweep as a loss',
    settled?.outcome === 'lose' && bread(c.userId) === 80,
    JSON.stringify(settled)?.slice(0, 80),
  );
  const cur = await call('GET', '/games/word-blaster/current', c.token);
  check(
    'no open game after it',
    cur.data === null || cur.data === '' || cur.data === undefined,
    JSON.stringify(cur.data)?.slice(0, 60),
  );

  check(
    'a stake outside 20/50/100 is refused',
    (await call('POST', '/games/word-blaster/start', c.token, { stake: 30 }))
      .status === 400,
  );
}

async function browser(width: number) {
  const s = await studentPage(`blaster-ui-${width}`, width);
  fund(s.account.userId, 300);
  const page: Page = s.page;
  await page.goto(`${FE}/arena`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  if (width >= 1280) {
    const nav = (await page.locator('header nav').first().innerText()).replace(
      /\s+/g,
      ' ',
    );
    check(
      'the menu says Đấu trường',
      /Đấu trường/.test(nav),
      nav.slice(0, 120),
    );
    // The More list is in the header markup in order: More, Bảng xếp hạng, FAQ.
    const more = nav.indexOf('More');
    const ranking = nav.indexOf('Bảng xếp hạng');
    check(
      'More holds Bảng xếp hạng before FAQ, after the Đấu trường button',
      nav.indexOf('Đấu trường') < more &&
        more < ranking &&
        ranking < nav.indexOf('FAQ'),
    );
  }
  check(
    '/arena shows the Bắn chữ rơi card',
    await page
      .getByRole('heading', { name: 'Bắn chữ rơi' })
      .waitFor({ timeout: 30_000 })
      .then(() => true)
      .catch(() => false),
  );
  await page.screenshot({
    path: `${SHOTS}/blaster-arena-${width}.png`,
    fullPage: true,
  });
  await page.goto(`${FE}/ranking`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  check(
    '/ranking shows the league',
    await page
      .getByRole('heading', { name: 'Bảng xếp hạng', level: 1 })
      .waitFor({ timeout: 30_000 })
      .then(() => true)
      .catch(() => false),
  );
  await page.screenshot({
    path: `${SHOTS}/blaster-ranking-${width}.png`,
    fullPage: true,
  });

  await page.goto(`${FE}/arena/word-blaster`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page.screenshot({
    path: `${SHOTS}/blaster-picker-${width}.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: '20 Bánh Mì', exact: true }).click();
  await page.getByRole('button', { name: 'Bắt đầu' }).click();
  const input = page.getByRole('textbox', { name: /Gõ đáp án/ });
  await input.waitFor({ timeout: 20_000 });
  check(
    'the game hides the site header',
    (await page.locator('header nav').count()) === 0 ||
      !(await page.locator('header nav').first().isVisible()),
  );
  const id = await redis.get(`blaster:user:${s.account.userId}`);
  if (!id) throw new Error('no open game');

  if (width >= 1280) {
    // A perfect game, typed.
    let shotCount = 0;
    await playPerfect(id, async (text) => {
      // Let a few blocks fall once, for a picture of the field in play.
      if (shotCount === 8) {
        await sleep(3000);
        await page.screenshot({
          path: `${SHOTS}/blaster-falling-${width}.png`,
        });
      }
      await input.fill(text);
      await input.press('Enter');
      shotCount += 1;
      if (shotCount === 6)
        await page.screenshot({ path: `${SHOTS}/blaster-play-${width}.png` });
      await sleep(120);
    });
    const won = await page
      .getByRole('heading', { name: 'Bạn thắng!' })
      .waitFor({ timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    await sleep(1200);
    await page.screenshot({ path: `${SHOTS}/blaster-win-${width}.png` });
    check(
      'a game won by typing shows Bạn thắng! and +10',
      won && /\+10/.test(await page.locator('[role="dialog"]').innerText()),
    );
    check(
      'balance 300 → 310',
      bread(s.account.userId) === 310,
      String(bread(s.account.userId)),
    );
  } else {
    // Two hits, then leave.
    const st = await stored(id);
    for (const b of st.blocks.slice(0, 2)) {
      const wait = st.startedAt + b.spawnAtMs + 150 - Date.now();
      if (wait > 0) await sleep(wait);
      await input.fill(b.answers[0]);
      await input.press('Enter');
      await sleep(200);
    }
    await page.screenshot({ path: `${SHOTS}/blaster-play-${width}.png` });
    await page.getByRole('button', { name: 'Thoát', exact: true }).click();
    const ask = page.getByRole('alertdialog', { name: 'Thoát ván chơi?' });
    check('Thoát asks first', await ask.isVisible());
    await page.screenshot({ path: `${SHOTS}/blaster-leave-ask-${width}.png` });
    await page.getByRole('button', { name: 'Thoát, chịu thua' }).click();
    const leftShown = await page
      .getByRole('heading', { name: 'Đã thoát ván' })
      .waitFor({ timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    await sleep(1000);
    await page.screenshot({ path: `${SHOTS}/blaster-left-${width}.png` });
    check(
      'leaving shows the result and costs the stake (300 → 280)',
      leftShown && bread(s.account.userId) === 280,
      String(bread(s.account.userId)),
    );
  }
  check(
    `${width}: no server or page error`,
    s.issues.length === 0,
    s.issues.join(' | '),
  );
  await s.browser.close();
}

async function main() {
  await api();
  await browser(1366);
  await browser(390);
  await redis.quit();
  console.log(`\nWORD_BLASTER_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch(async (e) => {
  console.error('ERROR', e);
  await redis.quit().catch(() => undefined);
  process.exit(2);
});
