/**
 * Companion pet bubble on the disposable harness (owner 2026-11-09: "cứ F5 trang
 * là hội thoại của pet lại hiện ra"). The pet speaks when something new happens,
 * each thing once a day:
 *   a hungry pet asks to be fed, with its own name and the real price;
 *   a reload, another page and a second reload do not bring the bubble back;
 *   another day does;
 *   the bubble's "Cho ăn" button feeds the pet and closes the bubble;
 *   a fed pet with nothing new has nothing to say.
 *
 *   HARNESS_DB=<db> [SHOTS=<dir>] npx ts-node --transpile-only scripts/qa/finalization-pet-dialogue.ts
 */
import type { Page } from 'playwright';

import { call, check, failureCount } from './harness-api';
import { FE, studentPage } from './harness-browser';
import { harnessExec, harnessQuery } from './harness-db';

const SHOTS = process.env.SHOTS ?? 'artifacts/finalization/evidence';
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
/** Sets satiety on every species in the learner's roster, as of now. */
const starve = (u: number, satiety: number) =>
  harnessExec(
    `update "UserPet" set roster = (select jsonb_object_agg(k, case when jsonb_typeof(v) = 'object' and v ? 'satiety' then v || jsonb_build_object('satiety', ${satiety}, 'stateUpdatedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) else v end) from jsonb_each(roster::jsonb) as e(k, v)) where "userId" = ${u}`,
  );

const bubble = (page: Page) =>
  page.locator('[role="dialog"][aria-live="polite"]');
const petButton = (page: Page) =>
  page.locator('button[aria-label^="Thú cưng đồng hành"]');
const shownWithin = (page: Page, ms: number) =>
  bubble(page)
    .first()
    .waitFor({ timeout: ms })
    .then(() => true)
    .catch(() => false);
/** Loads a page and waits long enough for the pet's data to arrive. */
async function open(page: Page, path: string) {
  await page.goto(`${FE}${path}`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await sleep(2500);
}

async function main() {
  const { browser, page, account, issues } = await studentPage(
    'pet-dialogue',
    1366,
  );
  const pet = await call('GET', '/gamification/pet', account.token);
  fund(account.userId, 50);
  starve(account.userId, 30);
  const hungry = await call('GET', '/gamification/pet', account.token);
  check(
    'the harness pet is hungry (server satietyState HUNGRY)',
    hungry.data?.satietyState === 'HUNGRY',
    `${pet.status} ${hungry.data?.satietyState} ${hungry.data?.satiety}`,
  );
  const cost = hungry.data?.feedCost as number;

  await open(page, '/dashboard');
  const shown = await shownWithin(page, 15_000);
  const text = shown ? await bubble(page).first().innerText() : '';
  check('a hungry pet speaks on the first visit of the day', shown);
  check(
    'the bubble says it is hungry',
    /Đang đói/.test(text) && /đói/.test(text),
    text.replace(/\s+/g, ' '),
  );
  check('it does not call every pet "Bready"', !/Bready/.test(text));
  check(
    `it offers to feed for the real price (${cost} Bánh Mì)`,
    (await bubble(page)
      .getByRole('button', { name: `Cho ăn (${cost} Bánh Mì)` })
      .count()) === 1,
  );
  await page.screenshot({ path: `${SHOTS}/pet-dialogue-hungry-1366.png` });

  await page.reload({ waitUntil: 'networkidle' });
  await sleep(2500);
  check(
    'F5 does not bring it back (the pet is there, silent)',
    (await petButton(page).count()) === 1 && !(await shownWithin(page, 5000)),
  );
  await open(page, '/listening');
  check(
    'another page (with the pet on it) does not bring it back',
    (await petButton(page).count()) === 1 && !(await shownWithin(page, 5000)),
  );
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(2500);
  check(
    'a second F5 does not either',
    (await petButton(page).count()) === 1 && !(await shownWithin(page, 4000)),
  );

  // Another day: what was said yesterday no longer counts.
  await page.evaluate(() => {
    const raw = window.localStorage.getItem('breadtrans.pet.nudges');
    if (raw) {
      const r = JSON.parse(raw);
      r.dateKey = '2000-01-01';
      window.localStorage.setItem('breadtrans.pet.nudges', JSON.stringify(r));
    }
  });
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(2500);
  check('the next day the pet speaks again', await shownWithin(page, 15_000));

  const before = bread(account.userId);
  await bubble(page)
    .getByRole('button', { name: /^Cho ăn/ })
    .click();
  await sleep(3000);
  check('"Cho ăn" in the bubble closes it', (await bubble(page).count()) === 0);
  check(
    `"Cho ăn" in the bubble feeds the pet (${before} → ${before - cost})`,
    bread(account.userId) === before - cost,
    String(bread(account.userId)),
  );
  await browser.close();

  // A fed pet, nothing done yet, a brand-new learner: nothing to say.
  const fresh = await studentPage('pet-dialogue-fed', 1366);
  await call('GET', '/gamification/pet', fresh.account.token);
  await open(fresh.page, '/dashboard');
  check(
    'a fed pet with nothing new stays quiet',
    (await petButton(fresh.page).count()) === 1 &&
      !(await shownWithin(fresh.page, 6000)),
  );
  await fresh.browser.close();

  const pageIssues = [...issues, ...fresh.issues].filter(
    (i) => !/favicon|hydrat/i.test(i),
  );
  check(
    'no page errors or 5xx',
    pageIssues.length === 0,
    pageIssues.slice(0, 3).join(' | '),
  );
  console.log(`PET_DIALOGUE_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

void main();
