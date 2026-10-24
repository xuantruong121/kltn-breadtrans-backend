/**
 * Relink the whole-quiz ("full script") listening audio artifacts.
 *
 * Forensics behind this script
 * ---------------------------
 * The learner control that plays a whole dictation script answered 503 for
 * every listening quiz because `ListeningAudioArtifact` held 0 rows. That was
 * first mistaken for a feature that had never been authored, but the rendered
 * audio is still in object storage:
 *
 *   catalog/listening/practice/quiz-23/audio/v1..v6/full.mp3
 *   catalog/listening/practice/quiz-24/audio/v1..v6/full.mp3
 *   catalog/listening/practice/quiz-28/audio/v1/full.mp3
 *   premium/listening/quiz-25/artifact-v1..v6/full.mp3   (moved by the premium rollout)
 *
 * Those keys match the authoring service's own naming, and acoustic analysis
 * shows two clearly separated voice clusters inside them, so they are the
 * genuine pre-incident artifacts. Only the database rows were lost, which makes
 * this a metadata relink and not a re-synthesis: no TTS is called.
 *
 * Idempotent, and safe to run as part of canonical reconstruction.
 *
 * Usage:
 *   npx ts-node scripts/relink-whole-quiz-listening-artifacts.ts
 *   npx ts-node scripts/relink-whole-quiz-listening-artifacts.ts --dry-run
 */
import 'dotenv/config';
import { PrismaClient, QuizType } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { R2Service } from '../src/modules/upload/r2.service';
import { UploadService } from '../src/modules/upload/upload.service';
import { ListeningAudioAuthoringService } from '../src/modules/quiz/listening-audio-authoring.service';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  // The service only needs Prisma and UploadService, so it is wired directly
  // instead of booting the whole application (which would also start Redis and
  // the job queues this script has no use for).
  const prisma = new PrismaClient() as unknown as PrismaService;
  const authoring = new ListeningAudioAuthoringService(
    prisma,
    new UploadService(new R2Service()),
  );
  try {
    const quizzes = await prisma.quiz.findMany({
      where: {
        type: QuizType.LISTENING_PRACTICE,
        publicationStatus: 'PUBLISHED',
      },
      select: { id: true, title: true },
      orderBy: { id: 'asc' },
    });

    console.log(
      `whole-quiz listening artifact relink${dryRun ? ' (dry run)' : ''}: ${quizzes.length} published listening quizzes`,
    );

    const summary = {
      relinked: 0,
      alreadyPublished: 0,
      noSurvivingObject: 0,
      failed: 0,
    };

    for (const quiz of quizzes) {
      if (dryRun) {
        // Report what exists without writing, by asking for the current row.
        const current = await prisma.listeningAudioArtifact.findFirst({
          where: { quizId: quiz.id, status: 'PUBLISHED' },
          select: { version: true, r2Key: true },
        });
        console.log(
          `  quiz ${String(quiz.id).padEnd(3)} published artifact: ${current ? `v${current.version} ${current.r2Key}` : 'NONE'}`,
        );
        continue;
      }
      try {
        const result = await authoring.relinkPublishedArtifactFromStorage(
          quiz.id,
        );
        if (result.status === 'RELINKED') summary.relinked++;
        else if (result.status === 'ALREADY_PUBLISHED')
          summary.alreadyPublished++;
        else if (result.status === 'NO_SURVIVING_OBJECT')
          summary.noSurvivingObject++;
        console.log(
          `  quiz ${String(quiz.id).padEnd(3)} ${result.status.padEnd(20)} ${result.r2Key ?? ''} ${result.bytes ? `(${result.bytes} bytes)` : ''}`,
        );
      } catch (error) {
        summary.failed++;
        console.log(
          `  quiz ${String(quiz.id).padEnd(3)} ERROR ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    if (!dryRun) {
      console.log(`\n${JSON.stringify(summary)}`);
      const published = await prisma.listeningAudioArtifact.count({
        where: { status: 'PUBLISHED' },
      });
      console.log(`published artifacts now: ${published}`);
      console.log(`WHOLE_QUIZ_AUDIO_RELINK_FAILURES=${summary.failed}`);
    }
  } finally {
    await (prisma as unknown as PrismaClient).$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(
    'Whole-quiz artifact relink failed:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
