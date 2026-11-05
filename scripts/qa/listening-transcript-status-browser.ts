/**
 * Opening a listening lesson must not make the backend log a 403 for the
 * transcript: the player asks /transcript/status first and loads the
 * transcript only once it was revealed. Disposable harness only.
 *
 * - Dialogue lesson, fresh learner: status 200 (revealed: false), no call to
 *   /transcript, so no 403.
 * - "Bỏ qua" on a dialogue question records the reveal and loads the
 *   transcript: still no 403.
 * - A dictation lesson opened by a fresh learner: same, no 403.
 *
 * Usage: HARNESS_DB=<db> QA_DIALOGUE_ID=<id> QA_DICTATION_ID=<id> \
 *   npx ts-node --transpile-only scripts/qa/listening-transcript-status-browser.ts
 */
import { mkdirSync } from 'node:fs';

import { check, failureCount } from './harness-api';
import { FE, hidePet, studentPage } from './harness-browser';

const SHOTS = `${process.env.TEMP ?? '.'}/breadtrans-harness/shots/transcript-status`;
const DIALOGUE = Number(process.env.QA_DIALOGUE_ID ?? 26);
const DICTATION = Number(process.env.QA_DICTATION_ID ?? 23);

async function open(quizId: number, label: string) {
  const { browser, page, issues } = await studentPage(label);
  const seen: Array<{ path: string; status: number }> = [];
  page.on('response', (r) => {
    const url = new URL(r.url());
    if (url.port === '3101' && url.pathname.includes('/transcript'))
      seen.push({ path: url.pathname, status: r.status() });
  });
  await page.goto(`${FE}/listening/${quizId}`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await hidePet(page);
  await page.waitForTimeout(2500);
  return { browser, page, issues, seen };
}

const show = (seen: Array<{ path: string; status: number }>) =>
  seen.map((s) => `${s.status} ${s.path}`).join(', ') || 'none';

async function main() {
  mkdirSync(SHOTS, { recursive: true });

  const dialogue = await open(DIALOGUE, 'transcript-dialogue');
  const statusCall = dialogue.seen.find((s) =>
    s.path.endsWith('/transcript/status'),
  );
  check(
    'dialogue lesson on load: status answered 200',
    statusCall?.status === 200,
    show(dialogue.seen),
  );
  check(
    'dialogue lesson on load: no 403 and no transcript call',
    !dialogue.seen.some(
      (s) => s.status === 403 || s.path.endsWith('/transcript'),
    ),
    show(dialogue.seen),
  );
  const skip = dialogue.page.getByRole('button', { name: /^Bỏ qua$/ });
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
    await dialogue.page.waitForTimeout(3000);
    check(
      '"Bỏ qua" reveals, then loads the transcript without a 403',
      dialogue.seen.some(
        (s) => s.path.endsWith('/transcript/reveal') && s.status === 200,
      ) &&
        dialogue.seen.some(
          (s) => s.path.endsWith('/transcript') && s.status === 200,
        ) &&
        !dialogue.seen.some((s) => s.status === 403),
      show(dialogue.seen),
    );
  } else {
    check('"Bỏ qua" is offered on the dialogue lesson', false, 'not visible');
  }
  await dialogue.page.screenshot({ path: `${SHOTS}/dialogue.png` });
  check(
    'dialogue lesson: no page or server errors',
    dialogue.issues.length === 0,
    dialogue.issues.join(' | '),
  );
  await dialogue.browser.close();

  const dictation = await open(DICTATION, 'transcript-dictation');
  check(
    'dictation lesson on load: no 403',
    !dictation.seen.some((s) => s.status === 403),
    show(dictation.seen),
  );
  check(
    'dictation lesson: no page or server errors',
    dictation.issues.length === 0,
    dictation.issues.join(' | '),
  );
  await dictation.browser.close();

  console.log(`\nTRANSCRIPT_STATUS_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch((error) => {
  console.error('ERROR', error);
  process.exit(2);
});
