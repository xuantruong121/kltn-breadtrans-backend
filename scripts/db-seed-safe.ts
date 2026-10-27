/**
 * Safe wrapper around the canonical seed.
 *
 * `prisma/seed.ts` is written for *reconstruction* of a fresh development
 * database, not for topping up a populated one. It contains destructive
 * cleanup that is harmless on an empty database but damaging otherwise — most
 * notably:
 *
 *   prisma.class.deleteMany({ where: { name: { notIn: seededOfferingNames } } })
 *
 * which deletes every Class not named by the seed (and their Payment rows).
 *
 * This wrapper runs the database-target safety guard, then refuses to seed a
 * database that holds data the seed would destroy, unless the operator
 * explicitly passes --reconstruct.
 *
 * Usage:
 *   npx ts-node scripts/db-seed-safe.ts              # refuse if risky data exists
 *   npx ts-node scripts/db-seed-safe.ts --reconstruct # acknowledged reconstruction
 */
import 'dotenv/config';
import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { assertDatabaseSafety } from './db-safety-guard';
import { resyncSequences } from './db-resync-sequences';

/** Offering names the seed owns; anything else would be deleted by it. */
const SEEDED_OFFERING_NAMES = ['Grammar & Vocabulary — Open Practice'];

function refuse(lines: string[]): never {
  console.error('');
  console.error('==================================================');
  console.error(' SEED REFUSED');
  console.error('==================================================');
  for (const line of lines) console.error(` ${line}`);
  console.error('');
  console.error(' Re-run with --reconstruct only if this database is meant');
  console.error(' to be rebuilt from scratch (data loss is expected).');
  console.error('==================================================');
  console.error('');
  process.exit(1);
}

async function main() {
  const reconstruct = process.argv.includes('--reconstruct');

  // 1. Never seed a non-local or unexpected database.
  assertDatabaseSafety(process.argv.slice(2));

  const prisma = new PrismaClient();
  try {
    // 2. Measure what the seed's destructive cleanup would remove.
    const foreignClasses = await prisma.class.count({
      where: { name: { notIn: SEEDED_OFFERING_NAMES } },
    });
    const exams = await prisma.exam.count();
    const assessments = await prisma.toeicAssessment.count();
    const attempts = await prisma.toeicAttempt.count();
    const submissions = await prisma.speakingSubmission.count();

    const risky =
      foreignClasses > 0 ||
      exams > 0 ||
      assessments > 0 ||
      attempts > 0 ||
      submissions > 0;

    console.log(
      'Seed pre-flight (rows the canonical seed may destroy or shadow):',
    );
    console.log(`  Class rows not owned by the seed : ${foreignClasses}`);
    console.log(`  Exam rows (runtime-created)      : ${exams}`);
    console.log(`  ToeicAssessment rows             : ${assessments}`);
    console.log(`  ToeicAttempt rows                : ${attempts}`);
    console.log(`  SpeakingSubmission rows          : ${submissions}`);

    if (risky && !reconstruct)
      refuse([
        'This database already holds data the canonical seed can destroy.',
        'The seed deletes every Class whose name it does not own, plus the',
        'Payment rows attached to them, and rebuilds TOEIC question groups.',
      ]);

    if (risky)
      console.log('\n--reconstruct given: proceeding despite existing data.');

    // 3. Run the canonical seed unchanged.
    console.log('\nRunning canonical seed (prisma db seed) ...');
    // prisma/seed.ts refuses a populated database by itself; --reconstruct
    // acknowledges this one database by name, never a protected one.
    const [{ db }] = await prisma.$queryRawUnsafe<{ db: string }[]>(
      'SELECT current_database() AS db',
    );
    execSync('npx prisma db seed', {
      stdio: 'inherit',
      env: {
        ...process.env,
        ...(reconstruct ? { SEED_RECONSTRUCT_DATABASE: db } : {}),
      },
    });

    // 4. The seed writes explicit primary keys (stable TOEIC group ids keep
    //    media object keys valid), which leaves identity sequences behind
    //    max(id). Without this step the next create() fails on a duplicate id.
    console.log('\nRe-synchronising identity sequences ...');
    await resyncSequences(prisma);

    console.log('\nSEED OK');
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(
    'Safe seed failed:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
