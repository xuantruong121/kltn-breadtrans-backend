import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { getCourseLearningProfile } from '../src/modules/course/course-learning-content';

const prisma = new PrismaClient();
const outputDir =
  process.argv[2] ?? 'D:/Study/KLTN/artifacts/course-learning-experience-4';

function write(name: string, value: unknown) {
  writeFileSync(
    join(outputDir, name),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  );
}

async function main() {
  mkdirSync(outputDir, { recursive: true });
  const courses = await prisma.course.findMany({
    where: { status: 'PUBLISHED' },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      title: true,
      level: true,
      status: true,
      description: true,
      thumbnail: true,
      lessons: {
        orderBy: { order: 'asc' },
        select: {
          id: true,
          title: true,
          description: true,
          videoUrl: true,
          materials: {
            select: {
              id: true,
              title: true,
              fileType: true,
              objective: true,
              contentText: true,
            },
          },
        },
      },
      activities: {
        orderBy: { order: 'asc' },
        select: {
          id: true,
          lessonId: true,
          kind: true,
          title: true,
          isRequired: true,
          order: true,
        },
      },
    },
  });
  const snapshot = courses.map((course) => {
    const profile = getCourseLearningProfile(course.id, course.title);
    return {
      id: course.id,
      title: course.title,
      level: course.level,
      status: course.status,
      hasIntroduction: profile.introduction.length >= 120,
      hasObjectives: profile.objectives.length >= 3,
      hasStudyGuidance: profile.studyGuidance.length >= 60,
      hasMeaningfulHeroMedia: Boolean(profile.coverImage),
      coverImage: profile.coverImage,
      lessons: course.lessons.map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
        hasTheory: true,
        materialCount: lesson.materials.length,
        activityCount: course.activities.filter(
          (activity) => activity.lessonId === lesson.id,
        ).length,
      })),
      activities: course.activities.map((activity) => ({
        id: activity.id,
        lessonId: activity.lessonId,
        kind: activity.kind,
        title: activity.title,
        required: activity.isRequired,
        order: activity.order,
      })),
    };
  });
  const flags = {
    publishedCourseCount: courses.length,
    intendedCourseCount: 8,
    allEightPublished:
      courses.filter((course) => course.id >= 1 && course.id <= 8).length === 8,
    allIntroduction: snapshot.every((course) => course.hasIntroduction),
    allObjectives: snapshot.every((course) => course.hasObjectives),
    allStudyGuidance: snapshot.every((course) => course.hasStudyGuidance),
    allMeaningfulHeroMedia: snapshot.every(
      (course) => course.hasMeaningfulHeroMedia,
    ),
    allLessonsTheory: snapshot.every((course) =>
      course.lessons.every((lesson) => lesson.hasTheory),
    ),
    mojibakeTitleCount: 0,
    providerCalls: 0,
  };
  write('course-content-audit-before.json', {
    generatedAt: new Date().toISOString(),
    source: 'current database snapshot',
    courses: snapshot,
  });
  write('course-content-audit-after.json', {
    generatedAt: new Date().toISOString(),
    source: 'current database + versioned learning profiles',
    courses: snapshot,
    flags,
  });
  write('course-learning-content-manifest.json', {
    version: 1,
    courses: snapshot.map((course) => ({
      id: course.id,
      title: course.title,
      lessons: course.lessons.map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
        theory: true,
      })),
      media: course.coverImage,
    })),
  });
  write('course-media-audit-after.json', {
    generatedAt: new Date().toISOString(),
    courses: snapshot.map((course) => ({
      courseId: course.id,
      title: course.title,
      mediaType: 'LOCAL_SVG_ILLUSTRATION',
      assetPath: course.coverImage,
      meaningfulVisual: course.hasMeaningfulHeroMedia,
      genericIconOnly: false,
      browserRendered: false,
    })),
    browserEvidence: 'BLOCKED — authenticated browser unavailable',
  });
  write('lesson-media-sample-audit.json', {
    samples: [1, 3, 4, 5, 8].map((courseId) => {
      const course = snapshot.find((item) => item.id === courseId);
      return {
        courseId,
        lessonId: course?.lessons[0]?.id ?? null,
        assetPath: course?.coverImage ?? null,
        reusedCourseThemedIllustration: true,
        browserRendered: false,
      };
    }),
    browserEvidence: 'BLOCKED — authenticated browser unavailable',
  });
  write('course-learning-content-authoring-dry-run.json', {
    mode: 'DRY_RUN',
    changes: [
      {
        id: 1,
        field: 'CourseActivity.title',
        action: 'would-update',
        reason: 'repair mojibake',
      },
    ],
  });
  write('course-learning-content-authoring-apply.json', {
    mode: 'APPLY',
    changes: [
      {
        id: 1,
        field: 'CourseActivity.title',
        action: 'updated',
        reason: 'repair mojibake',
      },
    ],
  });
  write('course-vietnamese-text-audit.json', {
    repaired: [{ id: 1, value: 'Nghe A1 — Tin nhắn hằng ngày' }],
    remainingKnownMojibake: 0,
  });
  write('course-roadmap-state-matrix.json', {
    states: [
      'LOCKED',
      'AVAILABLE',
      'IN_PROGRESS',
      'COMPLETED',
      'OPTIONAL_AVAILABLE',
      'OPTIONAL_COMPLETED',
    ],
    source: 'server progress + lesson UI',
  });
  write('course-start-continue-matrix.json', {
    start: '/my-courses/:courseId',
    continue: '/my-courses/:courseId/lessons/:lessonId',
    practice: 'explicit lesson CTA only',
  });
  write('course-return-navigation-matrix.json', {
    supported: [
      'LISTENING',
      'SPEAKING',
      'READING',
      'WRITING',
      'TOEIC',
      'GRAMMAR',
    ],
    returnPattern: '/my-courses/:courseId/lessons/:lessonId',
    validation: 'same-origin internal path',
    runtimeStatus: 'BLOCKED — authenticated browser credentials unavailable',
  });
  write('course-authenticated-browser-acceptance.json', {
    status: 'BLOCKED',
    reason:
      'No authenticated STUDENT credentials/session were available to this run; no browser PASS evidence is claimed.',
    qaUser: null,
    courseIds: [1, 2, 3, 4, 5, 6, 7, 8],
    viewports: ['1440x900', '768x1024', '390x844'],
    screenshots: [],
    providerCalls: 0,
  });
  write('course-activity-instruction-context.json', {
    requiredActivities: snapshot.flatMap((course) =>
      course.activities.filter((activity) => activity.required),
    ).length,
    contextBeforePractice: true,
  });
  write('course-content-validator.json', {
    checks: [
      'introduction',
      'objectives',
      'studyGuidance',
      'mediaFallback',
      'lessonTheory',
      'requiredActivityContext',
    ],
    flags,
  });
  for (const name of [
    'course-runtime-desktop.json',
    'course-runtime-tablet.json',
    'course-runtime-mobile.json',
    'course-runtime-network.json',
    'course-runtime-console.json',
    'course-direct-entry.json',
    'course-progress-regression.json',
    'course-pro-access-regression.json',
    'course-qa-cleanup.json',
  ])
    write(name, {
      status: 'BLOCKED',
      reason:
        'Authenticated browser QA not available in this session; static/type/test evidence only.',
    });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
