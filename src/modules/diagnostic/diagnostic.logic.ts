export const MIN_DOMAIN_EVIDENCE = 3;

export type DiagnosticQuestionForScoring = {
  id: number;
  skill: string;
  question: string;
  options: unknown;
  correctIndex: number;
  explanation: string | null;
  order: number;
};

export type DiagnosticQuestionMeta = {
  values: string[];
  stableKey?: string;
  section?: string;
  construct?: string;
  intendedLevel?: 'A1' | 'A2' | 'B1' | 'B2';
  questionType?: 'MCQ' | 'OPEN_TEXT';
  passageText?: string | null;
  audioGroup?: string | null;
  audioUrl?: string | null;
  activeInForm?: boolean;
};

export function getQuestionMeta(
  question: DiagnosticQuestionForScoring,
): DiagnosticQuestionMeta {
  if (Array.isArray(question.options))
    return {
      values: question.options.filter(
        (value): value is string => typeof value === 'string',
      ),
      questionType: 'MCQ',
    };
  if (!question.options || typeof question.options !== 'object')
    return { values: [], questionType: 'MCQ' };
  const raw = question.options as Record<string, unknown>;
  return {
    values: Array.isArray(raw.values)
      ? raw.values.filter((value): value is string => typeof value === 'string')
      : [],
    stableKey: typeof raw.stableKey === 'string' ? raw.stableKey : undefined,
    section: typeof raw.section === 'string' ? raw.section : undefined,
    construct: typeof raw.construct === 'string' ? raw.construct : undefined,
    intendedLevel: ['A1', 'A2', 'B1', 'B2'].includes(String(raw.intendedLevel))
      ? (raw.intendedLevel as DiagnosticQuestionMeta['intendedLevel'])
      : undefined,
    questionType: raw.questionType === 'OPEN_TEXT' ? 'OPEN_TEXT' : 'MCQ',
    passageText: typeof raw.passageText === 'string' ? raw.passageText : null,
    audioGroup: typeof raw.audioGroup === 'string' ? raw.audioGroup : null,
    audioUrl: typeof raw.audioUrl === 'string' ? raw.audioUrl : null,
    activeInForm: raw.activeInForm !== false,
  };
}

export function getQuestionOptions(
  question: DiagnosticQuestionForScoring,
): string[] {
  return getQuestionMeta(question).values;
}

export function isOpenDiagnosticQuestion(
  question: DiagnosticQuestionForScoring,
): boolean {
  return getQuestionMeta(question).questionType === 'OPEN_TEXT';
}

export function resolvePlacementLevel(
  sectionScores: Record<string, number>,
  bandScores: Record<string, number>,
): string {
  const bands: Array<'A1' | 'A2' | 'B1' | 'B2'> = ['A1', 'A2', 'B1', 'B2'];
  const supported = bands.filter((band) => {
    const index = bands.indexOf(band);
    const lower = bands.slice(0, index).map((item) => bandScores[item] ?? 0);
    const lowerEvidence = lower.length
      ? lower.reduce((sum, value) => sum + value, 0) / lower.length
      : 100;
    return (bandScores[band] ?? 0) >= 70 && lowerEvidence >= 60;
  });
  const highest = supported.at(-1);
  if (highest) {
    return highest;
  }
  const weightedCore = sectionScores['CORE'] ?? 0;
  if (weightedCore >= 65) {
    if ((bandScores.B2 ?? 0) >= 55) return 'B1 — đang tiến tới B2';
    if ((bandScores.B1 ?? 0) >= 55) return 'A2 — đang tiến tới B1';
    if ((bandScores.A2 ?? 0) >= 55) return 'A1 — đang tiến tới A2';
  }
  if (weightedCore >= 55) return 'A2';
  if (weightedCore >= 40) return 'A1';
  return 'Pre-A1 / Beginner foundation needed';
}

export type DiagnosticSkillProfile = {
  skill: string;
  correctCount: number;
  totalCount: number;
  percentage: number | null;
  evidence: 'SUFFICIENT' | 'INSUFFICIENT';
};

export type DiagnosticCourseCandidate = {
  id: number;
  title: string;
  description: string | null;
  level: string | null;
  status: string;
  lessonCount: number;
  /** Only curriculum-ready courses may be recommended by production code. */
  curriculumReady?: boolean;
};

export type DiagnosticRecommendation = {
  courseId: number;
  title: string;
  level: string | null;
  rank: number;
  relevance: number;
  reason: string;
  recommendedLesson?: { id: number; title: string } | null;
  advisoryOnly?: boolean;
};

export function validateQuestionBank(
  questions: DiagnosticQuestionForScoring[],
): string[] {
  const defects: string[] = [];
  const ids = new Set<number>();
  const orders = new Set<number>();
  for (const question of questions) {
    if (ids.has(question.id))
      defects.push(`duplicate question id ${question.id}`);
    ids.add(question.id);
    if (orders.has(question.order))
      defects.push(`duplicate order ${question.order}`);
    orders.add(question.order);
    if (!question.question?.trim()) defects.push(`empty prompt ${question.id}`);
    const meta = getQuestionMeta(question);
    if (meta.questionType === 'OPEN_TEXT') {
      if (
        !meta.stableKey ||
        !meta.section ||
        !meta.construct ||
        !meta.intendedLevel
      )
        defects.push(`incomplete open task metadata ${question.id}`);
    } else {
      if (meta.values.length < 2)
        defects.push(`invalid options ${question.id}`);
      if (meta.values.some((option) => typeof option !== 'string'))
        defects.push(`non-string option ${question.id}`);
      if (new Set(meta.values).size !== meta.values.length)
        defects.push(`duplicate option ${question.id}`);
      if (
        !Number.isInteger(question.correctIndex) ||
        question.correctIndex < 0 ||
        question.correctIndex >= meta.values.length
      ) {
        defects.push(`invalid correct index ${question.id}`);
      }
    }
    if (!question.skill?.trim()) defects.push(`missing skill ${question.id}`);
  }
  return defects;
}

export function resolveEstimatedLevel(percentage: number): string {
  if (percentage >= 75) return 'Intermediate';
  if (percentage >= 45) return 'Foundation';
  return 'Starter';
}

export function buildSkillProfiles(
  questions: DiagnosticQuestionForScoring[],
  answers: Record<string, unknown>,
): DiagnosticSkillProfile[] {
  const grouped = new Map<string, { correct: number; total: number }>();
  for (const question of questions) {
    const current = grouped.get(question.skill) ?? { correct: 0, total: 0 };
    current.total += 1;
    if (answers[String(question.id)] === question.correctIndex)
      current.correct += 1;
    grouped.set(question.skill, current);
  }
  return [...grouped.entries()].map(([skill, value]) => ({
    skill,
    correctCount: value.correct,
    totalCount: value.total,
    percentage:
      value.total >= MIN_DOMAIN_EVIDENCE
        ? Math.round((value.correct / value.total) * 100)
        : null,
    evidence:
      value.total >= MIN_DOMAIN_EVIDENCE ? 'SUFFICIENT' : 'INSUFFICIENT',
  }));
}

export function buildStrengthsAndWeaknesses(
  profiles: DiagnosticSkillProfile[],
) {
  const measured = profiles.filter((profile) => profile.percentage !== null);
  return {
    strengths: measured
      .filter((profile) => (profile.percentage ?? 0) >= 75)
      .sort((a, b) => (b.percentage ?? 0) - (a.percentage ?? 0))
      .map((profile) => profile.skill),
    weaknesses: measured
      .filter((profile) => (profile.percentage ?? 0) < 60)
      .sort((a, b) => (a.percentage ?? 0) - (b.percentage ?? 0))
      .map((profile) => profile.skill),
  };
}

function courseBand(
  level: string | null,
): 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED' | null {
  if (!level) return null;
  const normalized = level.toUpperCase();
  if (
    normalized.includes('BEGINNER') ||
    normalized.includes('A1') ||
    normalized.includes('A2')
  )
    return 'BEGINNER';
  if (
    normalized.includes('INTERMEDIATE') ||
    normalized.includes('B1') ||
    normalized.includes('B2')
  )
    return 'INTERMEDIATE';
  if (
    normalized.includes('ADVANCED') ||
    normalized.includes('C1') ||
    normalized.includes('C2')
  )
    return 'ADVANCED';
  return null;
}

function expectedBand(level: string): 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED' {
  const normalized = level.toUpperCase();
  if (
    normalized.includes('B2') ||
    normalized.includes('C1') ||
    normalized.includes('C2')
  )
    return 'ADVANCED';
  if (normalized.includes('B1') || normalized.includes('INTERMEDIATE'))
    return 'INTERMEDIATE';
  return 'BEGINNER';
}

function courseFocus(course: DiagnosticCourseCandidate): string[] {
  const text = `${course.title} ${course.description ?? ''}`.toLowerCase();
  const focus: string[] = [];
  if (/listening|nghe/.test(text)) focus.push('Listening');
  if (/speaking|nói|phát âm/.test(text)) focus.push('Speaking');
  if (/reading|đọc/.test(text)) focus.push('Reading');
  if (/writing|viết/.test(text)) focus.push('Writing');
  if (/grammar|ngữ pháp/.test(text)) focus.push('Grammar');
  if (/vocabulary|từ vựng/.test(text)) focus.push('Vocabulary');
  return focus;
}

export function rankCourseRecommendations(
  candidates: DiagnosticCourseCandidate[],
  level: string,
  weaknesses: string[],
): DiagnosticRecommendation[] {
  const target = expectedBand(level);
  return candidates
    .filter(
      (course) =>
        course.status === 'PUBLISHED' &&
        course.lessonCount > 0 &&
        course.curriculumReady !== false,
    )
    .filter(
      (course) => !/toeic/i.test(`${course.title} ${course.description ?? ''}`),
    )
    .map((course) => {
      const band = courseBand(course.level);
      const levelScore = band === target ? 60 : band ? 25 : 10;
      const coveredWeaknesses = weaknesses.filter((skill) =>
        courseFocus(course).includes(skill),
      );
      const relevance =
        levelScore + Math.min(20, coveredWeaknesses.length * 10) + 20;
      const reason = coveredWeaknesses.length
        ? `Phù hợp với mức khởi điểm ${level} và tập trung vào ${coveredWeaknesses.join(', ')} — miền bạn cần củng cố.`
        : `Phù hợp với mức khởi điểm ${level} theo dữ liệu khóa học đã xuất bản.`;
      return { course, relevance, reason };
    })
    .sort((a, b) => b.relevance - a.relevance || a.course.id - b.course.id)
    .slice(0, 3)
    .map((item, index) => ({
      courseId: item.course.id,
      title: item.course.title,
      level: item.course.level,
      rank: index + 1,
      relevance: item.relevance,
      reason: item.reason,
    }));
}
