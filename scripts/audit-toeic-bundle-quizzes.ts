/**
 * Read-only: which quizzes are legitimate TOEIC 4-skill bundles?
 *
 * /toeic/bundle/:quizId serves a Quiz whose bilingualContent carries
 * isBundle:true plus the linked exam set and S&W quiz. This lists them so the
 * bundle back-link can be exercised against a real one instead of a guess.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

void (async () => {
  try {
    const quizzes = await prisma.quiz.findMany({
      select: {
        id: true,
        title: true,
        publicationStatus: true,
        bilingualContent: true,
      },
      orderBy: { id: 'asc' },
    });
    const bundles = quizzes.filter((quiz) => {
      const meta =
        quiz.bilingualContent &&
        typeof quiz.bilingualContent === 'object' &&
        !Array.isArray(quiz.bilingualContent)
          ? (quiz.bilingualContent as Record<string, unknown>)
          : {};
      return (
        meta.isBundle === true &&
        (meta.examFormat === 'TOEIC_4_SKILLS' ||
          meta.examFormat === 'FOUR_SKILL')
      );
    });
    console.log(`bundle quizzes found: ${bundles.length}`);
    for (const quiz of bundles) {
      const meta = quiz.bilingualContent as Record<string, unknown>;
      console.log(
        `  quiz#${quiz.id} ${quiz.publicationStatus} lrExamSet=${String(
          meta.listeningReadingExamSetId,
        )} swQuiz=${String(meta.speakingWritingQuizId)} "${quiz.title}"`,
      );
    }
    if (!bundles.length) {
      console.log(
        '\nNo bundle quiz exists, so /toeic/bundle/:quizId has no reachable learner instance.',
      );
    }
  } finally {
    await prisma.$disconnect();
  }
})();
