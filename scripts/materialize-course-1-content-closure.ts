import 'dotenv/config';

import { PrismaClient } from '@prisma/client';

import {
  foundationLessons,
  sectionRows,
} from './materialize-foundation-course-content-v6';

const prisma = new PrismaClient();

async function main() {
  const updated: number[] = [];
  for (const lesson of foundationLessons) {
    const row = await prisma.courseLesson.findUnique({
      where: { courseId_slug: { courseId: 1, slug: lesson.slug } },
      select: { id: true },
    });
    if (!row) throw new Error(`Course 1 lesson not found: ${lesson.slug}`);

    await prisma.courseLesson.update({
      where: { id: row.id },
      data: {
        summary: lesson.summary,
        learningObjectives: lesson.objectives,
      },
    });

    for (const [index, [type, heading, content]] of sectionRows(
      lesson,
      [],
    ).entries()) {
      await prisma.courseLessonSection.upsert({
        where: { lessonId_order: { lessonId: row.id, order: index + 1 } },
        update: { type, heading, content },
        create: { lessonId: row.id, order: index + 1, type, heading, content },
      });
    }
    updated.push(row.id);
  }

  console.log(
    JSON.stringify(
      {
        status: 'COURSE_1_CONTENT_CLOSURE_MATERIALIZED',
        courseId: 1,
        lessonCount: updated.length,
        exerciseRowsUntouched: true,
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
