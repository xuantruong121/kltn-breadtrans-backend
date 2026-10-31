/**
 * One-off career tags for the practice content older than the F8 drafts
 * (F8.1). Each choice was made from the item's own text. Only items the
 * recommender can show are listed: it needs a level tag in the title.
 * Adds tags, never removes one; the rollback file names what was added.
 *
 * A non-harness target needs SKILL_PRACTICE_APPLY_AUTHORIZED=apply.
 *
 * Usage: npx ts-node --transpile-only scripts/track-tagging.ts --target <url|env:DATABASE_URL>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type LearningTrack, PrismaClient } from '@prisma/client';

const DIR = join('artifacts', 'skill-practice-v1');
const ADMIN_ID = 17;

const GENERAL: LearningTrack[] = ['GENERAL'];
const OFFICE: LearningTrack[] = ['OFFICE_BUSINESS'];
const HOSPITALITY: LearningTrack[] = ['HOSPITALITY_TOURISM'];
const CUSTOMER: LearningTrack[] = ['SALES_CUSTOMER_SERVICE'];
const ACADEMIC: LearningTrack[] = ['STUDENT_ACADEMIC'];

const QUIZZES: Record<number, LearningTrack[]> = {
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

const SETS: Record<string, LearningTrack[]> = {
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
    const sets = await prisma.speakingPracticeSet.findMany({
      where: { id: { in: Object.keys(SETS) } },
      select: {
        id: true,
        // The key the recommender reads a set by (learning-path.catalog.ts).
        exercises: {
          where: { publicationStatus: 'PUBLISHED' },
          orderBy: [{ order: 'asc' }, { id: 'asc' }],
          take: 1,
          select: { id: true },
        },
      },
    });
    if (sets.length !== Object.keys(SETS).length)
      throw new Error(`${sets.length} speaking sets found`);

    const rows = [
      ...Object.entries(QUIZZES).flatMap(([id, tracks]) =>
        tracks.map((track) => ({
          contentType: 'QUIZ' as const,
          contentId: Number(id),
          track,
          createdById: ADMIN_ID,
        })),
      ),
      ...sets.flatMap((set) =>
        SETS[set.id].map((track) => {
          if (!set.exercises[0]) throw new Error(`${set.id} has no exercise`);
          return {
            contentType: 'SPEAKING_SET' as const,
            contentId: set.exercises[0].id,
            track,
            createdById: ADMIN_ID,
          };
        }),
      ),
    ];
    mkdirSync(DIR, { recursive: true });
    const file = join(
      DIR,
      `track-tagging-${harness ? 'harness' : 'target'}.json`,
    );
    writeFileSync(file, JSON.stringify(rows, null, 1));
    const { count } = await prisma.contentTrackTag.createMany({
      data: rows,
      skipDuplicates: true,
    });
    console.log(`tags added ${count} of ${rows.length}; rollback ${file}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
});
