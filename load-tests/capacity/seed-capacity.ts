/**
 * Seeds a harness copy of the database for the 1000-learner capacity run
 * (owner 2026-11-09). Refuses anything that is not a harness database.
 *
 *  - 1000 learners `qa-capacity-0001@example.invalid` ... with one password
 *    (a few log in for real; the rest use tokens signed with the run's secret);
 *  - a stand-in mp3 in the fake bucket for every active practice listening
 *    clip and published listening track, at the real clip size (about 65 KB)
 *    so the backend streams realistic bytes without touching Cloudflare R2;
 *  - load-tests/capacity/out/capacity-data.json for the k6 scenario.
 *
 *   DATABASE_URL=postgresql://harness:...@127.0.0.1:5460/<db> FAKE_S3=http://127.0.0.1:9460 \
 *     npx ts-node --transpile-only load-tests/capacity/seed-capacity.ts
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PROTECTED_SYSID = '7674533776495505443'; // kltn_db, the owner's data
const USERS = Number(process.env.CAPACITY_USERS ?? 1000);
const PASSWORD = 'Capacity-load-Aa1!';
const FAKE_S3 = process.env.FAKE_S3 ?? 'http://127.0.0.1:9460';
const CLIP_BYTES = 65_088; // a real practice clip (quiz-1/question-1/v1.mp3)
const TRACK_BYTES = 1_200_000; // a whole dialogue track, about 2.5 min at 64 kbps

const url = process.env.DATABASE_URL ?? '';
if (!/@127\.0\.0\.1:5460\//.test(url) || /\/kltn_db\b/.test(url)) {
  throw new Error(
    `REFUSED: DATABASE_URL is not a harness database (${url.replace(/:[^:@/]+@/, ':***@')})`,
  );
}

const prisma = new PrismaClient();

async function put(bucket: string, key: string, bytes: number) {
  const body = Buffer.alloc(bytes, 0x55);
  body.write('ID3', 0); // looks like an mp3 to anything that peeks
  const res = await fetch(`${FAKE_S3}/${bucket}/${key}`, {
    method: 'PUT',
    body,
  });
  if (!res.ok) throw new Error(`fake s3 PUT ${bucket}/${key}: ${res.status}`);
}

async function main() {
  const [{ system_identifier }] = await prisma.$queryRaw<
    { system_identifier: bigint }[]
  >`
    select system_identifier from pg_control_system()`;
  if (String(system_identifier) === PROTECTED_SYSID)
    throw new Error('REFUSED: this is kltn_db');

  const hash = await bcrypt.hash(PASSWORD, 12);
  const emails = Array.from(
    { length: USERS },
    (_, i) => `qa-capacity-${String(i + 1).padStart(4, '0')}@example.invalid`,
  );
  await prisma.user.createMany({
    data: emails.map((email) => ({
      email,
      password: hash,
      role: 'STUDENT' as const,
    })),
    skipDuplicates: true,
  });
  const users = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { id: true, email: true },
    orderBy: { email: 'asc' },
  });

  // Every practice listening clip a free learner can play, in both fake buckets
  // (the backend picks the bucket from the key).
  const assets = await prisma.quizAudioAsset.findMany({
    where: {
      isActive: true,
      question: {
        quiz: { type: 'LISTENING_PRACTICE', publicationStatus: 'PUBLISHED' },
      },
    },
    select: { key: true, question: { select: { quizId: true } } },
  });
  for (const a of assets) {
    await put('harness-public', a.key, CLIP_BYTES);
    await put('harness-private', a.key, CLIP_BYTES);
  }
  const tracks = await prisma.listeningAudioArtifact.findMany({
    where: { r2Key: { not: null } },
    select: { r2Key: true },
  });
  for (const t of tracks) {
    await put('harness-public', t.r2Key!, TRACK_BYTES);
    await put('harness-private', t.r2Key!, TRACK_BYTES);
  }

  const exam = await prisma.toeicExamSet.findFirst({
    where: { publicationStatus: 'PUBLISHED' },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  const out = join(__dirname, 'out');
  mkdirSync(out, { recursive: true });
  writeFileSync(
    join(out, 'capacity-data.json'),
    JSON.stringify({
      password: PASSWORD,
      users,
      examId: exam?.id ?? null,
      listeningQuizIds: [...new Set(assets.map((a) => a.question.quizId))].sort(
        (a, b) => a - b,
      ),
    }),
  );
  console.log(
    `CAPACITY_SEED users=${users.length} clips=${assets.length} tracks=${tracks.length} examId=${exam?.id}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
