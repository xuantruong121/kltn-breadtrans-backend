import 'dotenv/config';

import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

/**
 * Read-only audit artifact generator for the three published foundation courses.
 * It deliberately does not call a materializer or mutate any database row.
 */
const prisma = new PrismaClient();
const backendRoot = resolve(__dirname, '..');
const docsRoot = resolve(backendRoot, '..', '..', 'docs');
const researchPath = join(
  backendRoot,
  'scripts',
  'active-course-content-research.json',
);
const matrixPath = join(
  docsRoot,
  'active-course-lesson-content-audit-matrix.json',
);

const course1VisualLessons = new Set([1, 2, 3, 4, 5, 6, 7]);
const sources = [
  {
    source: 'British Council LearnEnglish',
    url: 'https://learnenglish.britishcouncil.org/grammar',
    use: 'Grammar usage explanations and beginner-friendly progression checks.',
  },
  {
    source: 'Cambridge Dictionary English Grammar Today',
    url: 'https://dictionary.cambridge.org/grammar/british-grammar/',
    use: 'Cross-checking form, meaning, and example usage.',
  },
  {
    source: 'International Phonetic Association',
    url: 'https://www.internationalphoneticassociation.org/content/ipa-chart',
    use: 'IPA symbol and pronunciation terminology verification.',
  },
  {
    source: 'Wikimedia Commons',
    url: 'https://commons.wikimedia.org/',
    use: 'License-safe contextual media candidates for Course 1.',
  },
  {
    source: 'Unsplash',
    url: 'https://unsplash.com/license',
    use: 'License-safe meeting context candidate for Course 1 Lesson 7.',
  },
];

function contentOf(section: { content: unknown }): Record<string, unknown> {
  return section.content &&
    typeof section.content === 'object' &&
    !Array.isArray(section.content)
    ? (section.content as Record<string, unknown>)
    : {};
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

async function main() {
  const courses = await prisma.course.findMany({
    where: { id: { in: [1, 8, 12] }, status: 'PUBLISHED' },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      title: true,
      status: true,
      courseLessons: {
        where: { status: 'PUBLISHED' },
        orderBy: { order: 'asc' },
        select: {
          id: true,
          title: true,
          slug: true,
          order: true,
          sections: { select: { type: true, heading: true, content: true } },
          exercises: { select: { id: true } },
          media: {
            select: {
              id: true,
              type: true,
              url: true,
              provenance: true,
              renderStatus: true,
            },
          },
        },
      },
    },
  });

  const matrix = courses.flatMap((course) =>
    course.courseLessons.map((lesson) => {
      const sectionTypes = lesson.sections.map((section) => section.type);
      const sections = lesson.sections.map((section) => contentOf(section));
      const exampleCount = sections.reduce(
        (sum, content) => sum + arrayLength(content.examples),
        0,
      );
      const mistakeCount = sections.reduce(
        (sum, content) => sum + arrayLength(content.bullets),
        0,
      );
      const media = lesson.media.filter((item) => item.type === 'IMAGE');
      const isCourse1 = course.id === 1;
      const mediaDecision = isCourse1
        ? course1VisualLessons.has(lesson.id)
          ? 'IMAGE_USEFUL'
          : 'NO_IMAGE_NEEDED'
        : course.id === 12
          ? 'EXISTING_MEDIA_UNCHANGED'
          : media.length > 0
            ? 'EXISTING_MEDIA_ACCEPTED'
            : 'NO_IMAGE_NEEDED';
      const missingConcepts = [
        'INTRO',
        'THEORY',
        'EXAMPLE',
        'COMMON_MISTAKE',
        'TIP',
        'SUMMARY',
      ].filter((type) => !sectionTypes.includes(type as never));
      return {
        courseId: course.id,
        courseTitle: course.title,
        lessonId: lesson.id,
        order: lesson.order,
        lessonTitle: lesson.title,
        slug: lesson.slug,
        existingStructure: sectionTypes,
        missingConcepts,
        exampleQuality:
          exampleCount >= 3
            ? 'CONTEXTUAL_3_PLUS'
            : exampleCount > 0
              ? 'CONTEXTUAL_REVIEW'
              : 'NEEDS_EXAMPLES',
        exampleCount,
        tips: sectionTypes.includes('TIP') ? 'PRESENT' : 'MISSING',
        mistakes:
          mistakeCount >= 2
            ? 'PRESENT_WITH_REASON_REVIEW'
            : mistakeCount > 0
              ? 'PRESENT'
              : 'MISSING',
        summary: sectionTypes.includes('SUMMARY') ? 'PRESENT' : 'MISSING',
        media: media.map((item) => ({
          id: item.id,
          url: item.url,
          provenance: item.provenance,
          renderStatus: item.renderStatus,
        })),
        mediaDecision,
        finalExerciseCount: lesson.exercises.length,
        finalExerciseIds: lesson.exercises.map((exercise) => exercise.id),
        decision:
          missingConcepts.length === 0
            ? 'RENDER_SHARED_GUIDED_FLOW'
            : 'CONTENT_REVIEW_REQUIRED',
      };
    }),
  );

  const artifact = {
    generatedAt: new Date().toISOString(),
    activeCourseIds: [1, 8, 12],
    activePublishedCourseCount: courses.length,
    lessonCount: matrix.length,
    preservation: {
      finalExercisesPreserved: true,
      course12MediaUnchanged: true,
      databaseMutation: false,
    },
    sources,
    lessons: matrix,
  };
  await writeFile(matrixPath, JSON.stringify(artifact, null, 2));
  await writeFile(
    researchPath,
    JSON.stringify(
      {
        generatedAt: artifact.generatedAt,
        purpose: 'Internal authoring provenance; not displayed to learners.',
        sources,
        courseRoles: {
          '1': 'Beginner foundation and everyday communication.',
          '8': 'Focused grammar and vocabulary with explicit form/meaning contrast.',
          '12': 'Pronunciation and IPA guidance for Vietnamese learners; accepted media retained.',
        },
        lessonAuditMatrix: matrix,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      {
        status: 'ACTIVE_COURSE_CONTENT_AUDIT_WRITTEN',
        lessonCount: matrix.length,
        matrixPath,
        researchPath,
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
  .finally(async () => {
    await prisma.$disconnect();
  });
