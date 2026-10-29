/**
 * US / UK reference clips on /speaking/[id], in Chromium on the disposable
 * harness. Exercise 1 (free) points at the real public R2 clips (plain GET);
 * exercise 6 (premium) at copies of its private clips placed in the harness
 * fake S3 (read from R2 with a presigned GET; nothing is written to R2).
 */
import 'dotenv/config';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { check, failureCount } from './harness-api';
import { harnessExec } from './harness-db';
import { FE, hidePet, studentPage } from './harness-browser';
import { requireExplicitOptIn } from './qa-target-guard';

requireExplicitOptIn('QA_ALLOW_REAL_R2_READ', 'finalization-speaking-accent-browser reads objects from the real R2 private bucket');

const PUBLIC_1 =
  'https://pub-ecd236c9754a4b7cb22ab82189e6ded2.r2.dev/catalog/speaking/reference/1.v1.mp3';

async function copyPrivate(key: string) {
  const e = process.env;
  const real = new S3Client({
    region: 'auto',
    endpoint: e.R2_PRIVATE_ENDPOINT,
    forcePathStyle: e.R2_PRIVATE_FORCE_PATH_STYLE === 'true',
    credentials: {
      accessKeyId: e.R2_PRIVATE_ACCESS_KEY_ID!,
      secretAccessKey: e.R2_PRIVATE_SECRET_ACCESS_KEY!,
    },
  });
  const url = await getSignedUrl(
    real,
    new GetObjectCommand({ Bucket: e.R2_PRIVATE_BUCKET_NAME!, Key: key }),
    { expiresIn: 60 },
  );
  const body = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const put = await fetch(`http://127.0.0.1:9460/harness-private/${key}`, {
    method: 'PUT',
    body,
  });
  if (!put.ok) throw new Error(`fake S3 PUT ${put.status}`);
}

const TRACK = () => {
  const w = window as unknown as { __played: HTMLMediaElement[] };
  w.__played = [];
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
    w.__played.push(this);
    return play.call(this);
  };
};

async function main() {
  await copyPrivate('premium/speaking/reference/6.v1.mp3');
  await copyPrivate('premium/speaking/reference/6.en-gb.v1.mp3');
  harnessExec(
    `update "SpeakingExercise" set "audioUrl" = case id when 1 then '${PUBLIC_1}' when 6 then 'premium/speaking/reference/6.v1.mp3' end where id in (1, 6)`,
  );

  const { browser, page } = await studentPage('accent', 1366, true);
  await page.addInitScript(TRACK);
  for (const id of [1, 6]) {
    await page.goto(`${FE}/speaking/${id}`);
    await hidePet(page);
    const play = async () => {
      const button = page.getByRole('button', { name: 'Nghe mẫu phát âm' });
      await button.waitFor({ timeout: 30_000 });
      await button.click();
      await page.waitForTimeout(1500);
      const last = await page.evaluate(() => {
        const list = (window as unknown as { __played: HTMLMediaElement[] })
          .__played;
        const a = list[list.length - 1];
        const out = {
          src: a?.currentSrc ?? '',
          t: a?.currentTime ?? 0,
          err: a?.error?.code ?? null,
        };
        a?.pause();
        return out;
      });
      await page
        .getByRole('button', { name: /Dừng nghe mẫu/ })
        .click()
        .catch(() => undefined);
      return last;
    };
    const us = await play();
    check(
      `/speaking/${id} US plays ${id}.v1.mp3`,
      new URL(us.src).pathname.endsWith(`/${id}.v1.mp3`) &&
        us.t > 0 &&
        us.err === null,
      `${new URL(us.src).pathname} t=${us.t}`,
    );
    await page.getByRole('button', { name: 'Anh (UK)' }).first().click();
    const uk = await play();
    check(
      `/speaking/${id} UK plays ${id}.en-gb.v1.mp3`,
      new URL(uk.src).pathname.endsWith(`/${id}.en-gb.v1.mp3`) &&
        uk.t > 0 &&
        uk.err === null,
      `${new URL(uk.src).pathname} t=${uk.t}`,
    );
    await page.getByRole('button', { name: 'Mỹ (US)' }).first().click();
  }
  await browser.close();
  console.log(
    `\n${failureCount() ? 'FAILURES: ' + failureCount() : 'ALL PASS'}`,
  );
  process.exit(failureCount() ? 1 : 0);
}

void main();
