/**
 * Read-only inventory of current learner-facing data, compared against the
 * baselines recovery already proved (spec §14-§15).
 *
 * A difference is reported as a difference, not as recovery drift: later
 * intentional development is a legitimate explanation and needs evidence
 * either way.
 *
 * Writes artifacts/learner-data-inventory.json. Mutates nothing.
 *
 * Usage: npx ts-node scripts/audit-learner-data-inventory.ts
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const OUT = join(process.cwd(), 'artifacts', 'learner-data-inventory.json');

/** Baselines carried forward from the recovery passes. */
const COURSE_BASELINE: Record<
  number,
  { lessons: number; sections: number; exercises: number; media: number }
> = {
  1: { lessons: 8, sections: 61, exercises: 16, media: 0 },
  8: { lessons: 8, sections: 58, exercises: 16, media: 8 },
  12: { lessons: 8, sections: 56, exercises: 16, media: 8 },
};
const FLASHCARD_BASELINE = { topics: 8, words: 353 };
const SPEAKING_BASELINE = { standalonePublished: 30, examInternal: 2 };
const GRAMMAR_BASELINE = { topics: 12, questions: 60, allDraft: true };

async function main() {
  const prisma = new PrismaClient();
  try {
    // ---------------------------------------------------------------- plans
    const plans = await prisma.plan.findMany({
      include: {
        versions: {
          where: { isCurrent: true, status: 'PUBLISHED' },
          include: { entitlements: true },
        },
      },
      orderBy: { code: 'asc' },
    });
    const planState = plans.map((plan) => ({
      code: plan.code,
      status: plan.status,
      currentVersion: plan.versions[0]
        ? {
            id: plan.versions[0].id,
            priceVnd: plan.versions[0].priceVnd,
            durationDays: plan.versions[0].durationDays,
            entitlements: plan.versions[0].entitlements.length,
          }
        : null,
    }));

    // -------------------------------------------------------------- courses
    const courses = await prisma.course.findMany({
      select: {
        id: true,
        title: true,
        status: true,
        _count: { select: { lessons: true, courseLessons: true } },
        courseLessons: {
          select: {
            id: true,
            status: true,
            _count: {
              select: { sections: true, exercises: true, media: true },
            },
          },
        },
      },
      orderBy: { id: 'asc' },
    });
    const courseState = courses.map((course) => {
      const sections = course.courseLessons.reduce(
        (s, l) => s + l._count.sections,
        0,
      );
      const exercises = course.courseLessons.reduce(
        (s, l) => s + l._count.exercises,
        0,
      );
      const media = course.courseLessons.reduce(
        (s, l) => s + l._count.media,
        0,
      );
      const incomplete = course.courseLessons.filter(
        (l) =>
          l.status === 'PUBLISHED' &&
          (l._count.sections === 0 || l._count.exercises === 0),
      ).length;
      const baseline = COURSE_BASELINE[course.id];
      return {
        id: course.id,
        title: course.title,
        status: course.status,
        legacyLessons: course._count.lessons,
        courseLessons: course._count.courseLessons,
        sections,
        exercises,
        media,
        incompletePublishedLessons: incomplete,
        baseline: baseline ?? null,
        matchesBaseline: baseline
          ? course._count.courseLessons === baseline.lessons &&
            sections === baseline.sections &&
            exercises === baseline.exercises &&
            media === baseline.media
          : null,
      };
    });

    // ----------------------------------------------------------- flashcards
    const vocabTopics = await prisma.vocabTopic.findMany({
      select: {
        id: true,
        title: true,
        publicationStatus: true,
        isPro: true,
        totalWords: true,
        _count: { select: { words: true } },
      },
      orderBy: { id: 'asc' },
    });
    const flashcardState = {
      topics: vocabTopics.length,
      publishedTopics: vocabTopics.filter(
        (t) => t.publicationStatus === 'PUBLISHED',
      ).length,
      words: vocabTopics.reduce((s, t) => s + t._count.words, 0),
      countDrift: vocabTopics.filter((t) => t.totalWords !== t._count.words)
        .length,
      baseline: FLASHCARD_BASELINE,
      rows: vocabTopics.map((t) => ({
        id: t.id,
        title: t.title,
        publicationStatus: t.publicationStatus,
        isPro: t.isPro,
        words: t._count.words,
        totalWordsField: t.totalWords,
      })),
    };

    // ------------------------------------------------------------ listening
    const listening = await prisma.quiz.findMany({
      where: { type: 'LISTENING_PRACTICE' },
      select: {
        id: true,
        title: true,
        publicationStatus: true,
        isPremiumContent: true,
        _count: { select: { questions: true } },
        listeningAudioArtifacts: {
          select: { version: true, status: true, timeline: true },
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
      orderBy: { id: 'asc' },
    });

    // ------------------------------------------------------------- speaking
    const speaking = await prisma.speakingExercise.findMany({
      select: {
        id: true,
        publicationStatus: true,
        isPremiumContent: true,
        audioUrl: true,
        imageUrl: true,
        taskType: true,
        practiceSet: { select: { scope: true } },
      },
    });
    const speakingState = {
      total: speaking.length,
      standalonePublished: speaking.filter(
        (e) =>
          e.publicationStatus === 'PUBLISHED' &&
          e.practiceSet?.scope !== 'EXAM_INTERNAL',
      ).length,
      examInternal: speaking.filter(
        (e) => e.practiceSet?.scope === 'EXAM_INTERNAL',
      ).length,
      withReferenceAudio: speaking.filter((e) => e.audioUrl).length,
      describePictureMissingImage: speaking.filter(
        (e) => e.taskType === 'DESCRIBE_PICTURE' && !e.imageUrl,
      ).length,
      premium: speaking.filter((e) => e.isPremiumContent).length,
      baseline: SPEAKING_BASELINE,
    };

    // -------------------------------------------------- reading / writing
    const byType = await prisma.quiz.groupBy({
      by: ['type', 'publicationStatus'],
      _count: { _all: true },
    });

    // -------------------------------------------------------------- grammar
    const grammarTopics = await prisma.grammarTopic.findMany({
      select: {
        id: true,
        publicationStatus: true,
        _count: { select: { questions: true } },
      },
    });
    const grammarState = {
      topics: grammarTopics.length,
      published: grammarTopics.filter(
        (t) => t.publicationStatus === 'PUBLISHED',
      ).length,
      questions: grammarTopics.reduce((s, t) => s + t._count.questions, 0),
      allDraft: grammarTopics.every((t) => t.publicationStatus === 'DRAFT'),
      baseline: GRAMMAR_BASELINE,
    };

    // ----------------------------------------------------------------- toeic
    const toeic = {
      examSets: await prisma.toeicExamSet.count(),
      questions: await prisma.toeicQuestion.count(),
      groupsWithAudio: await prisma.toeicQuestionGroup.count({
        where: { part: { lte: 4 }, NOT: { audioUrl: null } },
      }),
      part1WithImage: await prisma.toeicQuestionGroup.count({
        where: { part: 1, NOT: { imageUrl: null } },
      }),
      assessments: await prisma.toeicAssessment.count(),
      publishedAssessments: await prisma.toeicAssessment.count({
        where: { publicationStatus: 'PUBLISHED' },
      }),
      components: await prisma.toeicAssessmentComponent.count(),
      writingSetItems: await prisma.toeicWritingSetItem.count(),
    };

    // ------------------------------------------------------------ diagnostic
    const diagnostic = {
      assessments: await prisma.diagnosticAssessment.count().catch(() => null),
      attempts: await prisma.diagnosticAttempt.count().catch(() => null),
    };

    const premium = {
      quizzesPremium: await prisma.quiz.count({
        where: { isPremiumContent: true },
      }),
      quizzesTotal: await prisma.quiz.count(),
      speakingPremium: speakingState.premium,
      speakingTotal: speaking.length,
    };

    const payload = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      readOnly: true,
      plans: planState,
      courses: courseState,
      flashcards: flashcardState,
      listening: listening.map((quiz) => ({
        id: quiz.id,
        title: quiz.title,
        publicationStatus: quiz.publicationStatus,
        premium: quiz.isPremiumContent,
        questions: quiz._count.questions,
        latestArtifact: quiz.listeningAudioArtifacts[0]
          ? {
              version: quiz.listeningAudioArtifacts[0].version,
              status: quiz.listeningAudioArtifacts[0].status,
              timelineEntries: Array.isArray(
                quiz.listeningAudioArtifacts[0].timeline,
              )
                ? (quiz.listeningAudioArtifacts[0].timeline as unknown[]).length
                : 0,
            }
          : null,
      })),
      speaking: speakingState,
      quizzesByTypeAndStatus: byType.map((row) => ({
        type: row.type,
        publicationStatus: row.publicationStatus,
        count: row._count._all,
      })),
      grammar: grammarState,
      toeic,
      diagnostic,
      premium,
    };

    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`);

    console.log(`inventory written: ${OUT}\n`);
    console.log('PLANS');
    for (const plan of planState)
      console.log(
        `  ${plan.code.padEnd(5)} ${plan.status} ${
          plan.currentVersion
            ? `v${plan.currentVersion.id} ${plan.currentVersion.priceVnd}đ/${plan.currentVersion.durationDays}d ent=${plan.currentVersion.entitlements}`
            : 'no current version'
        }`,
      );
    console.log('\nCOURSES (vs baseline)');
    for (const course of courseState)
      console.log(
        `  ${String(course.id).padEnd(3)} lessons=${course.courseLessons} sections=${String(course.sections).padEnd(3)} exercises=${String(course.exercises).padEnd(3)} media=${String(course.media).padEnd(2)} incomplete=${course.incompletePublishedLessons} baselineMatch=${course.matchesBaseline} ${course.title}`,
      );
    console.log('\nFLASHCARDS');
    console.log(
      `  topics=${flashcardState.topics} published=${flashcardState.publishedTopics} words=${flashcardState.words} countDrift=${flashcardState.countDrift} (baseline ${FLASHCARD_BASELINE.topics}/${FLASHCARD_BASELINE.words})`,
    );
    console.log('\nSPEAKING');
    console.log(
      `  total=${speakingState.total} standalonePublished=${speakingState.standalonePublished} examInternal=${speakingState.examInternal} referenceAudio=${speakingState.withReferenceAudio} premium=${speakingState.premium} (baseline ${SPEAKING_BASELINE.standalonePublished}/${SPEAKING_BASELINE.examInternal})`,
    );
    console.log('\nGRAMMAR');
    console.log(
      `  topics=${grammarState.topics} published=${grammarState.published} questions=${grammarState.questions} allDraft=${grammarState.allDraft}`,
    );
    console.log('\nQUIZZES BY TYPE/STATUS');
    for (const row of payload.quizzesByTypeAndStatus)
      console.log(
        `  ${String(row.type).padEnd(20)} ${String(row.publicationStatus).padEnd(10)} ${row.count}`,
      );
    console.log('\nTOEIC');
    console.log(`  ${JSON.stringify(toeic)}`);
    console.log('\nPREMIUM');
    console.log(`  ${JSON.stringify(premium)}`);
    console.log('\nLISTENING');
    for (const quiz of payload.listening)
      console.log(
        `  ${String(quiz.id).padEnd(3)} ${String(quiz.publicationStatus).padEnd(10)} prem=${String(quiz.premium).padEnd(5)} q=${String(quiz.questions).padEnd(3)} artifact=${
          quiz.latestArtifact
            ? `v${quiz.latestArtifact.version} ${quiz.latestArtifact.status} timeline=${quiz.latestArtifact.timelineEntries}`
            : 'none'
        }`,
      );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(
    'Data inventory failed:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
