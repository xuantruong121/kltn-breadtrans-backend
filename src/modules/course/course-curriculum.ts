export type CourseCurriculumSkill =
  'LISTENING' | 'SPEAKING' | 'READING' | 'WRITING';
export type CourseCurriculumKind =
  CourseCurriculumSkill | 'LESSON' | 'TOEIC' | 'GRAMMAR';

type MaterialSource = {
  id: number;
  title: string;
  fileUrl: string;
  fileType?: string | null;
  objective?: string | null;
  contentText?: string | null;
};
type LessonSource = {
  id: number;
  title: string;
  description?: string | null;
  order: number;
  materials?: MaterialSource[];
};
type QuizSource = {
  id: number;
  title: string;
  description?: string | null;
  type: string;
  publicationStatus?: string;
  isPremiumContent?: boolean;
  _count?: { questions: number };
};
type SpeakingSetSource = {
  id: string;
  key?: string;
  title: string;
  description: string;
  exercises?: Array<{ id: number }>;
};
type ToeicExamSource = {
  id: number;
  title: string;
  description?: string | null;
  groups?: Array<{ id: number }>;
};
type GrammarTopicSource = {
  id: number;
  title: string;
  description?: string | null;
  questions?: Array<{ id: number }>;
};
type ActivitySource = {
  id: number;
  lessonId: number;
  order: number;
  kind: string;
  title?: string | null;
  isRequired: boolean;
  quizId?: number | null;
  speakingPracticeSetId?: string | null;
  toeicExamId?: number | null;
  grammarTopicId?: number | null;
  quiz?: QuizSource | null;
  speakingPracticeSet?: SpeakingSetSource | null;
  toeicExam?: ToeicExamSource | null;
  grammarTopic?: GrammarTopicSource | null;
};

export type CourseCurriculumActivity = {
  id: string;
  sourceId: number | string;
  kind: CourseCurriculumKind;
  skill: CourseCurriculumSkill | null;
  title: string;
  description: string | null;
  route: string | null;
  required: boolean;
  published: boolean;
  hasQuestions: boolean;
  isPremiumContent: boolean;
  lessonId?: number;
  order?: number;
  speakingPracticeSetId?: string | null;
  toeicExamId?: number | null;
  grammarTopicId?: number | null;
  unlocked?: boolean;
  lockedReason?: string | null;
};
export type CourseCurriculumLesson = {
  id: number;
  order: number;
  title: string;
  description: string | null;
  materials: MaterialSource[];
  activities: CourseCurriculumActivity[];
};
export type CourseCurriculum = {
  version: 2;
  lessons: CourseCurriculumLesson[];
  requiredActivityCount: number;
  optionalActivityCount: number;
  skillCoverage: Record<CourseCurriculumSkill, number>;
  readiness:
    | 'READY'
    | 'PARTIAL'
    | 'EMPTY'
    | 'BROKEN'
    | 'FOCUSED'
    | 'TOEIC'
    | 'DEFERRED_TO_TOEIC_WORKFLOW';
  readinessReasons: string[];
};

const skillForQuiz = (type: string): CourseCurriculumSkill | null => {
  if (type === 'LISTENING_PRACTICE') return 'LISTENING';
  if (type === 'BILINGUAL_READING') return 'READING';
  if (type === 'WRITING_EMAIL' || type === 'WRITING_PICTURE') return 'WRITING';
  return null;
};

const routeForQuiz = (skill: CourseCurriculumSkill | null, id: number) =>
  skill === 'LISTENING'
    ? `/listening/${id}`
    : skill === 'READING'
      ? `/reading/${id}`
      : skill === 'WRITING'
        ? `/writing/${id}`
        : null;

function emptyLessons(lessons: LessonSource[]) {
  return lessons
    .slice()
    .sort((a, b) => a.order - b.order || a.id - b.id)
    .map((lesson) => ({
      id: lesson.id,
      order: lesson.order,
      title: lesson.title,
      description: lesson.description ?? null,
      materials: lesson.materials ?? [],
      activities: [] as CourseCurriculumActivity[],
    }));
}

/** Build from persisted CourseActivity rows. The two-argument form remains a read-only
 * compatibility helper for old unit tests; production Course responses always pass rows. */
export function buildCourseCurriculum(
  lessons: LessonSource[],
  quizzes: QuizSource[],
  activities: ActivitySource[] = [],
  curriculumType = 'GENERAL_ENGLISH',
): CourseCurriculum {
  const hasDurableActivityArgument = arguments.length >= 3;
  const lessonRows = emptyLessons(lessons);
  const byLesson = new Map(lessonRows.map((lesson) => [lesson.id, lesson]));
  const quizById = new Map(quizzes.map((quiz) => [quiz.id, quiz]));
  if (!hasDurableActivityArgument) {
    // Compatibility-only path for legacy callers/tests. Runtime course responses
    // pass persisted CourseActivity rows and never use title matching.
    const legacy: CourseCurriculumActivity[] = quizzes.map((quiz) => ({
      id: `quiz:${quiz.id}`,
      sourceId: quiz.id,
      kind: skillForQuiz(quiz.type) ?? 'LESSON',
      skill: skillForQuiz(quiz.type),
      title: quiz.title,
      description: quiz.description ?? null,
      route: routeForQuiz(skillForQuiz(quiz.type), quiz.id),
      required: Boolean(skillForQuiz(quiz.type)),
      published: quiz.publicationStatus === 'PUBLISHED',
      hasQuestions: (quiz._count?.questions ?? 0) > 0,
      isPremiumContent: Boolean(quiz.isPremiumContent),
    }));
    for (const activity of legacy) {
      const target =
        lessonRows.find(
          (lesson) =>
            activity.skill &&
            lesson.title.toLowerCase().includes(activity.skill.toLowerCase()),
        ) ?? lessonRows[lessonRows.length - 1];
      target?.activities.push(activity);
    }
    const skillCoverage = {
      LISTENING: 0,
      SPEAKING: 0,
      READING: 0,
      WRITING: 0,
    } as Record<CourseCurriculumSkill, number>;
    for (const activity of legacy)
      if (activity.skill && activity.published && activity.hasQuestions)
        skillCoverage[activity.skill]++;
    const reasons: string[] = [];
    if (!lessonRows.length) reasons.push('Course chưa có lesson.');
    if (!skillCoverage.SPEAKING)
      reasons.push('Chưa có quan hệ activity Speaking cấp Course.');
    if (!skillCoverage.LISTENING)
      reasons.push('Chưa có activity Listening hợp lệ.');
    if (!skillCoverage.READING)
      reasons.push('Chưa có activity Reading hợp lệ.');
    if (!skillCoverage.WRITING)
      reasons.push('Chưa có activity Writing hợp lệ.');
    return {
      version: 2,
      lessons: lessonRows,
      requiredActivityCount: legacy.filter(
        (a) => a.required && a.published && a.hasQuestions,
      ).length,
      optionalActivityCount: 0,
      skillCoverage,
      readiness: !lessonRows.length
        ? 'EMPTY'
        : legacy.some((a) => !a.published || !a.hasQuestions)
          ? 'BROKEN'
          : Object.values(skillCoverage).every((count) => count > 0)
            ? 'READY'
            : 'PARTIAL',
      readinessReasons: reasons,
    };
  }
  const durableRows: ActivitySource[] = activities;
  for (const row of durableRows
    .slice()
    .sort((a, b) => a.order - b.order || a.id - b.id)) {
    const quiz =
      row.quiz ?? (row.quizId ? quizById.get(row.quizId) : undefined);
    const set = row.speakingPracticeSet;
    const skill =
      row.kind === 'SPEAKING'
        ? 'SPEAKING'
        : quiz
          ? skillForQuiz(quiz.type)
          : ['LISTENING', 'READING', 'WRITING'].includes(row.kind)
            ? (row.kind as CourseCurriculumSkill)
            : null;
    const validSet = skill === 'SPEAKING' && !!set;
    const isToeic = row.kind === 'TOEIC';
    const isGrammar = row.kind === 'GRAMMAR';
    const targetValid = isToeic
      ? Boolean(row.toeicExam && (row.toeicExam.groups?.length ?? 0) > 0)
      : isGrammar
        ? Boolean(
            row.grammarTopic && (row.grammarTopic.questions?.length ?? 0) > 0,
          )
        : true;
    const activity: CourseCurriculumActivity = {
      id: `activity:${row.id}`,
      sourceId: isToeic
        ? (row.toeicExam?.id ?? row.id)
        : isGrammar
          ? (row.grammarTopic?.id ?? row.id)
          : skill === 'SPEAKING'
            ? (set?.id ?? row.id)
            : (quiz?.id ?? row.id),
      kind: skill ?? (isToeic ? 'TOEIC' : isGrammar ? 'GRAMMAR' : 'LESSON'),
      skill,
      title:
        row.title ??
        set?.title ??
        quiz?.title ??
        row.toeicExam?.title ??
        row.grammarTopic?.title ??
        'Hoạt động học tập',
      description:
        set?.description ??
        quiz?.description ??
        row.toeicExam?.description ??
        row.grammarTopic?.description ??
        null,
      route:
        skill === 'SPEAKING' && set?.exercises?.[0]
          ? `/speaking/${set.exercises[0].id}?set=${encodeURIComponent(set.id)}`
          : isToeic && row.toeicExam
            ? `/toeic/${row.toeicExam.id}`
            : isGrammar && row.grammarTopic
              ? `/reading?category=grammar&topicId=${row.grammarTopic.id}`
              : routeForQuiz(skill, quiz?.id ?? 0),
      required: row.isRequired,
      published:
        skill === 'SPEAKING'
          ? validSet
          : isToeic || isGrammar
            ? targetValid
            : quiz?.publicationStatus === 'PUBLISHED',
      hasQuestions:
        skill === 'SPEAKING'
          ? validSet && (set?.exercises?.length ?? 0) > 0
          : isToeic || isGrammar
            ? targetValid
            : (quiz?._count?.questions ?? 0) > 0,
      isPremiumContent: Boolean(quiz?.isPremiumContent),
      lessonId: row.lessonId,
      order: row.order,
      speakingPracticeSetId: row.speakingPracticeSetId ?? null,
      toeicExamId: row.toeicExamId ?? null,
      grammarTopicId: row.grammarTopicId ?? null,
    };
    byLesson.get(row.lessonId)?.activities.push(activity);
  }
  const skillCoverage = {
    LISTENING: 0,
    SPEAKING: 0,
    READING: 0,
    WRITING: 0,
  } as Record<CourseCurriculumSkill, number>;
  const requiredSkillCoverage = new Set<CourseCurriculumSkill>();
  for (const lesson of lessonRows)
    for (const activity of lesson.activities)
      if (activity.skill && activity.published && activity.hasQuestions) {
        skillCoverage[activity.skill]++;
        if (activity.required) requiredSkillCoverage.add(activity.skill);
      }
  const reasons: string[] = [];
  if (!lessonRows.length) reasons.push('Course chưa có lesson.');
  const required = lessonRows
    .flatMap((lesson) => lesson.activities)
    .filter((activity) => activity.required);
  const broken = required.some(
    (activity) =>
      !activity.published || !activity.hasQuestions || !activity.route,
  );
  if (broken)
    reasons.push(
      'Có hoạt động bắt buộc thiếu nội dung, đích hoặc route hợp lệ.',
    );
  if (curriculumType === 'FOCUSED_GRAMMAR_VOCAB')
    return {
      version: 2,
      lessons: lessonRows,
      requiredActivityCount: required.length,
      optionalActivityCount: lessonRows
        .flatMap((l) => l.activities)
        .filter((a) => !a.required).length,
      skillCoverage,
      readiness: lessonRows.length ? (broken ? 'BROKEN' : 'FOCUSED') : 'EMPTY',
      readinessReasons: reasons,
    };
  if (curriculumType === 'TOEIC') {
    const courseActivities = lessonRows.flatMap((lesson) => lesson.activities);
    const hasValidToeicTarget =
      courseActivities.length > 0 &&
      required.length > 0 &&
      required.every(
        (activity) =>
          activity.published && activity.hasQuestions && activity.route,
      );
    if (!hasValidToeicTarget)
      reasons.push('Chưa có hoạt động TOEIC/Speaking/Writing hợp lệ.');
    return {
      version: 2,
      lessons: lessonRows,
      requiredActivityCount: required.length,
      optionalActivityCount: lessonRows
        .flatMap((l) => l.activities)
        .filter((a) => !a.required).length,
      skillCoverage,
      readiness:
        lessonRows.length && !broken && hasValidToeicTarget
          ? 'TOEIC'
          : lessonRows.length
            ? 'BROKEN'
            : 'EMPTY',
      readinessReasons: reasons,
    };
  }
  for (const skill of [
    'LISTENING',
    'SPEAKING',
    'READING',
    'WRITING',
  ] as CourseCurriculumSkill[])
    if (!requiredSkillCoverage.has(skill))
      reasons.push(`Chưa có activity ${skill} bắt buộc hợp lệ.`);
  const readiness = !lessonRows.length
    ? 'EMPTY'
    : broken
      ? 'BROKEN'
      : requiredSkillCoverage.size === 4
        ? 'READY'
        : 'PARTIAL';
  return {
    version: 2,
    lessons: lessonRows,
    requiredActivityCount: required.length,
    optionalActivityCount: lessonRows
      .flatMap((l) => l.activities)
      .filter((a) => !a.required).length,
    skillCoverage,
    readiness,
    readinessReasons: reasons,
  };
}
