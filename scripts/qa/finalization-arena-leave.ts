/**
 * Leaving a Vocabulary Arena match on purpose (owner 2026-11-08): the exit
 * button asks first; "Ở lại" keeps the match going, "Thoát, chịu thua" ends
 * it at once. The leaver is back in the lobby having lost the stake, the
 * rival sees a win "đã rời trận" and gets twice the stake, and the battle is
 * settled for the rival. Runs against the disposable harness only.
 *
 *   HARNESS_DB=<db> [SHOTS=<dir>] [ARENA_WIDTH=390] npx ts-node --transpile-only scripts/qa/finalization-arena-leave.ts
 */
import { check, failureCount } from './harness-api';
import { FE, hidePet, studentPage } from './harness-browser';
import { harnessExec, harnessQuery } from './harness-db';

const SHOTS = process.env.SHOTS ?? 'artifacts/finalization/evidence';
const WIDTH = Number(process.env.ARENA_WIDTH ?? 1366);
const bread = (u: number) =>
  Number(
    harnessQuery(
      `select coalesce(max("totalBanhRan"),0) from "UserStats" where "userId" = ${u}`,
    )[0][0],
  );
const fund = (u: number) =>
  harnessExec(
    `insert into "UserStats" ("userId","totalBanhRan") values (${u}, 100) on conflict ("userId") do update set "totalBanhRan" = 100`,
  );

async function main() {
  const A = await studentPage('arena-leave-a', WIDTH);
  const B = await studentPage('arena-leave-b', WIDTH);
  for (const s of [A, B]) {
    fund(s.account.userId);
    await s.page.goto(`${FE}/arena`, {
      waitUntil: 'networkidle',
      timeout: 120_000,
    });
    await hidePet(s.page);
    await s.page
      .getByRole('button', { name: '20 Bánh Mì', exact: true })
      .click();
  }
  await A.page.getByRole('button', { name: /^Tìm đối thủ/ }).click();
  await A.page.getByText(/Đang tìm đối thủ/).waitFor({ timeout: 15_000 });
  await B.page.getByRole('button', { name: /^Tìm đối thủ/ }).click();

  // Wait for the first question, then open the exit question.
  await A.page.locator('[role="timer"]').first().waitFor({ timeout: 30_000 });
  await A.page.waitForTimeout(1500);
  await A.page.screenshot({ path: `${SHOTS}/arena-stage-${WIDTH}.png` });
  await A.page.getByRole('button', { name: 'Thoát', exact: true }).click();
  const ask = A.page.getByRole('alertdialog', { name: 'Thoát trận đấu?' });
  check('the exit button asks first', await ask.isVisible());
  const askText = (await ask.innerText()).replace(/\s+/g, ' ');
  check(
    'the question says the loss: 20 Bánh Mì and the rival wins',
    /mất 20 Bánh Mì/.test(askText) && /thắng trận này/.test(askText),
    askText,
  );
  await A.page.screenshot({ path: `${SHOTS}/arena-leave-ask-${WIDTH}.png` });

  await A.page.getByRole('button', { name: 'Ở lại đấu tiếp' }).click();
  check(
    '"Ở lại" closes the question and the match goes on',
    (await ask.count()) === 0 &&
      (await A.page.locator('[role="timer"]').count()) > 0,
  );

  await A.page.getByRole('button', { name: 'Thoát', exact: true }).click();
  await A.page.getByRole('button', { name: 'Thoát, chịu thua' }).click();
  const backInLobby = await A.page
    .getByRole('button', { name: /^Tìm đối thủ/ })
    .waitFor({ timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  const toastSeen = await A.page
    .getByText(/Bạn đã rời trận và mất 20 Bánh Mì/)
    .isVisible()
    .catch(() => false);
  check(
    'the leaver is back in the lobby, told of the lost stake',
    backInLobby && toastSeen,
  );
  await A.page.screenshot({ path: `${SHOTS}/arena-leave-lobby-${WIDTH}.png` });

  const winDialog = await B.page
    .getByRole('heading', { name: 'Bạn thắng!' })
    .waitFor({ timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  await B.page.waitForTimeout(1500);
  const bodyB = (await B.page.locator('body').innerText()).replace(/\s+/g, ' ');
  check(
    'the rival wins at once and is told the other player left',
    winDialog && /đã rời trận/.test(bodyB) && /\+20/.test(bodyB),
    bodyB.slice(0, 160),
  );
  await B.page.screenshot({ path: `${SHOTS}/arena-leave-winner-${WIDTH}.png` });

  await new Promise((ok) => setTimeout(ok, 1000));
  check(
    'balances: leaver 80, rival 120',
    bread(A.account.userId) === 80 && bread(B.account.userId) === 120,
    `${bread(A.account.userId)}/${bread(B.account.userId)}`,
  );
  const battle = harnessQuery(
    `select status, "winnerUserId" from "GameBattle" where "p1Id" in (${A.account.userId}, ${B.account.userId}) order by id desc limit 1`,
  )[0];
  check(
    'the battle is settled for the rival',
    battle?.[0] === 'settled' && Number(battle[1]) === B.account.userId,
    JSON.stringify(battle),
  );

  for (const s of [A, B]) {
    check(
      `${s === A ? 'A' : 'B'}: no server or page error`,
      s.issues.length === 0,
      s.issues.join(' | '),
    );
    await s.browser.close();
  }
  console.log(`\nARENA_LEAVE_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR', e);
  process.exit(2);
});
