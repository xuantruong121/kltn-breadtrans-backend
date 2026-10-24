/**
 * Read-only, deterministic snapshot for the disposable canonical-rehearsal DB.
 * It deliberately records canonical identities and media provenance rather than
 * only aggregate counts, so RUN2 drift is observable before any backup is made.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { resyncSequences } from './db-resync-sequences';

const outputArg = process.argv.find((value) => value.startsWith('--output='));
if (!outputArg) throw new Error('Usage: --output=artifacts/full-rehearsal-runN.json');
const output = resolve(outputArg.slice('--output='.length));
const prisma = new PrismaClient();

const json = (value: unknown) => JSON.parse(JSON.stringify(value));

async function main() {
  const [
    plans,
    courses,
    vocabTopics,
    vocabWordCount,
    quizzes,
    speakingSets,
    speakingExercises,
    grammarTopics,
    grammarQuestionCount,
    toeicExamSets,
    toeicAssessments,
    writingSets,
    sequenceState,
  ] = await Promise.all([
    prisma.plan.findMany({
      orderBy: { id: 'asc' },
      include: { versions: { orderBy: { id: 'asc' }, include: { entitlements: { orderBy: { id: 'asc' } } } } },
    }),
    prisma.course.findMany({
      orderBy: { id: 'asc' },
      include: {
        courseLessons: {
          orderBy: { order: 'asc' },
          include: {
            sections: { orderBy: { order: 'asc' }, select: { id: true, order: true, type: true, heading: true, isRequired: true } },
            exercises: { orderBy: { order: 'asc' }, include: { questions: { orderBy: { order: 'asc' }, select: { id: true, order: true } } } },
            media: { orderBy: { id: 'asc' }, select: { id: true, type: true, url: true, provenance: true, renderStatus: true } },
          },
        },
      },
    }),
    prisma.vocabTopic.findMany({ orderBy: { id: 'asc' }, include: { words: { orderBy: { id: 'asc' }, select: { id: true } } } }),
    prisma.vocabWord.count(),
    prisma.quiz.findMany({ orderBy: { id: 'asc' }, include: { questions: { select: { id: true } } } }),
    prisma.speakingPracticeSet.findMany({ orderBy: { id: 'asc' }, include: { exercises: { orderBy: { order: 'asc' }, select: { id: true } } } }),
    prisma.speakingExercise.findMany({ orderBy: { id: 'asc' }, select: { id: true, practiceSetId: true, order: true, publicationStatus: true, isPremiumContent: true, category: true, taskType: true } }),
    prisma.grammarTopic.findMany({ orderBy: { id: 'asc' }, include: { questions: { orderBy: { order: 'asc' }, select: { id: true, order: true } } } }),
    prisma.grammarQuestion.count(),
    prisma.toeicExamSet.findMany({
      orderBy: { id: 'asc' },
      include: { genericExam: true, groups: { orderBy: [{ part: 'asc' }, { groupOrder: 'asc' }], include: { questions: { orderBy: { questionNumber: 'asc' }, select: { id: true, questionNumber: true } } } } },
    }),
    prisma.toeicAssessment.findMany({ orderBy: { id: 'asc' }, include: { genericExam: true, components: { orderBy: { order: 'asc' } } } }),
    prisma.toeicWritingSet.findMany({ orderBy: { id: 'asc' }, include: { items: { orderBy: { order: 'asc' }, select: { id: true, order: true, taskKind: true, writingQuizId: true } } } }),
    resyncSequences(prisma, true),
  ]);

  // The full L&R canonical set is the only set with the 54-group Listening
  // contract. Practice-by-part rows must remain visible in the broader TOEIC
  // snapshot, but must not dilute this exact 54/54 acceptance assertion.
  const canonicalLrSet = toeicExamSets.find(
    (examSet) => examSet.groups.filter((group) => group.part <= 4).length === 54,
  );
  if (!canonicalLrSet) throw new Error('Canonical TOEIC L&R 54-group set was not found.');
  const listeningAudioMappings = canonicalLrSet.groups
      .filter((group) => group.part <= 4)
      .map((group) => {
        const metadata = (group.mediaMetadata ?? {}) as { audio?: Record<string, unknown> };
        return {
          examSetId: canonicalLrSet.id,
          groupId: group.id,
          part: group.part,
          groupOrder: group.groupOrder,
          questionNumbers: group.questions.map((question) => question.questionNumber),
          audioUrl: group.audioUrl,
          r2Key: metadata.audio?.r2Key ?? null,
          sourceHash: metadata.audio?.sourceHash ?? null,
          scriptVersion: metadata.audio?.scriptVersion ?? null,
          status: metadata.audio?.status ?? null,
          metadata: metadata.audio ?? null,
        };
      });
  const partOneImages = canonicalLrSet.groups.filter((group) => group.part === 1).map((group) => ({
    examSetId: canonicalLrSet.id, groupId: group.id, groupOrder: group.groupOrder, imageUrl: group.imageUrl,
  }));

  const snapshot = {
    schemaVersion: 2,
    stable: {
      plans: plans.map((plan) => ({
        id: plan.id, code: plan.code, displayName: plan.displayName, status: plan.status,
        versions: plan.versions.map((version) => ({
          id: version.id, version: version.version, status: version.status, isCurrent: version.isCurrent,
          durationDays: version.durationDays, priceVnd: version.priceVnd,
          entitlements: version.entitlements.map((entitlement) => ({ id: entitlement.id, featureKey: entitlement.featureKey, enabled: entitlement.enabled, limitValue: entitlement.limitValue, unit: entitlement.unit, period: entitlement.period, scope: json(entitlement.scope) })),
        })),
      })),
      premiumAssignments: {
        quizzes: quizzes.filter((quiz) => quiz.isPremiumContent).map((quiz) => ({ id: quiz.id, title: quiz.title, type: quiz.type, publicationStatus: quiz.publicationStatus, questionIds: quiz.questions.map((question) => question.id) })),
        speakingExercises: speakingExercises.filter((exercise) => exercise.isPremiumContent),
      },
      courses: courses.map((course) => ({
        id: course.id, title: course.title, status: course.status, level: course.level, curriculumType: course.curriculumType, thumbnail: course.thumbnail,
        lessons: course.courseLessons.map((lesson) => ({
          id: lesson.id, slug: lesson.slug, order: lesson.order, title: lesson.title, status: lesson.status, requiresFinalCheck: lesson.requiresFinalCheck, coverImage: lesson.coverImage,
          sections: lesson.sections,
          exercises: lesson.exercises.map((exercise) => ({ id: exercise.id, slug: exercise.slug, order: exercise.order, type: exercise.type, title: exercise.title, required: exercise.required, questionIds: exercise.questions.map((question) => question.id) })),
          media: lesson.media,
        })),
      })),
      vocabulary: { totalWords: vocabWordCount, topics: vocabTopics.map((topic) => ({ id: topic.id, title: topic.title, categoryName: topic.categoryName, totalWords: topic.totalWords, isPro: topic.isPro, publicationStatus: topic.publicationStatus, wordIds: topic.words.map((word) => word.id) })) },
      generalPractice: {
        quizzes: quizzes.map((quiz) => ({ id: quiz.id, title: quiz.title, type: quiz.type, publicationStatus: quiz.publicationStatus, isPremiumContent: quiz.isPremiumContent, courseId: quiz.courseId, practiceTopicId: quiz.practiceTopicId, questionIds: quiz.questions.map((question) => question.id) })),
        speakingSets: speakingSets.map((set) => ({ id: set.id, title: set.title, scope: set.scope, publicationStatus: set.publicationStatus, exerciseIds: set.exercises.map((exercise) => exercise.id) })),
        grammar: { totalQuestions: grammarQuestionCount, topics: grammarTopics.map((topic) => ({ id: topic.id, title: topic.title, level: topic.level, publicationStatus: topic.publicationStatus, questionIds: topic.questions.map((question) => question.id) })) },
      },
      toeic: {
        canonicalLrExamSetId: canonicalLrSet.id,
        examSets: toeicExamSets.map((examSet) => ({
          id: examSet.id, examId: examSet.examId, title: examSet.title, type: examSet.type, publicationStatus: examSet.publicationStatus,
          genericExam: examSet.genericExam ? { id: examSet.genericExam.id, familyCode: examSet.genericExam.familyCode, variantCode: examSet.genericExam.variantCode, templateKey: examSet.genericExam.templateKey, publicationStatus: examSet.genericExam.publicationStatus } : null,
          groups: examSet.groups.map((group) => ({ id: group.id, part: group.part, groupOrder: group.groupOrder, audioUrl: group.audioUrl, imageUrl: group.imageUrl, questionIds: group.questions.map((question) => question.id), mediaMetadata: json(group.mediaMetadata) })),
        })),
        listeningAudioMappings,
        partOneImages,
        assessments: toeicAssessments.map((assessment) => ({ id: assessment.id, examId: assessment.examId, title: assessment.title, productFamily: assessment.productFamily, publicationStatus: assessment.publicationStatus, componentIds: assessment.components.map((component) => ({ id: component.id, kind: component.kind, order: component.order, lrExamSetId: component.lrExamSetId, speakingPracticeSetId: component.speakingPracticeSetId, writingSetId: component.writingSetId })) })),
        writingSets: writingSets.map((set) => ({ id: set.id, title: set.title, publicationStatus: set.publicationStatus, version: set.version, items: set.items })),
      },
      sequenceState,
    },
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ output, listeningMappings: listeningAudioMappings.length, partOneImages: partOneImages.length, sequenceState }, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
