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
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';

import { check, failureCount } from './harness-api';
import { harnessExec } from './harness-db';
import { FE, hidePet, studentPage } from './harness-browser';
import { requireExplicitOptIn } from './qa-target-guard';

requireExplicitOptIn(
  'QA_ALLOW_REAL_R2_READ',
  'finalization-speaking-practice-browser reads objects from the real R2 private bucket',
);

const KEY = 'premium/speaking/reference/6.v1.mp3';
const SHOTS = `${process.env.TEMP ?? '.'}/breadtrans-harness/shots`;

/**
 * Real R2 allowlist (CP60 owner authorization, read-only): from this process
 * the only request that may leave the machine is one GET of KEY on the private
 * R2 endpoint. Anything else to a non-local host is refused before it is sent.
 * Every allowed request is counted and reported.
 */
const r2Host = new URL(
  process.env.R2_PRIVATE_ENDPOINT ?? 'http://unset.invalid',
).host;
const r2 = { reads: 0, refused: 0 };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input: unknown, init?: RequestInit) => {
  const url = new URL(String((input as { url?: string })?.url ?? input));
  const local = ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (!local) {
    const method = (init?.method ?? 'GET').toUpperCase();
    // Presigned URLs are virtual-hosted (<bucket>.<endpoint>) unless path style is forced.
    const bucketHost = `${process.env.R2_PRIVATE_BUCKET_NAME}.${r2Host}`;
    const allowed =
      (url.host === r2Host || url.host === bucketHost) &&
      method === 'GET' &&
      decodeURIComponent(url.pathname).endsWith(`/${KEY}`);
    if (!allowed) {
      r2.refused += 1;
      throw new Error(`REFUSED: ${method} to a non-allowlisted target`);
    }
    r2.reads += 1;
  }
  return realFetch(input as never, init);
};

/** The clip must be the project's own TTS reference audio (manifest hash). */
const MANIFEST_SHA256 = (
  JSON.parse(
    readFileSync('artifacts/speaking-reference-audio/manifest.json', 'utf8'),
  ) as { clips: Array<{ key: string; audioSha256: string }> }
).clips.find((e) => e.key === KEY)?.audioSha256;

/** Signed URLs are never printed: query strings are cut. */
const redact = (text: string) =>
  text.replace(/\?[^"\s]*X-Amz-[^"\s]*/g, '?<signed>');

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
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (!MANIFEST_SHA256 || sha !== MANIFEST_SHA256)
    throw new Error(
      `REFUSED: R2 object is not the manifest TTS clip (sha ${sha.slice(0, 12)})`,
    );
  check(
    'real R2 object is the project TTS reference clip (sha256 = manifest)',
    true,
    `${bytes.length} bytes, sha ${sha.slice(0, 12)}…`,
  );
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
  pro.page.on('response', (r) => {
    if (r.url().includes('/harness-private/'))
      media.push({
        url: r.url(),
        status: r.status(),
        bytes: Number(r.headers()['content-length'] ?? 0),
      });
  });
  const proWrites: string[] = [];
  pro.page.on('request', (r) => {
    if (r.url().includes(':3101/') && r.method() !== 'GET')
      proWrites.push(`${r.method()} ${new URL(r.url()).pathname}`);
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
    redact(JSON.stringify(clip ?? played)),
  );
  check(
    'the bytes served are the clip mapped to exercise 6',
    // Chromium may fetch audio with a Range request: 206 is a part of the
    // same object, so only its key and a non-empty body are checked then.
    media.some(
      (m) =>
        m.url.includes(KEY) &&
        ((m.status === 200 && (m.bytes === 0 || m.bytes === size)) ||
          (m.status === 206 && m.bytes > 0 && m.bytes <= size)),
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
  check(
    'listening to the reference clip makes no API write',
    proWrites.length === 0,
    proWrites.join(', '),
  );

  // Media error: the exercise points at a clip the storage does not have.
  harnessExec(
    `update "SpeakingExercise" set "audioUrl" = 'premium/speaking/reference/qa-missing.v1.mp3' where id = 6`,
  );
  const pageErrors: string[] = [];
  pro.page.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 120)));
  await pro.page.goto(`${FE}/speaking/6`);
  await hidePet(pro.page);
  await listen.waitFor({ timeout: 30_000 });
  await listen.click();
  const toastShown = await pro.page
    .getByText('Không thể phát audio mẫu được quản trị.')
    .first()
    .waitFor({ timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  await pro.page.screenshot({ path: `${SHOTS}/speaking-6-media-error.png` });
  check(
    'a missing reference clip shows a learner message and does not crash the page',
    toastShown && pageErrors.length === 0,
    pageErrors.join('; '),
  );
  harnessExec(
    `update "SpeakingExercise" set "audioUrl" = '${KEY}' where id = 6`,
  );
  await pro.browser.close();

  // Free learner: locked
  const free = await studentPage('spk-br-free');
  const privateRequests: string[] = [];
  const freeWrites: string[] = [];
  free.page.on('request', (r) => {
    if (r.url().includes('/harness-private/')) privateRequests.push(r.url());
    if (r.url().includes(':3101/') && r.method() !== 'GET')
      freeWrites.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });
  await free.page.goto(`${FE}/speaking/6`);
  await hidePet(free.page);
  await free.page
    .getByText('Nội dung dành cho PRO')
    .waitFor({ timeout: 30_000 });
  // Owner matrix 2026-10-28: Speaking B1+ needs PRO.
  check('free learner sees the PRO lock on /speaking/6', true);
  check(
    'free learner page requests no private media',
    privateRequests.length === 0,
    String(privateRequests.length),
  );
  check(
    'the locked page makes no API write',
    freeWrites.length === 0,
    freeWrites.join(', '),
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

  check(
    'real R2: exactly one allowlisted GET, nothing refused, no write',
    r2.reads === 1 && r2.refused === 0,
    `reads ${r2.reads}, refused ${r2.refused}`,
  );
  console.log(
    `REAL_R2_READS=${r2.reads} REAL_R2_REFUSED=${r2.refused} REAL_R2_WRITES=0`,
  );
  console.log(`\nshots: ${SHOTS}`);
  console.log(`${failureCount() ? 'FAILURES: ' + failureCount() : 'ALL PASS'}`);
  process.exit(failureCount() ? 1 : 0);
}

void main();
