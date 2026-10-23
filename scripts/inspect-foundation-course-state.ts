import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const courseIds = [1, 8, 12];

async function main() {
  const courses = await Promise.all(
    courseIds.map(async (courseId) => {
      const course = await prisma.course.findUnique({
        where: { id: courseId },
        select: {
          id: true,
          title: true,
          status: true,
          lessons: { select: { id: true } },
          courseLessons: {
            select: {
              id: true,
              status: true,
              sections: { select: { id: true } },
              media: { select: { id: true } },
              exercises: { select: { questions: { select: { id: true } } } },
            },
          },
        },
      });
      if (!course) return { courseId, exists: false };
      const incompletePublishedLessons = course.courseLessons.filter(
        (lesson) =>
          lesson.status === 'PUBLISHED' &&
          (lesson.sections.length === 0 || lesson.exercises.length === 0),
      ).length;
      return {
        courseId,
        exists: true,
        title: course.title,
        status: course.status,
        legacyLessonCount: course.lessons.length,
        v5LessonCount: course.courseLessons.length,
        sectionCount: course.courseLessons.reduce(
          (total, lesson) => total + lesson.sections.length,
          0,
        ),
        exerciseCount: course.courseLessons.reduce(
          (total, lesson) => total + lesson.exercises.length,
          0,
        ),
        questionCount: course.courseLessons.reduce(
          (total, lesson) =>
            total + lesson.exercises.reduce(
              (exerciseTotal, exercise) =>
                exerciseTotal + exercise.questions.length,
              0,
            ),
          0,
        ),
        mediaCount: course.courseLessons.reduce(
          (total, lesson) => total + lesson.media.length,
          0,
        ),
        incompletePublishedLessons,
      };
    }),
  );
  console.log(JSON.stringify({ courses }, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
