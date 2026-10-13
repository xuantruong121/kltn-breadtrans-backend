import 'dotenv/config';

import { Prisma, PrismaClient } from '@prisma/client';

import { finalQuestionsBySlug } from './materialize-foundation-course-content-v6';

const prisma = new PrismaClient();
const ACTIVE_COURSE_IDS = [1, 8, 12];

function equalJson(left: unknown, right: unknown) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

async function main() {
  const lessons = await prisma.courseLesson.findMany({
    where: { courseId: { in: ACTIVE_COURSE_IDS }, status: 'PUBLISHED' },
    orderBy: [{ courseId: 'asc' }, { order: 'asc' }],
    include: {
      exercises: {
        where: { order: 2 },
        include: {
          questions: {
            orderBy: { order: 'asc' },
            include: { answers: { select: { id: true } } },
          },
        },
      },
    },
  });
  if (lessons.length !== 24) {
    throw new Error(
      `Expected 24 published active lessons, found ${lessons.length}.`,
    );
  }

  const updated: Array<{
    courseId: number;
    lessonId: number;
    exerciseId: number;
    questionCount: number;
  }> = [];
  for (const lesson of lessons) {
    const exercise = lesson.exercises[0];
    const desired = finalQuestionsBySlug[lesson.slug];
    if (!exercise || !desired) {
      throw new Error(
        `Missing final-check source or exercise for ${lesson.courseId}:${lesson.slug}.`,
      );
    }
    if (exercise.questions.length !== desired.length) {
      throw new Error(
        `Refusing to change final-check question count for ${lesson.courseId}:${lesson.slug}: ${exercise.questions.length} -> ${desired.length}.`,
      );
    }

    await prisma.$transaction(async (tx) => {
      for (const current of exercise.questions) {
        const next = desired[current.order - 1];
        const changed =
          !next ||
          current.prompt !== next.prompt ||
          !equalJson(current.options, next.options ?? Prisma.JsonNull) ||
          current.correctAnswer !== next.correctAnswer ||
          current.explanation !== next.explanation;
        if (current.answers.length > 0 && changed) {
          throw new Error(
            `Historical answer guard blocked ${lesson.courseId}:${lesson.slug} question ${current.order}.`,
          );
        }
      }
      for (const [index, question] of desired.entries()) {
        await tx.courseLessonQuestion.update({
          where: {
            exerciseId_order: { exerciseId: exercise.id, order: index + 1 },
          },
          data: {
            prompt: question.prompt,
            options: question.options ?? Prisma.JsonNull,
            correctAnswer: question.correctAnswer,
            explanation: question.explanation,
          },
        });
      }
    });
    updated.push({
      courseId: lesson.courseId,
      lessonId: lesson.id,
      exerciseId: exercise.id,
      questionCount: desired.length,
    });
  }

  console.log(
    JSON.stringify(
      {
        status: 'ACTIVE_FINAL_CHECKS_MATERIALIZED',
        updated,
        historicalAnswersRewritten: false,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
