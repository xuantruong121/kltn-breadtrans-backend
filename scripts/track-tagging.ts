/**
 * One-off career tags for the practice content older than the F8 drafts
 * (F8.1). Each choice was made from the item's own text. Only items the
 * recommender can show are listed: it needs a level tag in the title.
 * Adds tags, never removes one; the rollback file names what was added.
 * Track codes are rows of LearningTrack (2026-11-21); speaking set tags go
 * on the set (SpeakingSetTrack), quiz tags stay in ContentTrackTag.
 *
 * A non-harness target needs SKILL_PRACTICE_APPLY_AUTHORIZED=apply.
 *
 * Usage: npx ts-node --transpile-only scripts/track-tagging.ts --target <url|env:DATABASE_URL>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const DIR = join('artifacts', 'skill-practice-v1');
const ADMIN_ID = 17;

const GENERAL = ['GENERAL'];
const OFFICE = ['OFFICE_BUSINESS'];
const HOSPITALITY = ['HOSPITALITY_TOURISM'];
const CUSTOMER = ['SALES_CUSTOMER_SERVICE'];
const ACADEMIC = ['STUDENT_ACADEMIC'];

const QUIZZES: Record<number, string[]> = {
  1: GENERAL,
  5: OFFICE,
  9: GENERAL,
  10: HOSPITALITY,
  11: OFFICE,
  12: GENERAL,
  23: GENERAL,
  24: HOSPITALITY,
  25: OFFICE,
  26: HOSPITALITY,
  27: OFFICE,
  28: CUSTOMER,
  2: GENERAL,
  6: OFFICE,
  13: GENERAL,
  14: GENERAL,
  15: OFFICE,
  16: ACADEMIC,
  3: GENERAL,
  4: OFFICE,
  7: CUSTOMER,
  17: GENERAL,
  18: OFFICE,
  19: OFFICE,
  45: GENERAL,
  46: OFFICE,
};

/** The same tags as `tracks` in prisma/data/speaking-practice-sets.ts (the seed). */
const SETS: Record<string, string[]> = {
  'practice-read-aloud-a1-a2': GENERAL,
  'practice-read-aloud-b1-b2': OFFICE,
  'practice-pronunciation-b1': OFFICE,
  'practice-question-response-a2': GENERAL,
  'practice-question-response-b1-b2': [...ACADEMIC, ...OFFICE],
  'practice-opinion-b1-b2': GENERAL,
  'practice-describe-picture-b1': GENERAL,
  'practice-information-response-b1-b2': OFFICE,
  'practice-opinion-c1': GENERAL,
};

async function main() {
  const i = process.argv.indexOf('--target');
  const raw = i > 0 ? process.argv[i + 1] : undefined;
  const url = raw === 'env:DATABASE_URL' ? process.env.DATABASE_URL : raw;
  if (!url) throw new Error('--target <url|env:DATABASE_URL> is required');
  const harness = /@127\.0\.0\.1:5460\//.test(url);
  if (!harness && process.env.SKILL_PRACTICE_APPLY_AUTHORIZED !== 'apply')
    throw new Error(
      'REFUSED: non-harness target needs SKILL_PRACTICE_APPLY_AUTHORIZED=apply',
    );
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const ids = Object.keys(QUIZZES).map(Number);
    const quizzes = await prisma.quiz.count({ where: { id: { in: ids } } });
    if (quizzes !== ids.length) throw new Error(`${quizzes} quizzes found`);
    const sets = await prisma.speakingPracticeSet.count({
      where: { id: { in: Object.keys(SETS) } },
    });
    if (sets !== Object.keys(SETS).length)
      throw new Error(`${sets} speaking sets found`);

    const quizRows = Object.entries(QUIZZES).flatMap(([id, tracks]) =>
      tracks.map((track) => ({
        contentType: 'QUIZ' as const,
        contentId: Number(id),
        track,
        createdById: ADMIN_ID,
      })),
    );
    const setRows = Object.entries(SETS).flatMap(([setId, tracks]) =>
      tracks.map((track) => ({ setId, track, createdById: ADMIN_ID })),
    );
    mkdirSync(DIR, { recursive: true });
    const file = join(
      DIR,
      `track-tagging-${harness ? 'harness' : 'target'}.json`,
    );
    writeFileSync(
      file,
      JSON.stringify({ quiz: quizRows, speakingSet: setRows }, null, 1),
    );
    const quiz = await prisma.contentTrackTag.createMany({
      data: quizRows,
      skipDuplicates: true,
    });
    const set = await prisma.speakingSetTrack.createMany({
      data: setRows,
      skipDuplicates: true,
    });
    console.log(
      `tags added: quiz ${quiz.count} of ${quizRows.length}, speaking set ${set.count} of ${setRows.length}; rollback ${file}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
});
