/**
 * Repairs canonical learner catalog visibility after a data-only recovery.
 *
 * This script deliberately changes publication flags only. It does not create
 * vocabulary, speaking submissions, TOEIC sources, or learner progress.
 */
import 'dotenv/config';
import { PrismaClient, QuizPublicationStatus } from '@prisma/client';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

async function main() {
  const before = await Promise.all([
    prisma.vocabTopic.count({
      where: {
        categoryName: { not: 'SYSTEM_DICTIONARY' },
        publicationStatus: QuizPublicationStatus.PUBLISHED,
      },
    }),
    prisma.speakingExercise.count({
      where: { practiceSetId: null, publicationStatus: QuizPublicationStatus.PUBLISHED },
    }),
  ]);

  if (apply) {
    await prisma.$transaction([
      prisma.vocabTopic.updateMany({
        where: { categoryName: { not: 'SYSTEM_DICTIONARY' } },
        data: { publicationStatus: QuizPublicationStatus.PUBLISHED },
      }),
      prisma.speakingExercise.updateMany({
        where: { practiceSetId: null },
        data: { publicationStatus: QuizPublicationStatus.PUBLISHED },
      }),
    ]);
  }

  const after = await Promise.all([
    prisma.vocabTopic.count({
      where: {
        categoryName: { not: 'SYSTEM_DICTIONARY' },
        publicationStatus: QuizPublicationStatus.PUBLISHED,
      },
    }),
    prisma.speakingExercise.count({
      where: { practiceSetId: null, publicationStatus: QuizPublicationStatus.PUBLISHED },
    }),
    prisma.speakingPracticeSet.count({
      where: { scope: 'EXAM_INTERNAL' },
    }),
  ]);

  console.log(JSON.stringify({ mode: apply ? 'APPLY' : 'CHECK', before: {
    visibleTopics: before[0], visibleStandaloneSpeaking: before[1],
  }, after: {
    visibleTopics: after[0], visibleStandaloneSpeaking: after[1],
    examInternalSetsUntouched: after[2],
  } }, null, 2));
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => prisma.$disconnect());
