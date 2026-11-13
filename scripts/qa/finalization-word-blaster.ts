/**
 * Pháo Bánh Mì on the disposable harness (owner 2026-11-08). The answers are
 * read straight from the harness Redis, as a perfect player would know them.
 *   API: a win pays the stake back plus the stake again (one BLASTER_RETURN,
 *        one BLASTER_WIN; owner 2026-11-13); a loss and leaving keep the stake; the start reply
 *        holds no answer; a game left alone is settled by the sweep.
 *   Browser: the menu shows Đấu trường, Thêm holds Bảng xếp hạng then Trợ giúp;
 *        /arena lists the games in a sidebar and Pháo Bánh Mì's lobby opens
 *        from it. Answers are typed one key at a time, never with Enter
 *        (owner 2026-11-08, after ZType): a Gõ lại từ game won at 1366 with
 *        one block let through and one wrong key refused, a Nghĩa → từ game
 *        with underscore hints, a Từ → nghĩa game on a phone, both left
 *        through Thoát. It also counts frames while blocks fall.
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

type StoredBlock = {
  id: number;
  spawnAtMs: number;
  fallMs: number;
  answers: string[];
  hint: string | null;
};
type Stored = { startedAt: number; blocks: StoredBlock[] };
/** Word lengths: "dam phan" → "3,4". */
const shape = (text: string) =>
  text
    .split(' ')
    .filter(Boolean)
    .map((w) => [...w].length)
    .join(',');
/** The answer the page will take letter by letter: one that fits the hint. */
const answerFor = (b: StoredBlock) =>
  b.hint
    ? (b.answers.find((a) => shape(a) === shape(b.hint!)) ?? b.answers[0])
    : b.answers[0];
const stored = async (id: string) =>
  JSON.parse((await redis.get(`blaster:session:${id}`))!) as Stored;

/**
 * Waits until a block is on screen, as the server times it, and returns it.
 * The schedule is read again while waiting: after a hit on an empty field
 * the server brings the next blocks in early (owner 2026-11-08).
 */
async function untilSpawned(id: string, blockId: number): Promise<StoredBlock> {
  for (;;) {
    const s = await stored(id);
    const b = s.blocks.find((x) => x.id === blockId)!;
    const wait = s.startedAt + b.spawnAtMs + 150 - Date.now();
    if (wait <= 0) return b;
    await sleep(Math.min(wait, 200));
  }
}

/** Waits for each block and shoots its answer: a perfect game. */
async function playPerfect(
  id: string,
  shoot: (text: string) => Promise<unknown>,
) {
  const s = await stored(id);
  for (const first of s.blocks) {
    const b = await untilSpawned(id, first.id);
    await shoot(b.answers[0]);
  }
}

async function api() {
  // A win.
  const a = await newStudent('blaster-win');
  fund(a.userId, 200);
  // Owner 2026-11-08: one mode per game. The meaning mode shows the word and
  // one underscore per letter of the meaning.
  const start = await call('POST', '/games/word-blaster/start', a.token, {
    stake: 50,
    mode: 'en_to_vi',
  });
  const raw = JSON.stringify(start.data);
  const blocks = (start.data?.blocks ?? []) as {
    kind: string;
    hint: string | null;
  }[];
  check(
    'start opens a game of 20 blocks, all Từ → nghĩa with a letter hint',
    start.status === 200 &&
      blocks.length === 20 &&
      blocks.every(
        (b) => b.kind === 'en_to_vi' && /^[_ ]+$/.test(b.hint ?? ''),
      ),
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
    mode: 'copy',
  });
  check(
    'a second start returns the open game, no second stake',
    again.data?.sessionId === start.data.sessionId && bread(a.userId) === 150,
  );
  const id = start.data.sessionId as string;
  const planned = (await stored(id)).blocks.map((b) => b.spawnAtMs);
  let last: any = null;
  await playPerfect(id, async (text) => {
    last = (
      await call('POST', `/games/word-blaster/${id}/shot`, a.token, { text })
    ).data;
  });
  const after = (await stored(id)).blocks.map((b) => b.spawnAtMs);
  check(
    'a perfect player never waits long: an empty field brings blocks in early',
    after.some((at, i) => at < planned[i]) &&
      after.every((at, i) => i === 0 || at > after[i - 1]),
    `${planned.at(-1)} → ${after.at(-1)} ms for the last block`,
  );
  check(
    '20 hits win',
    last?.result?.outcome === 'win' && last.result.destroyed === 20,
    JSON.stringify(last?.result)?.slice(0, 120),
  );
  check(
    'a win: 150 + 50 back + 50 bonus = 250',
    bread(a.userId) === 250,
    String(bread(a.userId)),
  );
  check(
    'ledger: one stake, one return, one bonus',
    JSON.stringify(ledger(a.userId)) ===
      JSON.stringify([
        'BLASTER_STAKE:-50',
        'BLASTER_RETURN:50',
        'BLASTER_WIN:50',
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
    fin.data?.result?.outcome === 'win' && bread(a.userId) === 250,
  );

  // Leaving.
  const b = await newStudent('blaster-leave');
  fund(b.userId, 100);
  const sb = await call('POST', '/games/word-blaster/start', b.token, {
    stake: 20,
    mode: 'copy',
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
    mode: 'missing',
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
    (
      await call('POST', '/games/word-blaster/start', c.token, {
        stake: 30,
        mode: 'copy',
      })
    ).status === 400,
  );
  check(
    'a start without a mode is refused',
    (await call('POST', '/games/word-blaster/start', c.token, { stake: 20 }))
      .status === 400,
  );
}

const MODE_BUTTON: Record<string, RegExp> = {
  copy: /^Gõ lại từ/,
  vi_to_en: /^Nghĩa → từ/,
  en_to_vi: /^Từ → nghĩa/,
};

/**
 * Types an answer one key at a time. Returns true when the page sent it by
 * itself (the box emptied without Enter); otherwise presses Enter and
 * returns false, so a check can count it.
 */
async function typeAnswer(page: Page, text: string): Promise<boolean> {
  await page.keyboard.type(text, { delay: 30 });
  const input = page.getByRole('textbox', { name: /Gõ đáp án/ });
  for (let i = 0; i < 10; i += 1) {
    if ((await input.inputValue()) === '') return true;
    await sleep(50);
  }
  await input.press('Enter');
  return false;
}

/** Frames per second over two seconds, counted with requestAnimationFrame. */
const fps = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((ok) => {
        let frames = 0;
        const t0 = performance.now();
        const step = () => {
          frames += 1;
          const ms = performance.now() - t0;
          if (ms < 2000) requestAnimationFrame(step);
          else ok(Math.round((frames * 1000) / ms));
        };
        requestAnimationFrame(step);
      }),
  );

const hitCount = async (id: string) =>
  Object.keys(
    JSON.parse((await redis.get(`blaster:session:${id}`)) ?? '{}')?.hits ?? {},
  ).length;

async function leaveGame(
  page: Page,
  width: number,
  tag: string,
  userId: number,
) {
  await page.getByRole('button', { name: 'Thoát', exact: true }).click();
  const ask = page.getByRole('alertdialog', { name: 'Thoát ván chơi?' });
  check(
    `${tag}: Thoát asks first`,
    await ask
      .waitFor({ timeout: 5000 })
      .then(() => true)
      .catch(() => false),
  );
  await page.screenshot({
    path: `${SHOTS}/blaster-leave-ask-${tag}-${width}.png`,
  });
  await page.getByRole('button', { name: 'Thoát, chịu thua' }).click();
  const leftShown = await page
    .getByRole('heading', { name: 'Đã thoát ván' })
    .waitFor({ timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  await sleep(1000);
  await page.screenshot({ path: `${SHOTS}/blaster-left-${tag}-${width}.png` });
  check(
    `${tag}: leaving shows the result and costs the stake (300 → 280)`,
    leftShown && bread(userId) === 280,
    String(bread(userId)),
  );
}

async function browser(width: number, mode: 'copy' | 'vi_to_en' | 'en_to_vi') {
  const tag = `${mode}-${width}`;
  const s = await studentPage(`blaster-ui-${tag}`, width);
  fund(s.account.userId, 300);
  const page: Page = s.page;
  const first = mode === 'copy';
  await page.goto(`${FE}/arena`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  if (first && width >= 1280) {
    const nav = (await page.locator('header nav').first().innerText()).replace(
      /\s+/g,
      ' ',
    );
    check(
      'the menu says Đấu trường',
      /Đấu trường/.test(nav),
      nav.slice(0, 120),
    );
    // The Thêm list is in the header markup in order: Thêm, Bảng xếp hạng, Trợ giúp
    // (More and FAQ were renamed 2026-11-12).
    const more = nav.indexOf('Thêm');
    const ranking = nav.indexOf('Bảng xếp hạng');
    check(
      'Thêm holds Bảng xếp hạng before Trợ giúp, after the Đấu trường button',
      nav.indexOf('Đấu trường') < more &&
        more < ranking &&
        ranking < nav.indexOf('Trợ giúp'),
    );
  }
  // Owner 2026-11-08: the games sit in a sidebar, not one per row.
  const nav = page.getByRole('navigation', {
    name: 'Trò chơi trong Đấu trường',
  });
  await nav
    .getByRole('button', { name: /Pháo Bánh Mì/ })
    .waitFor({ timeout: 30_000 });
  if (first) {
    check(
      '/arena lists Song Đấu Từ Vựng and Pháo Bánh Mì in its game sidebar',
      (await nav.getByRole('button', { name: /Song Đấu Từ Vựng/ }).count()) ===
        1 &&
        (await nav.getByRole('button', { name: /Pháo Bánh Mì/ }).count()) === 1,
    );
  }
  await nav.getByRole('button', { name: /Pháo Bánh Mì/ }).click();
  check(
    `${tag}: picking Pháo Bánh Mì opens its lobby (?game=blaster)`,
    (await page
      .getByRole('heading', { name: 'Pháo Bánh Mì', level: 1 })
      .waitFor({ timeout: 30_000 })
      .then(() => true)
      .catch(() => false)) && page.url().includes('game=blaster'),
    page.url(),
  );
  if (first) {
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
    await page.goto(`${FE}/arena?game=blaster`, {
      waitUntil: 'networkidle',
      timeout: 120_000,
    });
    await page
      .getByRole('heading', { name: 'Pháo Bánh Mì', level: 1 })
      .waitFor({ timeout: 30_000 });
  }
  await page.getByRole('button', { name: '20 Bánh Mì', exact: true }).click();
  await page.getByRole('button', { name: MODE_BUTTON[mode] }).click();
  await page.screenshot({
    path: `${SHOTS}/blaster-picker-${tag}.png`,
    fullPage: true,
  });
  // A dev server compiles the play page on its first visit, which can outlast
  // the opening (countdown, floor map); compile it before the run starts.
  await page.request
    .get(`${FE}/arena/word-blaster`, { timeout: 120_000 })
    .catch(() => undefined);
  await page.getByRole('button', { name: 'Bắt đầu' }).click();
  await page.waitForURL(/\/arena\/word-blaster/, { timeout: 30_000 });
  const input = page.getByRole('textbox', { name: /Gõ đáp án/ });
  await input.waitFor({ timeout: 20_000 });
  check(
    `${tag}: the game hides the site header`,
    (await page.locator('header nav').count()) === 0 ||
      !(await page.locator('header nav').first().isVisible()),
  );
  const id = await redis.get(`blaster:user:${s.account.userId}`);
  if (!id) throw new Error('no open game');
  const st = await stored(id);

  // The 3, 2, 1 before the first block (it shows only if the page opened in time).
  const callout = page.locator('[data-blaster-callout]');
  let counted = '';
  for (let i = 0; i < 30 && !counted; i += 1) {
    const text = (await callout.innerText().catch(() => '')).trim();
    if (/^[321]$/.test(text)) counted = text;
    else await sleep(100);
  }
  if (first) {
    check(
      `${tag}: a 3-2-1 countdown runs before the first block`,
      counted !== '',
      counted || 'no number seen',
    );
    await page.screenshot({ path: `${SHOTS}/blaster-countdown-${tag}.png` });
  }

  if (mode === 'copy') {
    // Owner 2026-11-08: a wrong key is refused and the box keeps its text.
    const LET_THROUGH = 4;
    const WRONG_AT = 2;
    let auto = 0;
    let typedCount = 0;
    let wrongKept = false;
    let lockShown = false;
    for (const [i, first] of st.blocks.entries()) {
      const b = await untilSpawned(id, first.id);
      if (i === LET_THROUGH) {
        // Let this one land: a picture of the life it costs.
        const lands = st.startedAt + b.spawnAtMs + b.fallMs + 650;
        setTimeout(
          () => {
            void page
              .screenshot({ path: `${SHOTS}/blaster-life-lost-${tag}.png` })
              .catch(() => undefined);
          },
          Math.max(0, lands - Date.now()),
        );
        continue;
      }
      const answer = answerFor(b);
      if (i === WRONG_AT) {
        await page.keyboard.type(answer.slice(0, 2), { delay: 30 });
        lockShown = await page
          .getByText('Đang ngắm:')
          .isVisible()
          .catch(() => false);
        await page.screenshot({ path: `${SHOTS}/blaster-locked-${tag}.png` });
        await page.keyboard.press('#');
        await sleep(80);
        wrongKept = (await input.inputValue()) === answer.slice(0, 2);
        await page.keyboard.type(answer.slice(2), { delay: 30 });
        for (let k = 0; k < 10 && (await input.inputValue()) !== ''; k += 1)
          await sleep(50);
        if ((await input.inputValue()) === '') auto += 1;
        else await input.press('Enter');
        typedCount += 1;
        await sleep(90);
        await page.screenshot({
          path: `${SHOTS}/blaster-explosion-${tag}.png`,
        });
        continue;
      }
      if (i === 9) {
        const rate = await fps(page);
        check(
          `${tag}: at least 50 frames a second while blocks fall`,
          rate >= 50,
          `${rate} fps`,
        );
      }
      if (await typeAnswer(page, answer)) auto += 1;
      typedCount += 1;
      if (i === 12)
        await page.screenshot({ path: `${SHOTS}/blaster-play-${tag}.png` });
    }
    check(
      `${tag}: the first letters lock the cannon on a block (Đang ngắm)`,
      lockShown,
    );
    check(
      `${tag}: a wrong key is refused and the box keeps its letters`,
      wrongKept,
    );
    check(
      `${tag}: every answer fired by itself once complete, no Enter`,
      auto === typedCount,
      `${auto}/${typedCount}`,
    );
    const won = await page
      .getByRole('heading', { name: 'Bạn thắng!' })
      .waitFor({ timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    await sleep(1500);
    await page.screenshot({ path: `${SHOTS}/blaster-win-${tag}.png` });
    const dialog = won ? await page.locator('[role="dialog"]').innerText() : '';
    check(
      `${tag}: 19 typed and one let through still wins, +20`,
      won && /\+20/.test(dialog) && /lọt 1/.test(dialog),
      dialog.replace(/\s+/g, ' ').slice(0, 160),
    );
    check(
      `${tag}: the result shows blocks, best combo and accuracy`,
      /Bắn vỡ\s*19\/20/.test(dialog) &&
        /Combo dài nhất\s*×\d+/.test(dialog) &&
        /Chính xác\s*\d+%/.test(dialog),
      dialog.replace(/\s+/g, ' ').slice(0, 200),
    );
    check(
      `${tag}: balance 300 → 320`,
      bread(s.account.userId) === 320,
      String(bread(s.account.userId)),
    );
    // Owner 2026-11-08: the Arena uses dictionary words only; no review list.
    check(
      `${tag}: the result has no word list to review`,
      !/ôn lại/i.test(dialog),
    );
    await page.getByRole('button', { name: 'Chơi lại' }).click();
    await page.waitForURL(/game=blaster/, { timeout: 20_000 });
    check(
      `${tag}: Chơi lại returns to the lobby in the sidebar`,
      page.url().includes('/arena?game=blaster'),
      page.url(),
    );
  } else {
    // A meaning mode: the hint first, then a few answers typed key by key.
    await untilSpawned(id, st.blocks[0].id);
    const label = mode === 'vi_to_en' ? 'Từ có' : 'Nghĩa có';
    const hinted = page.locator(`[aria-label^="${label}"]`).first();
    const hintOk = await hinted
      .waitFor({ timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    const hintText = hintOk
      ? ((await hinted.getAttribute('aria-label')) ?? '')
      : '';
    const want = st.blocks[0].hint?.replace(/ /g, '').length ?? -1;
    check(
      `${tag}: blocks show one underscore per letter of the answer`,
      hintOk && hintText === `${label} ${want} chữ cái`,
      `${hintText} / want ${want}`,
    );
    const SHOTS_TO_TYPE = width >= 1280 ? 3 : 2;
    let auto = 0;
    for (const first of st.blocks.slice(0, SHOTS_TO_TYPE)) {
      const b = await untilSpawned(id, first.id);
      if (await typeAnswer(page, answerFor(b))) auto += 1;
      await sleep(250);
    }
    const hits = await hitCount(id);
    check(
      `${tag}: ${SHOTS_TO_TYPE} answers typed key by key break ${SHOTS_TO_TYPE} blocks`,
      hits === SHOTS_TO_TYPE,
      `${hits} hits, ${auto} fired by themselves`,
    );
    const next = await untilSpawned(id, st.blocks[SHOTS_TO_TYPE].id);
    const half = answerFor(next).slice(
      0,
      Math.max(2, Math.floor(answerFor(next).length / 2)),
    );
    await page.keyboard.type(half, { delay: 30 });
    await sleep(120);
    await page.screenshot({ path: `${SHOTS}/blaster-locked-${tag}.png` });
    await leaveGame(page, width, tag, s.account.userId);
  }
  check(
    `${tag}: no server or page error`,
    s.issues.length === 0,
    s.issues.join(' | '),
  );
  await s.browser.close();
}

async function main() {
  await api();
  await browser(1366, 'copy');
  await browser(1366, 'vi_to_en');
  await browser(390, 'en_to_vi');
  await redis.quit();
  console.log(`\nWORD_BLASTER_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch(async (e) => {
  console.error('ERROR', e);
  await redis.quit().catch(() => undefined);
  process.exit(2);
});
