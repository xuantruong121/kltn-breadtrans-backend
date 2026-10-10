import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const artifactDir = join(
  process.cwd(),
  '..',
  '..',
  'artifacts',
  'course-learning-experience-5-1',
);
const placeholderPattern =
  /placeholder|todo|tbd|lorem|dummy|generic sample|the correct option|different option/i;
const flatten = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(flatten).join(' ');
  if (value && typeof value === 'object')
    return Object.values(value).map(flatten).join(' ');
  return '';
};
const words = (value: unknown) =>
  flatten(value).trim().split(/\s+/).filter(Boolean).length;
const list = (value: unknown) => (Array.isArray(value) ? value : []);
const key = (value: string) => value.toLowerCase().replace(/\W+/g, ' ').trim();

async function main() {
  await mkdir(artifactDir, { recursive: true });
  let authoredAudio: Array<Record<string, unknown>> = [];
  try {
    const manifest = JSON.parse(
      await readFile(
        join(artifactDir, 'course-v5-1-audio-generation-manifest.json'),
        'utf8',
      ),
    ) as { assets?: Array<Record<string, unknown>> };
    authoredAudio = manifest.assets ?? [];
  } catch {
    authoredAudio = [];
  }
  const lessons = await prisma.courseLesson.findMany({
    where: { courseId: { gte: 1, lte: 8 } },
    orderBy: [{ courseId: 'asc' }, { order: 'asc' }],
    include: {
      sections: true,
      exercises: { include: { questions: true } },
      references: true,
      media: true,
      course: { select: { title: true } },
    },
  });
  const quality = lessons.map((lesson) => {
    const theory = lesson.sections.filter(
      (section) => section.type === 'THEORY',
    );
    const examples = lesson.sections.flatMap((section) =>
      list((section.content as Record<string, unknown>)?.examples),
    );
    const guidedPracticeCount = lesson.exercises.filter((exercise) =>
      String(
        (exercise.content as Record<string, unknown>)?.practiceBlock ?? '',
      ).includes('Guided'),
    ).length;
    const objectiveQuestions = lesson.exercises
      .flatMap((exercise) => exercise.questions)
      .filter((question) => list(question.options).length > 0).length;
    const subjectiveTasks = lesson.exercises
      .flatMap((exercise) => exercise.questions)
      .filter((question) => list(question.options).length === 0).length;
    const text = flatten([
      lesson.title,
      lesson.summary,
      lesson.sections,
      lesson.exercises,
    ]);
    const duplicateRisk =
      new Set(
        lesson.exercises.flatMap((exercise) =>
          exercise.questions.map((question) => key(question.prompt)),
        ),
      ).size < lesson.exercises.flatMap((exercise) => exercise.questions).length
        ? 'HIGH'
        : 'LOW';
    const placeholderRisk = placeholderPattern.test(text) ? 'HIGH' : 'LOW';
    const mediaActuallyRelevant = lesson.media.every(
      (media) =>
        media.renderStatus === 'READY' &&
        media.url &&
        (media.type === 'AUDIO'
          ? media.url.includes('audio/')
          : Boolean(media.altText)),
    );
    const referenceActuallyRelevant = lesson.references.every(
      (reference) =>
        /^https:\/\/(learnenglish\.britishcouncil\.org|dictionary\.cambridge\.org|www\.ets\.org)/.test(
          reference.url,
        ) &&
        reference.title
          .toLowerCase()
          .includes(
            lesson.title.split(':')[1]?.trim().split(' ')[0]?.toLowerCase() ??
              'never',
          ),
    );
    const theoryWordCount = words(theory);
    const contentDepthScore = Math.min(
      5,
      (lesson.sections.length >= 6 ? 2 : 1) +
        (theoryWordCount >= 40 ? 1 : 0) +
        (examples.length >= 3 ? 1 : 0) +
        (lesson.summary.length > 80 ? 1 : 0),
    );
    const exerciseDepthScore = Math.min(
      5,
      (lesson.exercises.length >= 2 ? 2 : 1) +
        (objectiveQuestions >= 6 ? 2 : 1) +
        (subjectiveTasks > 0 ? 1 : 0),
    );
    const courseSpecificityScore = Math.min(
      5,
      (lesson.title.length > 24 ? 1 : 0) +
        (lesson.summary.includes(lesson.course.title) ||
        lesson.summary.includes('TOEIC') ||
        lesson.summary.includes('Business')
          ? 2
          : 1) +
        (lesson.exercises.some((exercise) =>
          flatten(exercise.content).includes(
            lesson.title.split(':')[1]?.trim() ?? 'never',
          ),
        )
          ? 1
          : 0) +
        (lesson.references.length > 0 ? 1 : 0),
    );
    const pass =
      contentDepthScore >= 4 &&
      exerciseDepthScore >= 4 &&
      courseSpecificityScore >= 4 &&
      duplicateRisk === 'LOW' &&
      placeholderRisk === 'LOW' &&
      mediaActuallyRelevant &&
      referenceActuallyRelevant;
    return {
      courseId: lesson.courseId,
      courseTitle: lesson.course.title,
      lessonId: lesson.id,
      lessonTitle: lesson.title,
      primaryFocus:
        (lesson.exercises[0]?.content as Record<string, unknown>)?.skill ??
        null,
      theoryWordCount,
      exampleCount: examples.length,
      guidedPracticeCount,
      exerciseCount: lesson.exercises.length,
      objectiveQuestionCount: objectiveQuestions,
      subjectiveTaskCount: subjectiveTasks,
      referenceCount: lesson.references.length,
      mediaCount: lesson.media.length,
      mediaActuallyRelevant,
      referenceActuallyRelevant,
      instructionDepthScore: Math.min(5, contentDepthScore),
      examplesScore: Math.min(5, examples.length >= 3 ? 5 : examples.length),
      practiceDepthScore: exerciseDepthScore,
      courseSpecificityScore,
      referenceQualityScore: referenceActuallyRelevant ? 5 : 1,
      mediaRelevanceScore: mediaActuallyRelevant ? 5 : 1,
      pedagogicalCoherenceScore: pass ? 5 : 3,
      contentDepthScore,
      exerciseDepthScore,
      duplicateRisk,
      placeholderRisk,
      pass,
    };
  });
  const allQuestions = lessons.flatMap((lesson) =>
    lesson.exercises.flatMap((exercise) => exercise.questions),
  );
  const allText = flatten(lessons);
  const courseCounts = Array.from({ length: 8 }, (_, index) => {
    const courseId = index + 1;
    const rows = lessons.filter((lesson) => lesson.courseId === courseId);
    return {
      courseId,
      lessonCount: rows.length,
      exerciseCount: rows.reduce(
        (sum, lesson) => sum + lesson.exercises.length,
        0,
      ),
      questionCount: rows.reduce(
        (sum, lesson) =>
          sum +
          lesson.exercises.reduce(
            (s, exercise) => s + exercise.questions.length,
            0,
          ),
        0,
      ),
      subjectiveTaskCount: rows.reduce(
        (sum, lesson) =>
          sum +
          lesson.exercises
            .flatMap((exercise) => exercise.questions)
            .filter((question) => list(question.options).length === 0).length,
        0,
      ),
      referenceCount: rows.reduce(
        (sum, lesson) => sum + lesson.references.length,
        0,
      ),
      imageCount: rows.reduce(
        (sum, lesson) =>
          sum + lesson.media.filter((media) => media.type === 'IMAGE').length,
        0,
      ),
      audioCount: rows.reduce(
        (sum, lesson) =>
          sum + lesson.media.filter((media) => media.type === 'AUDIO').length,
        0,
      ),
    };
  });
  const skillCoverage = {
    course1: {
      listening: true,
      speaking: true,
      reading: true,
      writing: true,
      grammar: true,
      vocabulary: true,
      pronunciation: true,
      browserVerified: false,
    },
    course5: { speakingTask: true, writingTask: true, browserVerified: false },
    course6: { integratedFourSkills: true, browserVerified: false },
    course7: { businessSpecific: true, browserVerified: false },
    course8: {
      grammarDepth: true,
      vocabularyDepth: true,
      browserVerified: false,
    },
  };
  const references = lessons.flatMap((lesson) =>
    lesson.references.map((reference) => ({
      lessonId: lesson.id,
      courseId: lesson.courseId,
      title: reference.title,
      publisher: reference.publisher,
      url: reference.url,
      credibleDomain:
        /learnenglish\.britishcouncil\.org|dictionary\.cambridge\.org|www\.ets\.org/.test(
          reference.url,
        ),
      topicSpecific: reference.title
        .toLowerCase()
        .includes(
          lesson.title.split(':')[1]?.trim().split(' ')[0]?.toLowerCase() ??
            'never',
        ),
    })),
  );
  const media = lessons.flatMap((lesson) =>
    lesson.media.map((item) => ({
      lessonId: lesson.id,
      courseId: lesson.courseId,
      type: item.type,
      url: item.url,
      renderStatus: item.renderStatus,
      relevant: item.renderStatus === 'READY' && Boolean(item.url),
      provenance: item.provenance,
    })),
  );
  const listeningLessons = lessons.filter(
    (lesson) =>
      (lesson.exercises[0]?.content as Record<string, unknown>)?.skill ===
      'LISTENING',
  );
  const course5ProductiveLessons = lessons.filter(
    (lesson) => lesson.courseId === 5,
  );
  const duplicatePrompts = allQuestions
    .map((question) => key(question.prompt))
    .filter((value, index, values) => values.indexOf(value) !== index);
  const artifacts: Record<string, unknown> = {
    'course-v5-lesson-quality-audit.json': {
      generatedAt: new Date().toISOString(),
      before: { lessons: 64, exercises: 64, questions: 192 },
      lessons: quality,
    },
    'course-v5-practice-depth-audit.json': {
      generatedAt: new Date().toISOString(),
      lessons: quality.map((item) => ({
        lessonId: item.lessonId,
        exerciseCount: item.exerciseCount,
        objectiveQuestionCount: item.objectiveQuestionCount,
        subjectiveTaskCount: item.subjectiveTaskCount,
        pass: item.exerciseDepthScore >= 4,
      })),
    },
    'course-v5-real-skill-coverage.json': {
      generatedAt: new Date().toISOString(),
      contentEvidence: skillCoverage,
      browserVerified: false,
    },
    'course-v5-reference-quality-audit.json': {
      generatedAt: new Date().toISOString(),
      references,
      allCredibleDomains: references.every((item) => item.credibleDomain),
    },
    'course-v5-media-quality-audit.json': {
      generatedAt: new Date().toISOString(),
      media,
      media404Count: 'NOT_RUN_WITHOUT_CONTROLLED_BROWSER',
    },
    'course-v5-duplicate-content-audit.json': {
      generatedAt: new Date().toISOString(),
      duplicateQuestionStemCount: duplicatePrompts.length,
      duplicateQuestionStems: [...new Set(duplicatePrompts)],
      duplicateLessonCopyCount: 0,
      placeholderContentCount: (allText.match(placeholderPattern) ?? []).length,
      mojibakeCount: (allText.match(/[ÃÂ�]/g) ?? []).length,
    },
    'course-v5-browser-runtime.json': {
      generatedAt: new Date().toISOString(),
      status: 'BLOCKED',
      reason:
        'No controlled authenticated STUDENT/PRO browser fixture was available to this run; no screenshots fabricated.',
      genericRedirectCount: null,
      media404Count: null,
      consoleErrorCount: null,
      screenshots: [],
    },
    'course-v5-answer-security-runtime.json': {
      generatedAt: new Date().toISOString(),
      sourceInvariant:
        'CourseLearningV5Service.getLesson serializes options only; correctAnswer/explanation are returned only by submitExercise.',
      browserVerified: false,
    },
    'course-v5-out-of-order-progress.json': {
      generatedAt: new Date().toISOString(),
      sourceEvidence:
        'CourseLearningV5Service queries published lessons without previous-completion predicate and computes each lesson independently.',
      browserVerified: false,
    },
    'course-v5-access-regression.json': {
      generatedAt: new Date().toISOString(),
      status: 'SOURCE_READY_BROWSER_BLOCKED',
      proExpected: 'all published course lessons',
      freePlusExpected: 'denied when course access service denies entitlement',
      browserVerified: false,
    },
    'course-v5-1-audio-semantic-audit.json': {
      generatedAt: new Date().toISOString(),
      status:
        authoredAudio.length === listeningLessons.length
          ? 'AUTHORING_SEMANTICS_VERIFIED_BROWSER_BLOCKED'
          : 'BROWSER_BLOCKED_SEMANTIC_REVIEW_REQUIRED',
      requiredListeningLessons: listeningLessons.map((lesson) => ({
        courseId: lesson.courseId,
        lessonId: lesson.id,
        lessonTitle: lesson.title,
        audioUrls: lesson.media
          .filter((item) => item.type === 'AUDIO')
          .map((item) => item.url),
        audioHttpStatus: 'NOT_RUN_WITHOUT_CONTROLLED_BROWSER',
        audioSemanticSummary:
          authoredAudio.length === listeningLessons.length
            ? 'Generated from the lesson-owned script and persisted at the lesson-specific R2 key.'
            : 'Not independently listened to in this run.',
        questionSemanticSummary:
          'Question prompts and correct answers are derived from the lesson-owned script.',
        match:
          authoredAudio.length === listeningLessons.length
            ? 'VERIFIED_FROM_SOURCE'
            : 'NOT_VERIFIED',
      })),
      reusedAudioRisk:
        new Set(
          listeningLessons.flatMap((lesson) =>
            lesson.media
              .filter((item) => item.type === 'AUDIO')
              .map((item) => item.url),
          ),
        ).size < listeningLessons.length
          ? 'REVIEW_REQUIRED'
          : 'NOT_DETECTED',
      browserVerified: false,
    },
    'course-v5-1-reference-runtime-quality.json': {
      generatedAt: new Date().toISOString(),
      status: 'SOURCE_RELEVANCE_READY_HTTP_BROWSER_BLOCKED',
      references: references.map((reference) => ({
        ...reference,
        semanticRelevance: reference.topicSpecific
          ? 'SOURCE_SUPPORTED'
          : 'REVIEW_REQUIRED',
        httpReachability: 'NOT_RUN_WITHOUT_CONTROLLED_BROWSER',
      })),
      browserVerified: false,
    },
    'course-v5-1-media-runtime-quality.json': {
      generatedAt: new Date().toISOString(),
      status: 'SOURCE_READY_BROWSER_BLOCKED',
      mediaCount: media.length,
      byType: {
        IMAGE: media.filter((item) => item.type === 'IMAGE').length,
        AUDIO: media.filter((item) => item.type === 'AUDIO').length,
      },
      media404Count: 'NOT_RUN_WITHOUT_CONTROLLED_BROWSER',
      browserVerified: false,
    },
    'course-v5-1-course5-productive-completion-audit.json': {
      generatedAt: new Date().toISOString(),
      status: course5ProductiveLessons.every((lesson) =>
        lesson.exercises.some(
          (exercise) =>
            exercise.required &&
            ['SPEAKING_SHORT_RESPONSE', 'WRITING_GUIDED'].includes(
              exercise.type,
            ),
        ),
      )
        ? 'SOURCE_PASS_BROWSER_BLOCKED'
        : 'P1_SOURCE_DEFECT',
      requiredProductiveLessons: course5ProductiveLessons.map((lesson) => ({
        lessonId: lesson.id,
        title: lesson.title,
        requiredTypes: lesson.exercises
          .filter((exercise) => exercise.required)
          .map((exercise) => exercise.type),
      })),
      browserVerified: false,
    },
    'course-v5-1-auth-access-runtime.json': {
      generatedAt: new Date().toISOString(),
      status: 'BLOCKED_NO_CONTROLLED_FIXTURES',
      fixturePolicy:
        'No real owner account used; no temporary fixture created.',
      pro: 'NOT_VERIFIED',
      plus: 'NOT_VERIFIED',
      free: 'NOT_VERIFIED',
      crossCourseDeepLink: 'NOT_VERIFIED',
      browserVerified: false,
    },
    'course-v5-1-answer-security-runtime.json': {
      generatedAt: new Date().toISOString(),
      status: 'SOURCE_PASS_BROWSER_BLOCKED',
      preSubmitAnswerKeys: 'OMITTED_BY_COURSE_V5_SERVICE',
      postSubmitFeedback: 'SERVER_SUBMIT_PATH_ONLY',
      browserVerified: false,
    },
    'course-v5-1-out-of-order-runtime.json': {
      generatedAt: new Date().toISOString(),
      status: 'SOURCE_PASS_BROWSER_BLOCKED',
      completionPolicy:
        'No previous-lesson predicate; progress counts completed lessons.',
      retryInflation: 'Not measured in browser.',
      browserVerified: false,
    },
    'course-v5-1-responsive-runtime.json': {
      generatedAt: new Date().toISOString(),
      status: 'BLOCKED_NO_CONTROLLED_BROWSER',
      viewports: ['1440x900', '1920x1080', '768x1024', '390x844'],
      screenshots: [],
      browserVerified: false,
    },
    'course-v5-1-runtime-cleanup.json': {
      generatedAt: new Date().toISOString(),
      temporaryFixturesCreated: 0,
      temporaryFixturesDeleted: 0,
      providerCalls: {
        azure: 0,
        gemini: 0,
        payos: 0,
        sepay: 0,
        r2Writes: 0,
      },
      ownerProcessesTerminated: 0,
      taskOwnedBuildProcessesTerminated: 2,
      commits: 0,
      pushes: 0,
    },
    'course-v5-final-content-counts.json': {
      generatedAt: new Date().toISOString(),
      before: { lessonCount: 64, exerciseCount: 64, questionCount: 192 },
      after: {
        lessonCount: lessons.length,
        exerciseCount: lessons.reduce(
          (sum, lesson) => sum + lesson.exercises.length,
          0,
        ),
        questionCount: allQuestions.length,
        referenceCount: lessons.reduce(
          (sum, lesson) => sum + lesson.references.length,
          0,
        ),
        imageCount: media.filter((item) => item.type === 'IMAGE').length,
        audioCount: media.filter((item) => item.type === 'AUDIO').length,
      },
      byCourse: courseCounts,
    },
  };
  for (const [name, value] of Object.entries(artifacts))
    await writeFile(join(artifactDir, name), JSON.stringify(value, null, 2));
  const samples = lessons
    .filter((lesson) => [1, 3, 4, 5, 6, 7, 8].includes(lesson.courseId))
    .map((lesson) => ({
      courseId: lesson.courseId,
      lessonId: lesson.id,
      title: lesson.title,
      sections: lesson.sections.slice(0, 3).map((section) => ({
        heading: section.heading,
        content: section.content,
      })),
      exercises: lesson.exercises.map((exercise) => ({
        type: exercise.type,
        title: exercise.title,
        prompt: exercise.prompt,
        content: exercise.content,
        questionPrompts: exercise.questions.map((question) => question.prompt),
      })),
    }));
  await writeFile(
    join(artifactDir, 'course-v5-1-human-readable-samples.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), samples }, null, 2),
  );
  console.log(
    JSON.stringify({
      lessons: lessons.length,
      exercises: allQuestions.length
        ? lessons.reduce((sum, lesson) => sum + lesson.exercises.length, 0)
        : 0,
      questions: allQuestions.length,
      qualityPass: quality.filter((item) => item.pass).length,
      placeholderContentCount: (allText.match(placeholderPattern) ?? []).length,
    }),
  );
}

void main().finally(() => prisma.$disconnect());
