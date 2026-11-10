/**
 * Listening audio straight from storage (capacity run 2026-11-09). The page
 * asks the API where a question's audio is (`/audio-url`) and the <audio>
 * element streams it from the bucket; no audio bytes come through the API.
 * Checks a comprehension quiz and a dictation quiz on the harness, with a real
 * mp3 placed in the fake bucket for their first questions.
 *
 *   HARNESS_DB=<db seeded by load-tests/capacity/seed-capacity.ts> CLIP=<path to an mp3> \
 *     [SHOTS=<dir>] npx ts-node --transpile-only scripts/qa/finalization-listening-audio-url.ts
 */
import { readFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright';

import { BE, call, check, failureCount } from './harness-api';
import { FE } from './harness-browser';
import { harnessQuery } from './harness-db';

const SHOTS = process.env.SHOTS ?? 'artifacts/finalization/evidence';
const clip = readFileSync(process.env.CLIP ?? '');

async function putClip(key: string) {
  for (const bucket of ['harness-public', 'harness-private'])
    await fetch(`http://127.0.0.1:9460/${bucket}/${key}`, {
      method: 'PUT',
      body: clip,
    });
}

async function playOn(page: Page, path: string, tag: string) {
  const viaApi: string[] = [];
  const located: string[] = [];
  const fromStorage: number[] = [];
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith(BE) && /\/questions\/\d+\/audio(\?|$)/.test(u))
      viaApi.push(u);
    if (u.startsWith(BE) && /\/questions\/\d+\/audio-url/.test(u))
      located.push(u);
  });
  page.on('response', (r) => {
    if (r.url().startsWith('http://127.0.0.1:9460/'))
      fromStorage.push(r.status());
  });
  await page.goto(`${FE}${path}`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  const ready = await page
    .waitForFunction(
      () => {
        const a = document.querySelector('audio');
        return (
          !!a && a.src.startsWith('http://127.0.0.1:9460/') && a.duration > 0
        );
      },
      undefined,
      { timeout: 30_000 },
    )
    .then(() => true)
    .catch(() => false);
  check(
    `${tag}: the audio element streams from storage and knows its length`,
    ready,
  );
  check(
    `${tag}: the page asked the API where the audio is`,
    located.length >= 1,
    String(located.length),
  );
  check(
    `${tag}: no audio bytes came through the API`,
    viaApi.length === 0,
    viaApi.join(' '),
  );
  check(
    `${tag}: the bucket answered`,
    fromStorage.some((s) => s === 200 || s === 206),
    fromStorage.join(','),
  );
  const played = await page.evaluate(async () => {
    const a = document.querySelector('audio')!;
    a.muted = true;
    await a.play();
    await new Promise((ok) => setTimeout(ok, 1500));
    return a.currentTime;
  });
  check(`${tag}: it plays`, played > 0.5, `${played.toFixed(2)} s`);
  await page.screenshot({ path: `${SHOTS}/listening-audio-url-${tag}.png` });
}

async function main() {
  const data = JSON.parse(
    readFileSync('load-tests/capacity/out/capacity-data.json', 'utf8'),
  );
  const user = data.users[950];
  const login = await call('POST', '/auth/login', undefined, {
    email: user.email,
    password: data.password,
  });
  const token = login.data?.accessToken ?? login.data?.access_token;
  const list = (await call('GET', '/quizzes/listening-practice', token))
    .data as Array<{
    id: number;
    mode: string;
    isLocked: boolean;
    isLevelLocked: boolean;
  }>;
  const open = list.filter(
    (q) =>
      !q.isLocked && !q.isLevelLocked && data.listeningQuizIds.includes(q.id),
  );
  const comprehension = open.find((q) => q.mode === 'COMPREHENSION');
  const dictation = open.find((q) => q.mode === 'DICTATION');
  check(
    'a comprehension and a dictation quiz are open to the learner',
    !!comprehension && !!dictation,
  );
  for (const quiz of [comprehension, dictation].filter(Boolean)) {
    const [[key]] = harnessQuery(
      `select a.key from "QuizAudioAsset" a join "Question" q on q.id = a."questionId" where q."quizId" = ${quiz!.id} and a."isActive" order by q."order" limit 1`,
    );
    await putClip(key);
    // A dialogue or dictation quiz may play its published whole-quiz track.
    for (const [trackKey] of harnessQuery(
      `select "r2Key" from "ListeningAudioArtifact" where "quizId" = ${quiz!.id} and "r2Key" is not null`,
    ))
      await putClip(trackKey);
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1366, height: 900 },
  });
  await page.goto(`${FE}/login`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page.click('button[aria-controls="email-login-panel"]');
  await page.fill('input[name="email"]', user.email);
  await page.fill('input[name="password"]', data.password);
  await page.click('#email-login-panel button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), {
    timeout: 60_000,
    waitUntil: 'commit',
  });
  if (comprehension)
    await playOn(page, `/listening/${comprehension.id}`, 'comprehension');
  if (dictation) await playOn(page, `/listening/${dictation.id}`, 'dictation');
  await browser.close();
  console.log(`LISTENING_AUDIO_URL_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

void main();
