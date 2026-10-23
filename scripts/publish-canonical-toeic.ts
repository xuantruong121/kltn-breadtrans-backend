/**
 * Publishes reconstructed canonical TOEIC products only after their sources
 * satisfy the same readiness guard used by the learner-facing Exam service.
 */
import 'dotenv/config';
import { PrismaClient, QuizPublicationStatus } from '@prisma/client';
import { GenericExamService } from '../src/modules/toeic/generic-exam.service';
import { validateToeicExam } from '../src/modules/toeic/toeic.validation';
import {
  TOEIC_SPEAKING_TASK_SEQUENCE,
  toeicSpeakingContractErrors,
} from '../src/modules/speaking/toeic-speaking-contract';

const prisma = new PrismaClient();
const checkOnly = process.argv.includes('--check');

async function publishSources() {
  const lr = await prisma.toeicExamSet.findUnique({
    where: { id: 1 }, include: { groups: { include: { questions: true } } },
  });
  if (!lr || !validateToeicExam(lr).learnerReady) {
    throw new Error('Canonical TOEIC L&R source is not learner-ready.');
  }

  const speakingSets = await prisma.speakingPracticeSet.findMany({
    where: { id: { in: ['exam-3-speaking', 'exam-4-speaking'] } },
    include: { exercises: { include: { stimulus: true }, orderBy: { order: 'asc' } } },
  });
  if (speakingSets.length !== 2) throw new Error('Canonical TOEIC speaking sources are incomplete.');
  for (const source of speakingSets) {
    const sequenceMatches = source.exercises.length === TOEIC_SPEAKING_TASK_SEQUENCE.length &&
      source.exercises.every((exercise, index) => exercise.taskType === TOEIC_SPEAKING_TASK_SEQUENCE[index]);
    if (!sequenceMatches || toeicSpeakingContractErrors(source as never).length) {
      throw new Error(`Canonical speaking source ${source.id} is not publishable.`);
    }
  }

  const writingSets = await prisma.toeicWritingSet.findMany({
    include: { items: { include: { writingQuiz: { include: { questions: true } } } } },
  });
  if (writingSets.length !== 2 || writingSets.some((set) => set.items.length !== 8)) {
    throw new Error('Canonical TOEIC writing sources are incomplete.');
  }

  if (checkOnly) return;
  await prisma.$transaction(async (tx) => {
    await tx.toeicExamSet.update({ where: { id: lr.id }, data: { publicationStatus: QuizPublicationStatus.PUBLISHED } });
    for (const source of speakingSets) {
      await tx.speakingPracticeSet.update({ where: { id: source.id }, data: { publicationStatus: QuizPublicationStatus.PUBLISHED } });
      await tx.speakingExercise.updateMany({ where: { practiceSetId: source.id }, data: { publicationStatus: QuizPublicationStatus.PUBLISHED } });
    }
    for (const set of writingSets) {
      await tx.toeicWritingSet.update({ where: { id: set.id }, data: { publicationStatus: QuizPublicationStatus.PUBLISHED } });
      await tx.quiz.updateMany({ where: { id: { in: set.items.map((item) => item.writingQuizId) } }, data: { publicationStatus: QuizPublicationStatus.PUBLISHED } });
    }
  });
}

async function main() {
  await publishSources();
  const service = new GenericExamService(prisma as never, {} as never);
  const exams = await prisma.exam.findMany({
    where: { variantCode: { in: ['TOEIC_LR', 'TOEIC_SW', 'TOEIC_4_SKILLS'] } },
    select: { id: true, variantCode: true, publicationStatus: true },
    orderBy: { id: 'asc' },
  });
  if (exams.length !== 3) throw new Error('Expected exactly three canonical TOEIC products.');
  if (!checkOnly) {
    for (const exam of exams) {
      if (exam.publicationStatus !== QuizPublicationStatus.PUBLISHED) await service.publish(exam.id);
    }
  }
  const final = await prisma.exam.findMany({
    where: { id: { in: exams.map((exam) => exam.id) } },
    select: { id: true, variantCode: true, publicationStatus: true }, orderBy: { id: 'asc' },
  });
  console.log(JSON.stringify({ mode: checkOnly ? 'CHECK' : 'APPLY', products: final }, null, 2));
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => prisma.$disconnect());
