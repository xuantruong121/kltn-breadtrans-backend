/**
 * Read-only check of the premium Speaking reference clips in the REAL private
 * bucket: every premium exercise's key exists (HeadObject), the public bucket
 * does not serve it, and a 300 s presigned GET returns playable MP3 bytes.
 * With --browser, Chromium plays each presigned URL in an <audio> element.
 *
 * No write, no delete, no DB mutation. Keys come from DATABASE_URL (read).
 * Usage: npx ts-node scripts/qa/speaking-premium-media-verify.ts [--browser]
 */
import 'dotenv/config';
import {
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PrismaClient } from '@prisma/client';
import { requireExplicitOptIn } from './qa-target-guard';

requireExplicitOptIn('QA_ALLOW_REAL_R2_READ', 'speaking-premium-media-verify reads objects from the real R2 private bucket');

async function main() {
  const env = process.env;
  const bucket = env.R2_PRIVATE_BUCKET_NAME!;
  const client = new S3Client({
    region: 'auto',
    endpoint: env.R2_PRIVATE_ENDPOINT,
    forcePathStyle: env.R2_PRIVATE_FORCE_PATH_STYLE === 'true',
    credentials: {
      accessKeyId: env.R2_PRIVATE_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_PRIVATE_SECRET_ACCESS_KEY!,
    },
  });
  const prisma = new PrismaClient();
  const rows = await prisma.speakingExercise.findMany({
    where: { isPremiumContent: true, audioUrl: { not: null } },
    select: { id: true, taskType: true, audioUrl: true },
    orderBy: { id: 'asc' },
  });
  await prisma.$disconnect();

  let fail = 0;
  const urls: Array<{ id: number; url: string }> = [];
  for (const r of rows) {
    const key = r.audioUrl!;
    let head = 'missing';
    try {
      const h = await client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key }),
      );
      head = `${h.ContentType} ${h.ContentLength}B`;
    } catch {
      fail += 1;
    }
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      {
        expiresIn: 300,
      },
    );
    const res = await fetch(url);
    const bytes = Buffer.from(await res.arrayBuffer());
    const mp3 =
      bytes.subarray(0, 3).toString('latin1') === 'ID3' ||
      (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
    const pub = env.R2_PUBLIC_URL
      ? (
          await fetch(`${env.R2_PUBLIC_URL.replace(/\/$/, '')}/${key}`, {
            method: 'HEAD',
          })
        ).status
      : 'n/a';
    const ok = head !== 'missing' && res.status === 200 && mp3 && pub !== 200;
    if (!ok) fail += 1;
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  #${r.id} ${r.taskType} ${key}  head=${head} presignedGET=${res.status} ${bytes.length}B mp3=${mp3} public=${pub}`,
    );
    urls.push({ id: r.id, url });
  }
  console.log(`\nPREMIUM_OBJECTS=${rows.length} FAILURES=${fail}`);

  if (process.argv.includes('--browser')) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { chromium } = require('playwright');
    const browser = await chromium.launch({
      args: ['--autoplay-policy=no-user-gesture-required'],
    });
    const page = await browser.newPage();
    await page.setContent('<audio id="a" muted></audio>');
    let played = 0;
    for (const { id, url } of urls) {
      const r = await page.evaluate(async (src: string) => {
        const a = document.getElementById('a') as HTMLAudioElement;
        a.src = src;
        try {
          await a.play();
          await new Promise((ok) => setTimeout(ok, 700));
          const out = {
            duration: a.duration,
            t: a.currentTime,
            err: a.error?.code ?? null,
          };
          a.pause();
          return out;
        } catch (e) {
          return { duration: NaN, t: 0, err: String(e) };
        }
      }, url);
      const ok =
        Number.isFinite(r.duration) && r.duration > 0 && r.t > 0 && !r.err;
      if (ok) played += 1;
      console.log(
        `${ok ? 'PASS' : 'FAIL'}  browser play #${id} duration=${r.duration?.toFixed?.(2)}s advanced=${r.t.toFixed(2)}s err=${r.err}`,
      );
    }
    await browser.close();
    console.log(`\nBROWSER_PLAYED=${played}/${urls.length}`);
    if (played !== urls.length) fail += 1;
  }
  process.exit(fail ? 1 : 0);
}

void main();
