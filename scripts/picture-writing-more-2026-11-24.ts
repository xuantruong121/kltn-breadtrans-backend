/**
 * Second picture-writing batch (owner 2026-11-24: +20 tasks, real CC0/PD
 * photos, mostly free; "nhớ đẩy toàn bộ ảnh lên R2"): four WRITING_PICTURE
 * quizzes of five tasks (prisma/data/picture-writing-practice.ts,
 * PICTURE_WRITING_MORE_EXERCISES) added to the existing "Picture Writing"
 * topic. Pictures and licences: artifacts/picture-writing-2026-11-24/CREDITS.md.
 *
 * Modes:
 *   check   (default) content guards and file hashes; no network, no database.
 *   upload  puts each picture in the public R2 bucket under its hashed key,
 *           refusing to overwrite a different object.
 *           Needs PICTURE_MORE_UPLOAD_AUTHORIZED=upload.
 *   dryrun  checks every picture over HTTP from R2_PUBLIC_URL, then reads the
 *           target database and prints the plan; writes nothing.
 *   apply   one transaction: the four quizzes and their questions. Additive
 *           only; a rerun stops instead of duplicating.
 *           Needs PICTURE_MORE_AUTHORIZED=create, and on kltn_db also
 *           PICTURE_MORE_KLTN_DB=owner-approved.
 *
 * Usage: npx ts-node --transpile-only scripts/picture-writing-more-2026-11-24.ts [check|upload|dryrun|apply]
 * The database is DATABASE_URL; the picture host is R2_PUBLIC_URL.
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { PrismaClient, QuizType, TopicCategory } from '@prisma/client';

import {
  PICTURE_MORE_ARTIFACT_DIR,
  PICTURE_MORE_IMAGE_PREFIX,
  PICTURE_WRITING_EXERCISES,
  PICTURE_WRITING_MORE_EXERCISES,
  PICTURE_WRITING_TOPIC,
  pictureTaskContent,
} from '../prisma/data/picture-writing-practice';
import { legacyPracticeLevel } from '../src/modules/subscription/practice-level';
import { pictureTaskIssues } from '../src/modules/writing/practice-writing-grading';

const KEY = new RegExp(
  `^${PICTURE_MORE_IMAGE_PREFIX}/([a-z-]+)-([0-9a-f]{12})\\.jpg$`,
);

/** Every picture: its key, its committed file and whether the hash agrees. */
function pictures() {
  return PICTURE_WRITING_MORE_EXERCISES.flatMap((e) => e.tasks).map((task) => {
    const match = KEY.exec(task.image);
    if (!match) throw new Error(`STOP: bad picture key ${task.image}`);
    const body = readFileSync(`${PICTURE_MORE_ARTIFACT_DIR}/${match[1]}.jpg`);
    const sha = createHash('sha256').update(body).digest('hex').slice(0, 12);
    if (sha !== match[2])
      throw new Error(
        `STOP: ${match[1]}.jpg hash ${sha}, key says ${match[2]}`,
      );
    return { key: task.image, body };
  });
}

function plan(imageBase: string) {
  const out = PICTURE_WRITING_MORE_EXERCISES.map((exercise) => ({
    exercise,
    contents: exercise.tasks.map((task) =>
      pictureTaskContent(exercise, task, imageBase),
    ),
  }));
  for (const { exercise, contents } of out)
    contents.forEach((content, i) => {
      const issues = pictureTaskIssues(content);
      if (issues.length)
        throw new Error(
          `STOP: "${exercise.title}" task ${i + 1}: ${issues.join(', ')}`,
        );
    });
  return out;
}

async function main() {
  const mode = process.argv[2] ?? 'check';
  if (!['check', 'upload', 'dryrun', 'apply'].includes(mode))
    throw new Error('usage: [check|upload|dryrun|apply]');
  const files = pictures();
  const imageBase = (process.env.R2_PUBLIC_URL ?? '').replace(/\/$/, '');
  const steps = plan(imageBase || 'https://example.r2.dev');
  console.log(
    `content ok: ${steps.length} quizzes, ${files.length} tasks, every file matches its key`,
  );
  if (mode === 'check') return;

  if (mode === 'upload') {
    if (process.env.PICTURE_MORE_UPLOAD_AUTHORIZED !== 'upload')
      throw new Error('REFUSED: PICTURE_MORE_UPLOAD_AUTHORIZED=upload not set');
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
    for (const { key, body } of files) {
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
            CacheControl: 'public, max-age=31536000, immutable',
          }),
        );
      console.log(`${key}: ${head ? 'exists' : 'uploaded'}`);
    }
    return;
  }

  // dryrun / apply: the learner loads each picture from R2, so all must answer.
  if (!imageBase) throw new Error('STOP: R2_PUBLIC_URL not set');
  for (const { key } of files) {
    const res = await fetch(`${imageBase}/${key}`, { method: 'HEAD' });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.startsWith('image/'))
      throw new Error(`STOP: picture not on R2 ${res.status} ${key}`);
  }
  console.log(`pictures reachable on R2: ${files.length}`);

  const prisma = new PrismaClient();
  try {
    const [{ db, sysid }] = await prisma.$queryRawUnsafe<any[]>(
      'select current_database() db, system_identifier::text sysid from pg_control_system()',
    );
    console.log(`target ${db} sysid ${sysid} (${mode})`);
    if (mode === 'apply') {
      if (process.env.PICTURE_MORE_AUTHORIZED !== 'create')
        throw new Error('REFUSED: PICTURE_MORE_AUTHORIZED=create not set');
      if (
        db === 'kltn_db' &&
        process.env.PICTURE_MORE_KLTN_DB !== 'owner-approved'
      )
        throw new Error(
          'REFUSED: kltn_db needs PICTURE_MORE_KLTN_DB=owner-approved',
        );
    }

    const topic = await prisma.practiceTopic.findFirst({
      where: {
        name: PICTURE_WRITING_TOPIC.name,
        category: TopicCategory.WRITING_PART1,
      },
    });
    if (!topic)
      throw new Error(
        'STOP: the "Picture Writing" topic is missing; run the CP58 script first',
      );
    const first = await prisma.quiz.count({
      where: {
        practiceTopicId: topic.id,
        title: { in: PICTURE_WRITING_EXERCISES.map((e) => e.title) },
      },
    });
    const twins = await prisma.quiz.count({
      where: { title: { in: steps.map((s) => s.exercise.title) } },
    });
    if (twins > 0)
      throw new Error(
        `STOP: ${twins} of these quizzes already exist; nothing written`,
      );
    console.log(`topic ${topic.id}, first batch present: ${first}/2`);
    for (const { exercise, contents } of steps)
      console.log(
        `plan: "${exercise.title}" premium=${exercise.isPremiumContent} tasks=${contents.length}`,
      );
    if (mode === 'dryrun') return;

    const created = await prisma.$transaction(async (tx) => {
      const quizzes: string[] = [];
      for (const { exercise, contents } of steps) {
        const quiz = await tx.quiz.create({
          data: {
            title: exercise.title,
            description: exercise.description,
            type: QuizType.WRITING_PICTURE,
            practiceTopicId: topic.id,
            practiceLevel: legacyPracticeLevel(exercise.title) ?? 'BASIC',
            isPremiumContent: exercise.isPremiumContent,
            publishedAt: new Date(),
            questions: {
              create: contents.map((content, i) => ({
                type: 'WRITING',
                order: i + 1,
                content,
              })),
            },
          },
        });
        quizzes.push(`quiz ${quiz.id} "${quiz.title}"`);
      }
      return quizzes;
    });
    console.log(`created ${created.join('; ')}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
