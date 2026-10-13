import 'dotenv/config';

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const ACTIVE_COURSE_IDS = [1, 8, 12];
const artifactPath = join(
  process.cwd(),
  '..',
  '..',
  'artifacts',
  'active-course-duplicate-exercises',
  'duplicate-matrix.json',
);

function normalize(value: unknown) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/^\s*\d+[.)-]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function signature(question: {
  prompt: unknown;
  options: unknown;
  correctAnswer: unknown;
  explanation: unknown;
}) {
  const options = Array.isArray(question.options)
    ? question.options.map(normalize)
    : question.options;
  return JSON.stringify({
    prompt: normalize(question.prompt),
    options,
    correctAnswer: normalize(question.correctAnswer),
    explanation: normalize(question.explanation),
  });
}

async function main() {
  const lessons = await prisma.courseLesson.findMany({
    where: { courseId: { in: ACTIVE_COURSE_IDS }, status: 'PUBLISHED' },
    orderBy: [{ courseId: 'asc' }, { order: 'asc' }],
    include: {
      exercises: {
        orderBy: { order: 'asc' },
        include: { questions: { orderBy: { order: 'asc' } } },
      },
    },
  });
  const matrix = lessons.map((lesson) => {
    const [guided, final] = lesson.exercises;
    const guidedSignatures = guided?.questions.map(signature) ?? [];
    const finalSignatures = final?.questions.map(signature) ?? [];
    const sharedQuestionCount = guidedSignatures.filter((item) =>
      finalSignatures.includes(item),
    ).length;
    const exactDuplicate =
      guidedSignatures.length > 0 &&
      guidedSignatures.length === finalSignatures.length &&
      guidedSignatures.every((item, index) => item === finalSignatures[index]);
    return {
      courseId: lesson.courseId,
      lessonId: lesson.id,
      lessonOrder: lesson.order,
      lessonSlug: lesson.slug,
      lessonTitle: lesson.title,
      exercise1: guided
        ? { id: guided.id, slug: guided.slug, title: guided.title }
        : null,
      exercise2: final
        ? { id: final.id, slug: final.slug, title: final.title }
        : null,
      exercise1QuestionIds:
        guided?.questions.map((question) => question.id) ?? [],
      exercise2QuestionIds:
        final?.questions.map((question) => question.id) ?? [],
      sharedQuestionCount,
      exactDuplicate,
      classification: exactDuplicate
        ? 'EXACT_DUPLICATE'
        : sharedQuestionCount > 0
          ? 'PARTIAL_DUPLICATE'
          : 'DISTINCT_OK',
    };
  });
  const result = {
    generatedAt: new Date().toISOString(),
    activeCourseIds: ACTIVE_COURSE_IDS,
    lessonCount: lessons.length,
    exerciseCount: lessons.reduce(
      (sum, lesson) => sum + lesson.exercises.length,
      0,
    ),
    exactDuplicateLessonCount: matrix.filter((item) => item.exactDuplicate)
      .length,
    sharedQuestionCount: matrix.reduce(
      (sum, item) => sum + item.sharedQuestionCount,
      0,
    ),
    matrix,
  };
  await mkdir(join(artifactPath, '..'), { recursive: true });
  await writeFile(artifactPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
