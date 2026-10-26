/**
 * Speaking practice in Chromium on the disposable harness (FE :3100, BE :3101,
 * mock assessment). Covers the real learner route /speaking/[id]:
 *
 *  - a PRO learner plays exercise 6's premium reference clip through the
 *    application's presigned URL (the harness private bucket holds a copy of
 *    the real clip, fetched read-only from R2 with a presigned GET);
 *  - a free learner gets the locked view and no private media request;
 *  - recording with Chromium's fake microphone, upload and the free-answer
 *    result view (transcript, no per-word comparison, no completeness card).
 *
 * Usage: npx ts-node scripts/qa/finalization-speaking-practice-browser.ts <16 kHz WAV>
 */
import 'dotenv/config';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { mkdirSync } from 'node:fs';

import { check, failureCount } from './harness-api';
import { harnessExec } from './harness-db';
import { FE, hidePet, studentPage } from './harness-browser';

const KEY = 'premium/speaking/reference/6.v1.mp3';
const SHOTS = `${process.env.TEMP ?? '.'}/breadtrans-harness/shots`;

async function seedPrivateClip(): Promise<number> {
  const env = process.env;
  const real = new S3Client({
    region: 'auto',
    endpoint: env.R2_PRIVATE_ENDPOINT,
    forcePathStyle: env.R2_PRIVATE_FORCE_PATH_STYLE === 'true',
    credentials: {
      accessKeyId: env.R2_PRIVATE_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_PRIVATE_SECRET_ACCESS_KEY!,
    },
  });
  const url = await getSignedUrl(
    real,
    new GetObjectCommand({ Bucket: env.R2_PRIVATE_BUCKET_NAME!, Key: KEY }),
    { expiresIn: 60 },
  );
  const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
  const put = await fetch(`http://127.0.0.1:9460/harness-private/${KEY}`, {
    method: 'PUT',
    headers: { 'content-type': 'audio/mpeg' },
    body: new Uint8Array(bytes),
  });
  if (!put.ok) throw new Error(`fake S3 PUT ${put.status}`);
  harnessExec(
    `update "SpeakingExercise" set "audioUrl" = '${KEY}' where id = 6`,
  );
  return bytes.length;
}

/** Remember every Audio the page plays, so playback can be measured. */
const TRACK_AUDIO = () => {
  const w = window as unknown as { __played: HTMLMediaElement[] };
  w.__played = [];
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
    w.__played.push(this);
    return play.call(this);
  };
};

async function main() {
  const wav = process.argv[2];
  mkdirSync(SHOTS, { recursive: true });
  const size = await seedPrivateClip();

  // PRO learner: premium reference audio
  const pro = await studentPage('spk-br-pro', 1366, true);
  await pro.page.addInitScript(TRACK_AUDIO);
  const media: Array<{ url: string; status: number; bytes: number }> = [];
  pro.page.on('response', async (r) => {
    if (r.url().includes('/harness-private/'))
      media.push({
        url: r.url(),
        status: r.status(),
        bytes: Number(r.headers()['content-length'] ?? 0),
      });
  });
  await pro.page.goto(`${FE}/speaking/6`);
  await hidePet(pro.page);
  const listen = pro.page.getByRole('button', { name: 'Nghe mẫu phát âm' });
  await listen.waitFor({ timeout: 30_000 });
  await listen.click();
  await pro.page.waitForTimeout(1500);
  const played = await pro.page.evaluate(() =>
    (window as unknown as { __played: HTMLMediaElement[] }).__played.map(
      (a) => ({
        src: a.currentSrc,
        t: a.currentTime,
        duration: a.duration,
        error: a.error?.code ?? null,
      }),
    ),
  );
  const clip = played.find((p) => p.src.includes(KEY));
  check(
    'PRO /speaking/6 plays its own premium clip through a presigned URL',
    !!clip &&
      clip.t > 0 &&
      clip.error === null &&
      /X-Amz-Signature=/.test(clip.src),
    JSON.stringify(clip ?? played),
  );
  check(
    'the bytes served are the clip mapped to exercise 6',
    media.some(
      (m) =>
        m.status === 200 &&
        m.url.includes(KEY) &&
        (m.bytes === 0 || m.bytes === size),
    ),
    JSON.stringify(media.map((m) => [m.status, m.bytes])),
  );
  const html = await pro.page.content();
  check(
    'no storage credential or raw private key in the page',
    !html.includes(process.env.R2_PRIVATE_ACCESS_KEY_ID ?? '@@none@@') &&
      !html.includes(`"audioUrl":"${KEY}"`),
  );
  await pro.page.screenshot({ path: `${SHOTS}/speaking-6-pro.png` });
  await pro.browser.close();

  // Free learner: locked
  const free = await studentPage('spk-br-free');
  const privateRequests: string[] = [];
  free.page.on('request', (r) => {
    if (r.url().includes('/harness-private/')) privateRequests.push(r.url());
  });
  await free.page.goto(`${FE}/speaking/6`);
  await hidePet(free.page);
  await free.page
    .getByText('Bài luyện nói này thuộc gói PLUS')
    .waitFor({ timeout: 30_000 });
  check('free learner sees the PLUS lock on /speaking/6', true);
  check(
    'free learner page requests no private media',
    privateRequests.length === 0,
    String(privateRequests.length),
  );
  await free.page.screenshot({ path: `${SHOTS}/speaking-6-free.png` });
  await free.browser.close();

  // Recording a free answer with the fake microphone
  const rec = await studentPage('spk-br-rec', 1366, false, [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${wav}`,
  ]);
  const directPuts: string[] = [];
  rec.page.on('request', (r) => {
    if (r.method() === 'PUT' && r.url().includes(':9460/'))
      directPuts.push(r.url());
  });
  await rec.page.goto(`${FE}/speaking/16`);
  await hidePet(rec.page);
  check(
    'free-answer page does not list the question words as pronunciation targets',
    (await rec.page.getByText('Trọng tâm phát âm trong câu này').count()) === 0,
  );
  await rec.page
    .getByRole('button', { name: 'Bắt đầu thu âm', exact: true })
    .first()
    .click();
  await rec.page.waitForTimeout(4000);
  await rec.page.screenshot({ path: `${SHOTS}/speaking-16-recording.png` });
  await rec.page
    .getByRole('button', { name: 'Dừng ghi âm và chấm điểm' })
    .click();
  await rec.page.waitForTimeout(12_000);
  await rec.page.screenshot({
    path: `${SHOTS}/speaking-16-after-submit.png`,
    fullPage: true,
  });
  await rec.page.getByText('Hệ thống nghe được').waitFor({ timeout: 60_000 });
  const body = await rec.page.locator('body').innerText();
  check(
    'proxy upload mode: no direct storage PUT from the browser',
    directPuts.length === 0,
    String(directPuts.length),
  );
  check(
    'recorded answer is uploaded and graded',
    /\[mock\] I think it is a good idea/.test(body),
  );
  check(
    'free-answer result has no per-word table and no completeness card',
    !body.includes('Đánh giá theo từng từ') && !/Độ hoàn thiện/i.test(body),
  );
  check(
    'stop submits at once; result offers Ghi âm lại',
    body.includes('Ghi âm lại') && !body.includes('Gửi đánh giá'),
  );
  await rec.page.screenshot({
    path: `${SHOTS}/speaking-16-result.png`,
    fullPage: true,
  });
  await rec.page.getByRole('button', { name: 'Ghi âm lại' }).first().click();
  await rec.page
    .getByRole('button', { name: 'Bắt đầu thu âm', exact: true })
    .first()
    .waitFor({ timeout: 10_000 });
  check('Ghi âm lại returns to a fresh recording', true);
  await rec.page.reload();
  await rec.page.waitForTimeout(3000);
  await rec.page.screenshot({
    path: `${SHOTS}/speaking-16-after-refresh.png`,
    fullPage: true,
  });
  await rec.browser.close();

  console.log(`\nshots: ${SHOTS}`);
  console.log(`${failureCount() ? 'FAILURES: ' + failureCount() : 'ALL PASS'}`);
  process.exit(failureCount() ? 1 : 0);
}

void main();
