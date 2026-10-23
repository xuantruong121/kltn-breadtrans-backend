/**
 * Verify the reconstructed canonical baseline using the PRODUCTION validators
 * (no re-implemented checks): validateToeicExam, toeicSpeakingContractErrors
 * and validateToeicWritingStructure.
 *
 * Usage: npx ts-node scripts/verify-canonical-baseline.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { validateToeicExam } from '../src/modules/toeic/toeic.validation';
import { toeicSpeakingContractErrors } from '../src/modules/speaking/toeic-speaking-contract';
import { validateToeicWritingStructure } from '../src/modules/writing/toeic-writing-set.contract';

async function main() {
  const prisma = new PrismaClient();
  try {
    // ---------------------------------------------------------------- L&R
    const lr = await prisma.toeicExamSet.findUnique({
      where: { id: 1 },
      include: {
        genericExam: true,
        groups: {
          include: { questions: { orderBy: { questionNumber: 'asc' } } },
          orderBy: [{ part: 'asc' }, { groupOrder: 'asc' }],
        },
      },
    });
    if (!lr) throw new Error('ToeicExamSet 1 missing');

    const validation = validateToeicExam(lr);
    const listening = lr.groups.filter((group) => group.part <= 4);
    const withAudio = listening.filter((group) => group.audioUrl);
    const part1 = lr.groups.filter((group) => group.part === 1);
    const part1WithImage = part1.filter((group) => group.imageUrl);
    const partCounts = [1, 2, 3, 4, 5, 6, 7].map((part) => ({
      part,
      questions: lr.groups
        .filter((group) => group.part === part)
        .reduce((sum, group) => sum + group.questions.length, 0),
    }));

    console.log('=== L&R CANONICAL BASELINE (ToeicExamSet 1) ===');
    console.log(
      `  owning Exam            : ${lr.genericExam ? `#${lr.genericExam.id} (${lr.genericExam.publicationStatus})` : 'MISSING'}`,
    );
    console.log(`  publicationStatus      : ${lr.publicationStatus}`);
    console.log(`  total questions        : ${validation.counts.total}`);
    console.log(
      `  part distribution      : ${partCounts.map((p) => `P${p.part}=${p.questions}`).join(' ')}`,
    );
    console.log(`  Listening groups       : ${listening.length}`);
    console.log(
      `  Listening with audio   : ${withAudio.length}/${listening.length}`,
    );
    console.log(
      `  Part 1 with image      : ${part1WithImage.length}/${part1.length}`,
    );
    const byCode = validation.issues.reduce<Record<string, number>>(
      (acc, issue) => {
        acc[issue.code] = (acc[issue.code] ?? 0) + 1;
        return acc;
      },
      {},
    );
    console.log(
      `  validation issues      : ${validation.issues.length} ${JSON.stringify(byCode)}`,
    );
    console.log(`  learnerReady           : ${validation.learnerReady}`);

    // ------------------------------------------------------- S&W / 4 Skills
    const assessments = await prisma.toeicAssessment.findMany({
      include: {
        genericExam: true,
        components: {
          orderBy: { order: 'asc' },
          include: {
            lrExamSet: { select: { id: true, title: true } },
            speakingPracticeSet: {
              include: {
                exercises: {
                  orderBy: { order: 'asc' },
                  include: { stimulus: true },
                },
              },
            },
            writingSet: { include: { items: { orderBy: { order: 'asc' } } } },
          },
        },
      },
      orderBy: { id: 'asc' },
    });

    for (const assessment of assessments) {
      console.log(
        `\n=== ${assessment.productFamily} (Assessment #${assessment.id}, Exam #${assessment.examId}) ===`,
      );
      console.log(
        `  components             : ${assessment.components.length} [${assessment.components.map((c) => `${c.order}:${c.kind}`).join(', ')}]`,
      );

      const dangling = assessment.components.filter(
        (component) =>
          !component.lrExamSet &&
          !component.speakingPracticeSet &&
          !component.writingSet,
      );
      console.log(`  dangling components    : ${dangling.length}`);

      const speakingComponent = assessment.components.find(
        (c) => c.speakingPracticeSet,
      );
      if (speakingComponent?.speakingPracticeSet) {
        const set = speakingComponent.speakingPracticeSet;
        const errors = toeicSpeakingContractErrors(set);
        const dist = set.exercises.reduce<Record<string, number>>((acc, ex) => {
          acc[ex.taskType ?? 'NULL'] = (acc[ex.taskType ?? 'NULL'] ?? 0) + 1;
          return acc;
        }, {});
        console.log(
          `  Speaking source        : ${set.id} (scope=${set.scope})`,
        );
        console.log(
          `  Speaking tasks         : ${set.exercises.length}/11 ${JSON.stringify(dist)}`,
        );
        console.log(
          `  Speaking contract      : ${errors.length === 0 ? 'VALID' : `${errors.length} issues`}`,
        );
        if (errors.length)
          errors.slice(0, 5).forEach((e) => console.log(`      - ${e}`));
      }

      const writingComponent = assessment.components.find((c) => c.writingSet);
      if (writingComponent?.writingSet) {
        const set = writingComponent.writingSet;
        const result = validateToeicWritingStructure(set.items);
        console.log(`  Writing source         : #${set.id}`);
        console.log(
          `  Writing tasks          : ${set.items.length}/8 ${JSON.stringify(result.counts)}`,
        );
        console.log(
          `  Writing contract       : ${result.valid ? 'VALID' : `${result.issues.length} issues`}`,
        );
        if (!result.valid)
          result.issues.slice(0, 5).forEach((e) => console.log(`      - ${e}`));
      }

      const lrComponent = assessment.components.find((c) => c.lrExamSet);
      if (lrComponent?.lrExamSet)
        console.log(
          `  L&R component resolves : ToeicExamSet #${lrComponent.lrExamSet.id}`,
        );
    }

    // --------------------------------------------------------------- counts
    const counts = {
      User: await prisma.user.count(),
      Course: await prisma.course.count(),
      Lesson: await prisma.lesson.count(),
      Exam: await prisma.exam.count(),
      ToeicExamSet: await prisma.toeicExamSet.count(),
      ToeicQuestionGroup: await prisma.toeicQuestionGroup.count(),
      ToeicQuestion: await prisma.toeicQuestion.count(),
      ToeicAttempt: await prisma.toeicAttempt.count(),
      ToeicAssessment: await prisma.toeicAssessment.count(),
      ToeicAssessmentComponent: await prisma.toeicAssessmentComponent.count(),
      SpeakingPracticeSet: await prisma.speakingPracticeSet.count(),
      SpeakingExercise: await prisma.speakingExercise.count(),
      ToeicWritingSet: await prisma.toeicWritingSet.count(),
      ToeicWritingSetItem: await prisma.toeicWritingSetItem.count(),
    };
    console.log('\n=== FINAL DATA STATE ===');
    for (const [key, value] of Object.entries(counts))
      console.log(`  ${key.padEnd(26)} ${value}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(
    'Verification failed:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
