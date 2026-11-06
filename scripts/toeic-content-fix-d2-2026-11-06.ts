/**
 * TOEIC fix batch D2 (owner approved 2026-11-06): pictures.
 *   - Writing sets 1 and 2, Q1/Q4/Q5 reused three Part 1 images of exam 1;
 *     they get pictures of their own and keywords that fit them.
 *   - Speaking 4 Skills (exam-5-speaking) Q3 was 500x315 px and Q4 a very
 *     dark night scene; both are replaced.
 * Images and licences: artifacts/toeic-fix-d2/CREDITS.md.
 *
 * Modes:
 *   upload  puts each image in the public R2 bucket under a content-hashed
 *           key, refusing to overwrite a different object.
 *           Needs TOEIC_FIX_D2_UPLOAD_AUTHORIZED=upload.
 *   check   read-only guards (default).
 *   apply   one transaction, after saving the old rows to a rollback file.
 *
 * Usage: npx ts-node --transpile-only scripts/toeic-content-fix-d2-2026-11-06.ts [check|upload|apply]
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';

const DIR = 'artifacts/toeic-fix-d2';
const OLD = 'https://pub-ecd236c9754a4b7cb22ab82189e6ded2.r2.dev';
const keyOf = (file: string) => {
  const body = readFileSync(`${DIR}/${file}`);
  const name = file.replace(/\.jpg$/, '');
  return `catalog/toeic/shared/images/${name}-${createHash('sha256').update(body).digest('hex').slice(0, 12)}.jpg`;
};
const urlOf = (file: string) =>
  `${(process.env.R2_PUBLIC_URL ?? '').replace(/\/$/, '')}/${keyOf(file)}`;

const WRITING = [
  {
    ids: [181, 189],
    oldImage: `${OLD}/catalog/toeic/shared/images/folders-cabinet.png`,
    oldKeywords: ['folder', 'shelf'],
    file: 'restaurant-kitchen.jpg',
    keywords: ['chef', 'kitchen'],
  },
  {
    ids: [184, 192],
    oldImage: `${OLD}/catalog/toeic/shared/images/departure-board.png`,
    oldKeywords: ['passenger', 'schedule'],
    file: 'airport-check-in.jpg',
    keywords: ['luggage', 'wait'],
  },
  {
    ids: [185, 193],
    oldImage: `${OLD}/catalog/toeic/shared/images/bicycle-rack.png`,
    oldKeywords: ['bicycle', 'park'],
    file: 'market-pumpkins.jpg',
    keywords: ['pumpkin', 'table'],
  },
];
const SPEAKING = [
  {
    id: 189,
    oldImage: `${OLD}/ai/toeic-exams/exam-5/speaking/3.jpg`,
    file: 'truck-unloading.jpg',
    title: 'Describe a Delivery Scene',
  },
  {
    id: 190,
    oldImage: `${OLD}/ai/toeic-exams/exam-5/speaking/4.jpg`,
    file: 'bus-stop.jpg',
    title: 'Describe a Bus Stop',
  },
];

async function main() {
  const mode = process.argv[2] ?? 'check';
  const files = [...WRITING.map((w) => w.file), ...SPEAKING.map((s) => s.file)];
  if (mode === 'upload') {
    if (process.env.TOEIC_FIX_D2_UPLOAD_AUTHORIZED !== 'upload')
      throw new Error('REFUSED: TOEIC_FIX_D2_UPLOAD_AUTHORIZED=upload not set');
    const client = new S3Client({
      region: 'auto',
      endpoint:
        process.env.R2_ENDPOINT ||
        `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
    const bucket = process.env.R2_BUCKET_NAME!;
    for (const file of files) {
      const body = readFileSync(`${DIR}/${file}`);
      const key = keyOf(file);
      const md5 = createHash('md5').update(body).digest('hex');
      const head = await client
        .send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
        .catch((e: any) => {
          if (e?.$metadata?.httpStatusCode === 404) return null;
          throw e;
        });
      if (head && (head.ETag ?? '').replace(/"/g, '') !== md5)
        throw new Error(`REFUSED: ${key} exists with different content`);
      if (!head)
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: 'image/jpeg',
          }),
        );
      console.log(`${key}: ${head ? 'exists' : 'uploaded'}`);
    }
    return;
  }

  const url = new URL(process.env.DATABASE_URL ?? '');
  console.log(`${mode} target ${url.hostname}:${url.port}${url.pathname}`);
  const prisma = new PrismaClient();
  const problems: string[] = [];
  const ops: any[] = [];
  const rollback: unknown[] = [];
  for (const w of WRITING)
    for (const id of w.ids) {
      const q = await prisma.question.findUnique({ where: { id } });
      const c = (q?.content ?? {}) as Record<string, unknown>;
      if (!q) {
        problems.push(`question ${id}: missing`);
        continue;
      }
      if (c.imageUrl !== w.oldImage)
        problems.push(`question ${id}: image changed`);
      if (JSON.stringify(c.keywords) !== JSON.stringify(w.oldKeywords))
        problems.push(`question ${id}: keywords changed`);
      rollback.push({ question: { id, content: q.content } });
      ops.push(
        prisma.question.update({
          where: { id },
          data: {
            content: {
              ...c,
              imageUrl: urlOf(w.file),
              keywords: w.keywords,
            } as any,
          },
        }),
      );
      console.log(
        `question ${id}: ${w.oldKeywords.join('/')} -> ${w.keywords.join('/')}, ${w.file}`,
      );
    }
  for (const s of SPEAKING) {
    const e = await prisma.speakingExercise.findUnique({ where: { id: s.id } });
    if (!e) {
      problems.push(`exercise ${s.id}: missing`);
      continue;
    }
    if (
      e.imageUrl !== s.oldImage ||
      e.practiceSetId !== 'exam-5-speaking' ||
      e.taskType !== 'DESCRIBE_PICTURE'
    )
      problems.push(`exercise ${s.id}: changed`);
    rollback.push({
      exercise: { id: s.id, imageUrl: e.imageUrl, title: e.title },
    });
    ops.push(
      prisma.speakingExercise.update({
        where: { id: s.id },
        data: { imageUrl: urlOf(s.file), title: s.title },
      }),
    );
    console.log(`exercise ${s.id}: ${e.title} -> ${s.title}, ${s.file}`);
  }
  if (problems.length) {
    console.log('ABORT, nothing written:');
    for (const p of problems) console.log('  ', p);
    await prisma.$disconnect();
    process.exit(1);
  }
  if (mode !== 'apply') {
    console.log(`CHECK ok: ${ops.length} rows, nothing written`);
    await prisma.$disconnect();
    return;
  }
  for (const file of files) {
    const res = await fetch(urlOf(file), { method: 'HEAD' });
    if (!res.ok)
      throw new Error(`${urlOf(file)} -> ${res.status}; upload first`);
  }
  const out = `toeic-content-fix-d2-rollback-${Date.now()}.json`;
  writeFileSync(out, JSON.stringify(rollback, null, 2));
  await prisma.$transaction(ops);
  console.log(`APPLIED ${ops.length} rows; rollback file ${out}`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('ERROR', error instanceof Error ? error.message : error);
  process.exit(2);
});
