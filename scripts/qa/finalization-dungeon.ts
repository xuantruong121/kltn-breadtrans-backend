/**
 * Hầm Bánh Mì on the disposable harness (owner 2026-11-09). The answers are
 * read from the harness Redis, as a perfect player would know them.
 *   API: the ticket is taken once; no answer leaves the server; right answers
 *        hit, a wrong one costs health, a timeout too; an offered topping is
 *        taken, another refused; a floor 5 boss falls to typed words and pays
 *        the ticket back plus 10; the day's dungeon is once a day and ranked;
 *        another learner cannot answer; a run left alone is settled.
 *   Browser: the Arena lists Hầm Bánh Mì and opens its lobby; a free run is
 *        played with the keyboard through a topping choice and a boss, then
 *        left; frames are counted; a phone plays the day's dungeon and leaves.
 *
 *   HARNESS_DB=<db> [SHOTS=<dir>] npx ts-node --transpile-only scripts/qa/finalization-dungeon.ts
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
    `select source, amount from "BanhTransaction" where "userId" = ${u} and source like 'DUNGEON_%' order by id`,
  ).map((r) => `${r[0]}:${r[1]}`);
const learnerEvents = (u: number) =>
  harnessQuery(
    `select type, value from "LearnerEvent" where "userId" = ${u} and type like 'DUNGEON_%' order by id`,
  ).map((r) => `${r[0]}:${r[1]}`);

type Stored = {
  run: {
    phase: string;
    floor: number;
    monster: { hp: number; boss: boolean };
    offers: string[];
  };
  question: {
    q:
      | { type: 'choice'; correct: number; options: string[] }
      | { type: 'typed'; answers: string[] };
    issuedAt: number;
  } | null;
};
const stored = async (id: string) =>
  JSON.parse((await redis.get(`dungeon:run:${id}`))!) as Stored;
const rightBody = async (id: string) => {
  const q = (await stored(id)).question!.q;
  return q.type === 'choice' ? { choice: q.correct } : { text: q.answers[0] };
};
const wrongBody = async (id: string) => {
  const q = (await stored(id)).question!.q;
  return q.type === 'choice'
    ? { choice: (q.correct + 1) % q.options.length }
    : { text: 'zzzz' };
};

/** Plays right answers (picking the first topping) until `floor` is reached in a fight. */
async function playTo(token: string, id: string, floor: number) {
  for (let i = 0; i < 200; i += 1) {
    const s = await stored(id);
    if (s.run.floor >= floor && s.run.phase === 'fight') return;
    if (s.run.phase === 'pick')
      await call('POST', `/games/dungeon/${id}/pick`, token, {
        topping: s.run.offers[0],
      });
    else
      await call(
        'POST',
        `/games/dungeon/${id}/answer`,
        token,
        await rightBody(id),
      );
  }
}

async function api() {
  const a = await newStudent('dungeon-run');
  fund(a.userId, 200);
  const start = await call('POST', '/games/dungeon/start', a.token, {
    mode: 'free',
  });
  const id = start.data?.sessionId as string;
  check(
    'a free run opens: floor 1, a multiple-choice question, ticket taken (200 → 180)',
    start.status === 200 &&
      start.data.floor === 1 &&
      start.data.question?.type === 'choice' &&
      bread(a.userId) === 180,
    `${start.status} ${bread(a.userId)}`,
  );
  check(
    'the question carries no answer',
    !/"correct"|answers|display/.test(JSON.stringify(start.data.question)),
  );
  check(
    'its clock starts after the intro',
    start.data.questionStartsAt - start.data.serverNow >= 2000,
    String(start.data.questionStartsAt - start.data.serverNow),
  );
  const again = await call('POST', '/games/dungeon/start', a.token, {
    mode: 'daily',
  });
  check(
    'a second start returns the open run, no second ticket',
    again.data?.sessionId === id && bread(a.userId) === 180,
  );
  const other = await newStudent('dungeon-other');
  check(
    'another learner cannot answer in this run',
    (
      await call('POST', `/games/dungeon/${id}/answer`, other.token, {
        choice: 0,
      })
    ).status === 403,
  );

  const hit = await call(
    'POST',
    `/games/dungeon/${id}/answer`,
    a.token,
    await rightBody(id),
  );
  check(
    'a right answer hits the monster',
    hit.data.last?.right === true &&
      hit.data.monster.hp < start.data.monster.hp,
    JSON.stringify(hit.data.last),
  );
  const miss = await call(
    'POST',
    `/games/dungeon/${id}/answer`,
    a.token,
    await wrongBody(id),
  );
  check(
    'a wrong answer costs health and shows the right answer',
    miss.data.last?.right === false &&
      miss.data.hp < 100 &&
      Boolean(miss.data.last?.answer),
    JSON.stringify(miss.data.last),
  );
  const timeout = await call(
    'POST',
    `/games/dungeon/${id}/answer`,
    a.token,
    {},
  );
  check(
    'an empty answer is a timeout',
    timeout.data.last?.timedOut === true,
    JSON.stringify(timeout.data.last),
  );

  await playTo(a.token, id, 2);
  const s2 = await stored(id);
  check(
    'right answers clear floor 1',
    s2.run.floor === 2,
    String(s2.run.floor),
  );

  // A refused topping: answer until the next pick, then ask for one not offered.
  for (let i = 0; i < 20 && (await stored(id)).run.phase === 'fight'; i += 1)
    await call(
      'POST',
      `/games/dungeon/${id}/answer`,
      a.token,
      await rightBody(id),
    );
  const offers = (await stored(id)).run.offers;
  const notOffered = [
    'garlic_butter',
    'egg',
    'cucumber',
    'pate',
    'sesame',
  ].find((t) => !offers.includes(t));
  check(
    'a topping not on offer is refused',
    (
      await call('POST', `/games/dungeon/${id}/pick`, a.token, {
        topping: notOffered,
      })
    ).status === 400,
  );

  await playTo(a.token, id, 5);
  const boss = await stored(id);
  check(
    'floor 5 is a boss with a typed question',
    boss.run.monster.boss && boss.question?.q.type === 'typed',
  );
  await playTo(a.token, id, 6);
  check('the boss falls to typed words', (await stored(id)).run.floor === 6);
  const left = await call('POST', `/games/dungeon/${id}/finish`, a.token, {
    forfeit: true,
  });
  check(
    'leaving after the boss: ticket back and 10 (180 → 210)',
    left.data?.result?.bossesDown === 1 && bread(a.userId) === 210,
    `${JSON.stringify(left.data?.result)?.slice(0, 120)} ${bread(a.userId)}`,
  );
  check(
    'ledger: one ticket, one return, one boss reward',
    JSON.stringify(ledger(a.userId)) ===
      JSON.stringify([
        'DUNGEON_STAKE:-20',
        'DUNGEON_RETURN:20',
        'DUNGEON_WIN:10',
      ]),
    JSON.stringify(ledger(a.userId)),
  );
  check(
    'the run is recorded: DUNGEON_FREE floor 6',
    JSON.stringify(learnerEvents(a.userId)) ===
      JSON.stringify(['DUNGEON_FREE:6']),
    JSON.stringify(learnerEvents(a.userId)),
  );
  await call('POST', `/games/dungeon/${id}/finish`, a.token, { forfeit: true });
  check('finishing again pays nothing more', bread(a.userId) === 210);

  // The day's dungeon: once a day, on the board.
  const d = await newStudent('dungeon-daily');
  fund(d.userId, 100);
  const daily = await call('POST', '/games/dungeon/start', d.token, {
    mode: 'daily',
  });
  const other2 = await newStudent('dungeon-daily2');
  fund(other2.userId, 100);
  const daily2 = await call('POST', '/games/dungeon/start', other2.token, {
    mode: 'daily',
  });
  check(
    'the day dungeon asks everyone the same first question',
    JSON.stringify(daily.data.question) ===
      JSON.stringify(daily2.data.question),
  );
  await call('POST', `/games/dungeon/${daily.data.sessionId}/finish`, d.token, {
    forfeit: true,
  });
  const twice = await call('POST', '/games/dungeon/start', d.token, {
    mode: 'daily',
  });
  check(
    'the day dungeon is once a day; the second try costs nothing',
    twice.status === 400 && bread(d.userId) === 80,
    `${twice.status} ${bread(d.userId)}`,
  );
  const board = await call('GET', '/games/dungeon/board', d.token);
  check(
    "today's board lists the run and the learner's place",
    board.data?.me?.playedToday === true &&
      board.data.me.dailyFloor === 1 &&
      board.data.entries.some((e: { userId: number }) => e.userId === d.userId),
    JSON.stringify(board.data?.me),
  );

  // A run left alone.
  const sid = daily2.data.sessionId as string;
  await redis.zadd('dungeon:open', Date.now() - 1000, sid);
  let settled = false;
  for (let i = 0; i < 40 && !settled; i += 1) {
    await sleep(1000);
    settled = Boolean(
      (await stored(sid)) &&
      JSON.parse((await redis.get(`dungeon:run:${sid}`))!).result,
    );
  }
  check('a run left alone is settled by the sweep', settled);
  check(
    'a short balance is refused',
    (
      await call(
        'POST',
        '/games/dungeon/start',
        (
          await (async () => {
            const p = await newStudent('dungeon-poor');
            fund(p.userId, 5);
            return p;
          })()
        ).token,
        { mode: 'free' },
      )
    ).status === 400,
  );
}

const fps = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((ok) => {
        let n = 0;
        const t0 = performance.now();
        const f = () => {
          n += 1;
          if (performance.now() - t0 < 2000) requestAnimationFrame(f);
          else ok(Math.round((n * 1000) / (performance.now() - t0)));
        };
        requestAnimationFrame(f);
      }),
  );

/** Answers the question on screen the way a learner would: a key, or typing and Enter. */
async function answerOnScreen(page: Page, id: string, right: boolean) {
  const s = await stored(id);
  if (!s.question) return;
  const q = s.question.q;
  // Wait until the panel takes input (the last outcome or the intro is showing).
  // The panel takes input once the question's clock starts (after the last
  // outcome or the floor intro has shown); wait for that, plus a moment.
  const startsIn = s.question.issuedAt + 250 - Date.now();
  if (startsIn > 0) await sleep(startsIn);
  if (q.type === 'choice') {
    const index = right ? q.correct : (q.correct + 1) % q.options.length;
    await page.keyboard.press(String(index + 1));
  } else {
    const input = page.getByRole('textbox', { name: /Gõ từ tiếng Anh/ });
    await input.fill('');
    await input.type(right ? q.answers[0] : 'zzzz', { delay: 30 });
    await input.press('Enter');
  }
  await sleep(500);
}

async function browser(width: number) {
  const mode = width >= 1000 ? 'free' : 'daily';
  const tag = `${mode}-${width}`;
  const s = await studentPage(`dungeon-ui-${tag}`, width);
  fund(s.account.userId, 200);
  const page = s.page;
  await page.goto(`${FE}/arena`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  const nav = page.getByRole('navigation', {
    name: 'Trò chơi trong Đấu trường',
  });
  await nav
    .getByRole('button', { name: /Hầm Bánh Mì/ })
    .waitFor({ timeout: 30_000 });
  check(
    `${tag}: the Arena lists Hầm Bánh Mì`,
    (await nav.getByRole('button', { name: /Hầm Bánh Mì/ }).count()) === 1,
  );
  await nav.getByRole('button', { name: /Hầm Bánh Mì/ }).click();
  const lobby = await page
    .getByRole('heading', { name: 'Hầm Bánh Mì', level: 1 })
    .waitFor({ timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  check(
    `${tag}: picking it opens its lobby (?game=dungeon)`,
    lobby && page.url().includes('game=dungeon'),
    page.url(),
  );
  await sleep(800);
  await page.screenshot({
    path: `${SHOTS}/dungeon-lobby-${tag}.png`,
    fullPage: true,
  });
  // A dev server compiles the play page on its first visit, which can outlast
  // the opening (countdown, floor map); compile it before the run starts.
  await page.request
    .get(`${FE}/arena/dungeon`, { timeout: 120_000 })
    .catch(() => undefined);
  await page
    .getByRole('button', {
      name: mode === 'free' ? 'Vào Hầm tự do' : 'Vào Hầm hôm nay',
    })
    .click();
  // Owner 2026-11-09: the first time in, the story opens before the run.
  const story = page.getByRole('dialog', { name: 'Cốt truyện Hầm Bánh Mì' });
  const storyShown = await story
    .waitFor({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  check(`${tag}: the first entry opens the story`, storyShown);
  if (storyShown) {
    await sleep(800);
    await page.screenshot({ path: `${SHOTS}/dungeon-story-1-${tag}.png` });
    await page.keyboard.press('Enter');
    await sleep(700);
    await page.screenshot({ path: `${SHOTS}/dungeon-story-2-${tag}.png` });
    await story.getByRole('button', { name: 'Bỏ qua' }).click();
  }
  await page.waitForURL(/\/arena\/dungeon/, { timeout: 30_000 });
  // The floor opens on the chapter map (chapter 1, Lò Ủ Bột), then the monster greets.
  const intro = await page
    .locator('[data-dungeon-callout]')
    .getByText('Lò Ủ Bột')
    .waitFor({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  check(`${tag}: the run opens on "Tầng 1"`, intro);
  const mapSeenAt = Date.now();
  await page.screenshot({ path: `${SHOTS}/dungeon-intro-${tag}.png` });
  // Owner 2026-11-09: the map went by before it could be read (about 0.9 s).
  await page
    .locator('[data-dungeon-callout]')
    .getByText('Lò Ủ Bột')
    .waitFor({ state: 'hidden', timeout: 10_000 })
    .catch(() => undefined);
  const mapMs = Date.now() - mapSeenAt;
  check(
    `${tag}: the opening map stays at least 1.8 s`,
    intro && mapMs >= 1800,
    `${mapMs} ms`,
  );
  // The monsters are Kenney's sprites now; none of them fails to load.
  const sprites = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLImageElement>(
        'img[src*="/images/dungeon/kenney/"]',
      ),
    ].map((img) => img.complete && img.naturalWidth > 0),
  );
  check(
    `${tag}: the monster is drawn from the Kenney sprites, all loaded`,
    sprites.length > 0 && sprites.every(Boolean),
    `${sprites.filter(Boolean).length}/${sprites.length}`,
  );
  check(
    `${tag}: the game hides the site header`,
    (await page.locator('header nav').count()) === 0 ||
      !(await page.locator('header nav').first().isVisible()),
  );
  const id = await redis.get(`dungeon:user:${s.account.userId}`);
  if (!id) throw new Error('no open run');

  await answerOnScreen(page, id, true);
  await page.screenshot({ path: `${SHOTS}/dungeon-hit-${tag}.png` });
  const afterHit = await stored(id);
  check(
    `${tag}: a key press answers and hits`,
    afterHit.run.monster.hp < 60 || afterHit.run.floor > 1,
    JSON.stringify(afterHit.run.monster),
  );
  await answerOnScreen(page, id, false);
  await sleep(150);
  await page.screenshot({ path: `${SHOTS}/dungeon-miss-${tag}.png` });

  if (width >= 1000) {
    check(
      `${tag}: at least 50 frames a second in the cellar`,
      (await fps(page)) >= 50,
      `${await fps(page)} fps`,
    );
    // Through floor 1 to the topping choice.
    for (let i = 0; i < 12 && (await stored(id)).run.phase === 'fight'; i += 1)
      await answerOnScreen(page, id, true);
    await sleep(1200);
    const toppings = page.getByRole('heading', { name: /Chọn một topping/ });
    const choosing = await toppings
      .waitFor({ timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    check(`${tag}: a floor cleared deals three toppings`, choosing);
    check(
      `${tag}: the floor map stays over the toppings, floor 2 next`,
      (await page.getByText('Tiếp theo · Chương 1').count()) === 1 &&
        (await page.getByText('Tầng 2', { exact: true }).count()) >= 1,
    );
    await page.screenshot({ path: `${SHOTS}/dungeon-toppings-${tag}.png` });
    const firstOffer = (await stored(id)).run.offers[0];
    await page
      .getByRole('button', { name: new RegExp(`(Thường|Hiếm|Quý)`) })
      .first()
      .click();
    // Owner 2026-11-09: the map showed twice, over the toppings and again as
    // the floor opened. After a topping only the monster comes in.
    const secondMap = await page
      .locator('[data-dungeon-callout]')
      .getByText('Lò Ủ Bột')
      .waitFor({ timeout: 1800 })
      .then(() => true)
      .catch(() => false);
    check(
      `${tag}: after the topping the map does not show a second time`,
      !secondMap,
    );
    const picked = await stored(id);
    check(
      `${tag}: picking a topping goes down to floor 2`,
      picked.run.floor === 2,
      `${firstOffer} → floor ${picked.run.floor}`,
    );
    // Down to the boss with the API's help, then the boss on screen.
    await playTo(s.account.token, id, 5);
    await page.reload({ waitUntil: 'networkidle' });
    await sleep(2800);
    const bossBox = await page
      .getByRole('textbox', { name: /Gõ từ tiếng Anh/ })
      .waitFor({ timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    check(
      `${tag}: a reload comes back to the run; the floor 5 boss asks for a typed word`,
      bossBox,
    );
    check(
      `${tag}: the boss wears its crown`,
      (await page.locator('[data-boss-crown]').count()) === 1,
    );
    await page.screenshot({ path: `${SHOTS}/dungeon-boss-${tag}.png` });
    for (
      let i = 0;
      i < 8 &&
      (await stored(id)).run.phase === 'fight' &&
      (await stored(id)).run.floor === 5;
      i += 1
    )
      await answerOnScreen(page, id, true);
    await sleep(800);
    check(
      `${tag}: typed words bring the boss down`,
      (await stored(id)).run.phase === 'pick' &&
        (await stored(id)).run.floor === 5,
    );
    await page.screenshot({ path: `${SHOTS}/dungeon-boss-down-${tag}.png` });
  }

  await page.getByRole('button', { name: 'Rời hầm', exact: true }).click();
  const ask = page.getByRole('alertdialog', { name: 'Rời hầm?' });
  check(
    `${tag}: leaving asks first`,
    await ask
      .waitFor({ timeout: 5000 })
      .then(() => true)
      .catch(() => false),
  );
  await page.getByRole('button', { name: 'Thoát, chịu thua' }).click();
  const shown = await page
    .getByRole('dialog')
    .getByText(/Đã rời hầm ở tầng/)
    .waitFor({ timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  await sleep(1200);
  await page.screenshot({ path: `${SHOTS}/dungeon-result-${tag}.png` });
  const expected = width >= 1000 ? 210 : 180;
  check(
    `${tag}: the result shows, and the balance is right (${expected})`,
    shown && bread(s.account.userId) === expected,
    String(bread(s.account.userId)),
  );
  if (width >= 1000) {
    // A second run starts straight away: the story was seen.
    await page.goto(`${FE}/arena?game=dungeon`, {
      waitUntil: 'networkidle',
      timeout: 120_000,
    });
    await page.getByRole('button', { name: 'Vào Hầm tự do' }).click();
    const again = await story
      .waitFor({ timeout: 1500 })
      .then(() => true)
      .catch(() => false);
    await page.waitForURL(/\/arena\/dungeon/, { timeout: 30_000 });
    check(`${tag}: the story does not come back by itself`, !again);
    const run2 = await redis.get(`dungeon:user:${s.account.userId}`);
    if (run2)
      await call('POST', `/games/dungeon/${run2}/finish`, s.account.token, {
        forfeit: true,
      });
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
  await browser(1366);
  await browser(390);
  await redis.quit();
  console.log(`\nDUNGEON_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch(async (e) => {
  console.error('ERROR', e);
  await redis.quit().catch(() => undefined);
  process.exit(2);
});
