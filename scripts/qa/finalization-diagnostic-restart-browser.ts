/**
 * "Làm lại từ đầu" on the unfinished Entry Diagnostic card, in Chromium on the
 * disposable harness. Starts an attempt over the API, then restarts it from
 * /hub?tab=diagnostic-result and checks the clone: the old attempt is
 * ABANDONED (not deleted), its browser draft is gone, and /diagnostic starts
 * a new attempt. Also checks another learner cannot abandon it.
 */
import { call, check, failureCount, newStudent } from './harness-api';
import { harnessQuery } from './harness-db';
import { FE, hidePet, studentPage } from './harness-browser';

const SHOTS = `${process.env.TEMP ?? '.'}/breadtrans-harness/shots`;

async function main() {
  const { browser, page, account } = await studentPage('diag-restart', 1280);
  const current = await call('GET', '/diagnostic/current', account.token);
  const assessmentId = current.data.id as number;
  const started = await call(
    'POST',
    `/diagnostic/${assessmentId}/attempts/start`,
    account.token,
  );
  const oldId = started.data.attemptId as number;

  const intruder = await newStudent('diag-intruder');
  const foreign = await call(
    'POST',
    `/diagnostic/${assessmentId}/attempts/${oldId}/abandon`,
    intruder.token,
  );
  check(
    'another learner cannot abandon the attempt',
    foreign.status === 404,
    String(foreign.status),
  );

  await page.evaluate(
    (id) =>
      localStorage.setItem(`breadtrans:diagnostic-draft:${id}`, '{"1":0}'),
    oldId,
  );
  await page.goto(`${FE}/hub?tab=diagnostic-result`);
  await hidePet(page);
  const restart = page.getByRole('button', { name: 'Làm lại từ đầu' });
  await restart.waitFor({ timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}/diagnostic-restart-card.png` });
  await restart.click();
  await page.getByRole('alertdialog').waitFor();
  await page.screenshot({ path: `${SHOTS}/diagnostic-restart-confirm.png` });
  await page.getByRole('button', { name: 'Giữ lượt đang làm' }).click();
  check(
    'cancel keeps the attempt IN_PROGRESS',
    harnessQuery(
      `select status from "DiagnosticAttempt" where id = ${oldId}`,
    )[0][0] === 'IN_PROGRESS',
  );
  await restart.click();
  await page.getByRole('button', { name: 'Xác nhận làm lại' }).click();
  await page.waitForURL('**/diagnostic', { timeout: 30_000 });
  check(
    'old attempt is ABANDONED, not deleted',
    harnessQuery(
      `select status from "DiagnosticAttempt" where id = ${oldId}`,
    )[0]?.[0] === 'ABANDONED',
  );
  check(
    'browser draft of the old attempt is removed',
    (await page.evaluate(
      (id) => localStorage.getItem(`breadtrans:diagnostic-draft:${id}`),
      oldId,
    )) === null,
  );
  const again = await call(
    'POST',
    `/diagnostic/${assessmentId}/attempts/start`,
    account.token,
  );
  check(
    'next start creates a new attempt',
    typeof again.data.attemptId === 'number' && again.data.attemptId !== oldId,
    `${oldId} -> ${again.data.attemptId}`,
  );
  const twice = await call(
    'POST',
    `/diagnostic/${assessmentId}/attempts/${oldId}/abandon`,
    account.token,
  );
  check(
    'abandoning twice is refused',
    twice.status === 404,
    String(twice.status),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${FE}/hub?tab=diagnostic-result`);
  await hidePet(page);
  await page
    .getByRole('button', { name: 'Làm lại từ đầu' })
    .waitFor({ timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}/diagnostic-restart-card-390.png` });
  await browser.close();
  console.log(
    `\n${failureCount() ? 'FAILURES: ' + failureCount() : 'ALL PASS'}`,
  );
  process.exit(failureCount() ? 1 : 0);
}

void main();
