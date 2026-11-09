/**
 * TOEIC Listening master from storage (capacity follow-up, 2026-11-09). With
 * the master in the private bucket, `GET /toeic/attempts/:id/listening/master`
 * hands out a signed URL and the exam page plays it straight from storage,
 * with no audio bytes through the API; it seeks; and when the URL stops
 * working the page asks for a new one once and carries on.
 *
 *   HARNESS_DB=<db seeded by load-tests/capacity/seed-capacity.ts with MASTER_FILE> \
 *     [SHOTS=<dir>] npx ts-node --transpile-only scripts/qa/finalization-toeic-master-signed.ts
 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

import { BE, call, check, failureCount } from './harness-api';
import { FE } from './harness-browser';

const SHOTS = process.env.SHOTS ?? 'artifacts/finalization/evidence';
const STORAGE = 'http://127.0.0.1:9460/';
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

async function main() {
  const data = JSON.parse(
    readFileSync('load-tests/capacity/out/capacity-data.json', 'utf8'),
  );
  const user = data.users[960];
  const login = await call('POST', '/auth/login', undefined, {
    email: user.email,
    password: data.password,
  });
  const token = login.data?.accessToken ?? login.data?.access_token;
  const started = await call(
    'POST',
    `/toeic/exams/${data.examId}/attempts`,
    token,
    { mode: 'PRACTICE' },
  );
  const attemptId = started.data?.id;
  await call('POST', `/toeic/attempts/${attemptId}/begin`, token);
  const master = await call(
    'GET',
    `/toeic/attempts/${attemptId}/listening/master`,
    token,
  );
  check(
    'the API hands out a signed storage URL for the master',
    master.data?.available === true &&
      typeof master.data?.url === 'string' &&
      master.data.url.startsWith(STORAGE) &&
      /X-Amz-Signature=/.test(master.data.url),
    String(master.data?.url).slice(0, 80),
  );

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1366, height: 900 },
  });
  const viaApi: string[] = [];
  let masterAsks = 0;
  let failNext = false;
  page.on('request', (r) => {
    if (r.url().startsWith(BE) && /listening-master\/\d+\/audio/.test(r.url()))
      viaApi.push(r.url());
    if (r.url().startsWith(BE) && /listening\/master/.test(r.url()))
      masterAsks += 1;
  });
  // Stand-in for an expired URL: the next storage request is refused once.
  await page.route(`${STORAGE}**`, (route) => {
    if (failNext) {
      failNext = false;
      return route.fulfill({ status: 403, body: 'expired' });
    }
    return route.continue();
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
  await page.goto(`${FE}/toeic/attempts/${attemptId}`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  const ready = await page
    .waitForFunction(
      (storage) => {
        const a = document.querySelector('audio');
        return !!a && a.src.startsWith(storage) && a.duration > 0;
      },
      STORAGE,
      { timeout: 30_000 },
    )
    .then(() => true)
    .catch(() => false);
  check('the exam page plays the master from storage', ready);
  check(
    'no master bytes come through the API',
    viaApi.length === 0,
    viaApi.join(' '),
  );
  const seeked = await page.evaluate(async () => {
    const a = document.querySelector('audio')!;
    a.muted = true;
    a.currentTime = 600;
    await new Promise((ok) => a.addEventListener('seeked', ok, { once: true }));
    return a.currentTime;
  });
  check('it seeks (10 min in)', seeked >= 599, seeked.toFixed(1));
  await page.screenshot({ path: `${SHOTS}/toeic-master-signed.png` });

  // The URL stops working: force a fresh load, which the route refuses once.
  const asksBefore = masterAsks;
  failNext = true;
  await page.evaluate(() => {
    const a = document.querySelector('audio')!;
    a.src = a.src + '&expired=1';
    a.load();
  });
  const renewed = await page
    .waitForFunction(
      (storage) => {
        const a = document.querySelector('audio');
        return (
          !!a &&
          a.src.startsWith(storage) &&
          !a.src.includes('expired=1') &&
          a.duration > 0
        );
      },
      STORAGE,
      { timeout: 30_000 },
    )
    .then(() => true)
    .catch(() => false);
  await sleep(500);
  check(
    'an expired URL is renewed once and the master loads again',
    renewed && masterAsks === asksBefore + 1,
    `asks ${masterAsks - asksBefore}`,
  );
  check(
    'no error is shown after the renewal',
    (await page.getByText('Không tải được bản ghi phần Nghe').count()) === 0,
  );
  await browser.close();
  console.log(`TOEIC_MASTER_SIGNED_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

void main();
