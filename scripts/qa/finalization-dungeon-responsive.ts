/**
 * Hầm Bánh Mì on every screen size (owner 2026-11-10: "đã cấu hình responsive
 * đầy đủ cả chưa?"). For each viewport a run is played through its states
 * (a question, the topping list, the topping cards, a chip's card, a boss's
 * typed word, the result) and measured in the browser:
 *   - no sideways scroll;
 *   - the controls the learner needs are on screen (or reachable by scrolling);
 *   - the topping card, the list and the HUD never cover the answers;
 *   - the topping list does not cover the HUD.
 * Screenshots of every state go to SHOTS.
 *
 *   HARNESS_DB=<db> [SHOTS=<dir>] [ONLY=390x844,...] npx ts-node --transpile-only scripts/qa/finalization-dungeon-responsive.ts
 */
import Redis from 'ioredis';
import type { Locator, Page } from 'playwright';

import { call, check, failureCount } from './harness-api';
import { FE, studentPage } from './harness-browser';
import { harnessExec } from './harness-db';

const SHOTS = process.env.SHOTS ?? 'artifacts/finalization/evidence';
const redis = new Redis({ host: '127.0.0.1', port: 6392 });
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** Phones (small to large), tablets, a phone on its side, laptops. */
const VIEWPORTS: [number, number][] = [
  [320, 568],
  [360, 740],
  [375, 667],
  [390, 844],
  [412, 915],
  [430, 932],
  [768, 1024],
  [1024, 768],
  [844, 390],
  [1280, 800],
  [1366, 900],
];

type Box = { x: number; y: number; width: number; height: number };
type Stored = {
  run: { phase: string; floor: number; offers: string[] };
  question: {
    q:
      | { type: 'choice'; correct: number }
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

/** Right answers through the API (first topping picked) until `stop` says so. */
async function playUntil(
  token: string,
  id: string,
  stop: (s: Stored) => boolean,
) {
  for (let i = 0; i < 200; i += 1) {
    const s = await stored(id);
    if (stop(s)) return;
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

const overlaps = (a: Box | null, b: Box | null) =>
  !!a &&
  !!b &&
  a.x < b.x + b.width - 1 &&
  b.x < a.x + a.width - 1 &&
  a.y < b.y + b.height - 1 &&
  b.y < a.y + a.height - 1;

function inView(page: Page, box: Box | null) {
  const vp = page.viewportSize()!;
  return (
    !!box &&
    box.x >= -1 &&
    box.y >= -1 &&
    box.x + box.width <= vp.width + 1 &&
    box.y + box.height <= vp.height + 1
  );
}

/**
 * Whether the learner can get `el` wholly on screen: it already is, or an
 * ancestor they can scroll (overflow auto/scroll, or the page) holds it.
 * A script can scroll an overflow-hidden box; a thumb cannot, so that does
 * not count (the first version of this check let it count, and passed cards
 * a phone could not reach).
 */
async function reachable(page: Page, el: Locator) {
  if (inView(page, await el.boundingBox())) return true;
  const scrollable = await el.evaluate((node) => {
    for (let p = node.parentElement; p; p = p.parentElement) {
      const o = getComputedStyle(p).overflowY;
      if (
        (o === 'auto' || o === 'scroll') &&
        p.scrollHeight > p.clientHeight + 1
      )
        return true;
    }
    return (
      getComputedStyle(document.body).overflowY !== 'hidden' &&
      document.documentElement.scrollHeight > window.innerHeight + 1
    );
  });
  if (!scrollable) return false;
  await el.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => undefined);
  return inView(page, await el.boundingBox());
}

async function noSidewaysScroll(page: Page) {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth <= window.innerWidth + 1 &&
      document.body.scrollWidth <= window.innerWidth + 1,
  );
}

/** Elements wider than the screen, for the report when sideways scroll shows. */
async function widest(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 4)
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} r=${Math.round(el.getBoundingClientRect().right)}`,
      )
      .join(' | '),
  );
}

async function waitClock(id: string) {
  const q = (await stored(id)).question;
  if (q && q.issuedAt + 300 > Date.now())
    await sleep(q.issuedAt + 300 - Date.now());
}

async function viewport(w: number, h: number) {
  const tag = `${w}x${h}`;
  const s = await studentPage(`dungeon-rwd-${tag}`, w);
  const { page, account } = s;
  await page.setViewportSize({ width: w, height: h });
  harnessExec(
    `insert into "UserStats" ("userId","totalBanhRan") values (${account.userId}, 200) on conflict ("userId") do update set "totalBanhRan" = 200`,
  );
  const start = await call('POST', '/games/dungeon/start', account.token, {
    mode: 'free',
  });
  const id = start.data?.sessionId as string;
  await page.goto(`${FE}/arena/dungeon`, { waitUntil: 'networkidle' });

  // 1. A question.
  const timer = page.locator('[role=timer]').first();
  await timer.waitFor({ timeout: 30_000 });
  await waitClock(id);
  await sleep(400);
  const panel = timer.locator('xpath=..');
  const answers = await panel.boundingBox();
  const hudBar = page
    .locator('button', { hasText: 'Rời hầm' })
    .locator('xpath=../..');
  const hud = await hudBar.boundingBox();
  const options = page.locator('[role=timer] ~ * button');
  const optionBoxes = await Promise.all(
    (await options.all()).map((o) => o.boundingBox()),
  );
  const sideways = await noSidewaysScroll(page);
  check(
    `${tag}: question: no sideways scroll`,
    sideways,
    sideways ? '' : await widest(page),
  );
  const optionsOk =
    optionBoxes.length === 4 && optionBoxes.every((b) => inView(page, b));
  check(
    `${tag}: question: the panel and its 4 answers are on screen`,
    inView(page, answers) && optionsOk,
    JSON.stringify({ answers, n: optionBoxes.length }),
  );
  check(
    `${tag}: question: answers are at least 44 px tall`,
    optionBoxes.every((b) => !!b && b.height >= 44),
    optionBoxes.map((b) => Math.round(b?.height ?? 0)).join(','),
  );
  check(
    `${tag}: question: the HUD is on screen and clear of the answers`,
    inView(page, hud) && !overlaps(hud, answers),
    JSON.stringify(hud),
  );
  const plate = await page
    .getByRole('progressbar', { name: /^Máu của (?!bạn)/ })
    .boundingBox();
  check(
    `${tag}: question: the monster's health bar shows, clear of HUD and answers`,
    !!plate &&
      !overlaps(plate, hud) &&
      !overlaps(plate, answers) &&
      inView(page, plate),
    JSON.stringify(plate),
  );
  // The monster's greeting is up for 1.8 s after the clock starts.
  const bubble = page.locator('p[role=status]').first();
  const bubbleBox = (await bubble.isVisible().catch(() => false))
    ? await bubble.boundingBox()
    : null;
  check(
    `${tag}: question: the monster's words stay on screen and off the answers`,
    !!bubbleBox && inView(page, bubbleBox) && !overlaps(bubbleBox, answers),
    JSON.stringify(bubbleBox),
  );
  await page.screenshot({ path: `${SHOTS}/rwd-question-${tag}.png` });

  // 2. The topping list (empty).
  await page.getByRole('button', { name: /^Topping đang có \(/ }).click();
  const list = page.getByRole('dialog', { name: 'Topping đang có' });
  await list.waitFor({ timeout: 3000 });
  const listBox = await list.boundingBox();
  check(
    `${tag}: list: on screen, clear of the answers and the HUD`,
    inView(page, listBox) &&
      !overlaps(listBox, answers) &&
      !overlaps(listBox, hud),
    JSON.stringify({ listBox, hud, answers }),
  );
  await page.keyboard.press('Escape');

  // 3. The topping cards.
  await playUntil(account.token, id, (st) => st.run.phase === 'pick');
  await page.reload({ waitUntil: 'networkidle' });
  const heading = page.getByRole('heading', { name: /Chọn một topping/ });
  await heading.waitFor({ timeout: 20_000 });
  await sleep(1500);
  check(
    `${tag}: toppings: no sideways scroll`,
    await noSidewaysScroll(page),
    await widest(page),
  );
  await page.screenshot({ path: `${SHOTS}/rwd-toppings-${tag}.png` });
  const cards = page.getByRole('button', { name: /(Thường|Hiếm|Quý)/ });
  const reach: boolean[] = [];
  for (const card of await cards.all()) reach.push(await reachable(page, card));
  check(
    `${tag}: toppings: all 3 cards can be reached (on screen or by scrolling)`,
    reach.length === 3 && reach.every(Boolean),
    reach.join(','),
  );
  await page.screenshot({ path: `${SHOTS}/rwd-toppings-end-${tag}.png` });
  await cards
    .first()
    .scrollIntoViewIfNeeded()
    .catch(() => undefined);
  await cards
    .first()
    .click({ timeout: 5000 })
    .catch(() => undefined);

  // 4. A chip's card and the list with a topping.
  const timer2 = page.locator('[role=timer]').first();
  await timer2.waitFor({ timeout: 20_000 });
  await waitClock(id);
  await sleep(400);
  const answers2 = await timer2.locator('xpath=..').boundingBox();
  const hud2 = await hudBar.boundingBox();
  await page
    .getByRole('list', { name: 'Topping đang có' })
    .getByRole('button')
    .first()
    .click();
  const card = page.locator('#dungeon-topping-card');
  await card.waitFor({ timeout: 3000 }).catch(() => undefined);
  const cardBox = await card.boundingBox();
  check(
    `${tag}: chip: its card is on screen and clear of the answers`,
    inView(page, cardBox) && !overlaps(cardBox, answers2),
    JSON.stringify({ cardBox, answers2 }),
  );
  await page.screenshot({ path: `${SHOTS}/rwd-chip-${tag}.png` });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Topping đang có \(/ }).click();
  await list.waitFor({ timeout: 3000 });
  const list2 = await list.boundingBox();
  check(
    `${tag}: list with a topping: on screen, clear of the answers and the HUD`,
    inView(page, list2) && !overlaps(list2, answers2) && !overlaps(list2, hud2),
    JSON.stringify({ list2, hud2, answers2 }),
  );
  await page.screenshot({ path: `${SHOTS}/rwd-list-${tag}.png` });
  await page.keyboard.press('Escape');

  // 5. The floor 5 boss: a typed word.
  await playUntil(
    account.token,
    id,
    (st) => st.run.floor >= 5 && st.run.phase === 'fight',
  );
  await page.reload({ waitUntil: 'networkidle' });
  const box = page.getByRole('textbox', { name: /Gõ từ tiếng Anh/ });
  await box.waitFor({ timeout: 20_000 });
  await waitClock(id);
  await sleep(500);
  const bossPanel = await page
    .locator('[role=timer]')
    .first()
    .locator('xpath=..')
    .boundingBox();
  check(
    `${tag}: boss: no sideways scroll`,
    await noSidewaysScroll(page),
    await widest(page),
  );
  check(
    `${tag}: boss: the typing panel and its box are on screen`,
    inView(page, bossPanel) && (await reachable(page, box)),
    JSON.stringify(bossPanel),
  );
  await page.screenshot({ path: `${SHOTS}/rwd-boss-${tag}.png` });

  // 6. Leave: the result.
  await page.getByRole('button', { name: 'Rời hầm', exact: true }).click();
  await page.getByRole('button', { name: 'Thoát, chịu thua' }).click();
  const result = page
    .getByRole('dialog')
    .filter({ hasText: /Đã rời hầm ở tầng/ });
  await result.waitFor({ timeout: 15_000 });
  await sleep(1200);
  const buttons = await result.getByRole('button').all();
  const reachB: boolean[] = [];
  for (const b of buttons) reachB.push(await reachable(page, b));
  check(
    `${tag}: result: no sideways scroll`,
    await noSidewaysScroll(page),
    await widest(page),
  );
  check(
    `${tag}: result: every button can be reached`,
    reachB.length > 0 && reachB.every(Boolean),
    reachB.join(','),
  );
  await page.screenshot({ path: `${SHOTS}/rwd-result-${tag}.png` });
  check(
    `${tag}: no page error`,
    s.issues.length === 0,
    s.issues.slice(0, 3).join(' | '),
  );
  await s.browser.close();
}

async function main() {
  const only = process.env.ONLY?.split(',');
  for (const [w, h] of VIEWPORTS) {
    if (only && !only.includes(`${w}x${h}`)) continue;
    try {
      await viewport(w, h);
    } catch (e) {
      check(`${w}x${h}: flow ran to the end`, false, String(e).slice(0, 300));
    }
  }
  await redis.quit();
  console.log(`\nFAILURES ${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}
void main();
