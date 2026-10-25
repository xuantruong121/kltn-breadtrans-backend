export const MIN_DOMAIN_EVIDENCE = 3;

export const CANONICAL_DIAGNOSTIC_BLUEPRINT = {
  version: '2.0',
  totalItems: 52,
  objectiveCount: 48,
  productiveCount: 4,
  sections: {
    LANGUAGE_USE: {
      name: 'Ngữ pháp & Từ vựng',
      total: 16,
      objective: 16,
      productive: 0,
      skills: ['Grammar', 'Vocabulary'],
      grammarTotal: 8,
      vocabularyTotal: 8,
    },
    READING: {
      name: 'Đọc hiểu',
      total: 16,
      objective: 16,
      productive: 0,
      skills: ['Reading'],
    },
    LISTENING: {
      name: 'Nghe hiểu',
      total: 16,
      objective: 16,
      productive: 0,
      skills: ['Listening'],
    },
    SPEAKING: {
      name: 'Nói',
      total: 2,
      objective: 0,
      productive: 2,
      skills: ['Speaking'],
    },
    WRITING: {
      name: 'Viết',
      total: 2,
      objective: 0,
      productive: 2,
      skills: ['Writing'],
    },
  },
};

export function getAttemptQuestionPermutation(
  attemptId: number,
  questionId: number,
  optionCount: number,
): number[] {
  const indices = Array.from({ length: optionCount }, (_, i) => i);
  if (optionCount <= 1) return indices;
  let seed = (Math.abs(attemptId) * 10007 + questionId * 37) % 2147483647;
  for (let i = indices.length - 1; i > 0; i--) {
    seed = (seed * 16807 + 11) % 2147483647;
    const j = seed % (i + 1);
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
}

export type DiagnosticQuestionForScoring = {
  id: number;
  skill: string;
  question: string;
  options: unknown;
  correctIndex: number;
  explanation?: string | null;
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

export function isDiagnosticAnswerCorrect(
  question: DiagnosticQuestionForScoring,
  answer: unknown,
  permutation?: number[],
): boolean {
  if (isOpenDiagnosticQuestion(question)) return false;
  if (answer === undefined || answer === null) return false;

  const meta = getQuestionMeta(question);
  const options = meta.values;
  const correctText = options[question.correctIndex];

  // 1. Exact string match against original correct option text
  if (typeof answer === 'string' && typeof correctText === 'string') {
    if (answer.trim() === correctText.trim()) return true;
  }

  // 2. Object with text, value, or stable originalIndex
  if (typeof answer === 'object' && answer !== null) {
    const rawObj = answer as Record<string, unknown>;
    if (typeof rawObj.originalIndex === 'number') {
      return rawObj.originalIndex === question.correctIndex;
    }
    if (typeof rawObj.value === 'string' && typeof correctText === 'string') {
      if (rawObj.value.trim() === correctText.trim()) return true;
    }
    if (typeof rawObj.text === 'string' && typeof correctText === 'string') {
      if (rawObj.text.trim() === correctText.trim()) return true;
    }
    if (typeof rawObj.index === 'number') {
      answer = rawObj.index;
    }
  }

  // 3. Numeric index
  if (typeof answer === 'number') {
    if (
      permutation &&
      Array.isArray(permutation) &&
      permutation[answer] !== undefined
    ) {
      return permutation[answer] === question.correctIndex;
    }
    return answer === question.correctIndex;
  }

  return false;
}

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
    if (highest === 'B2') return 'B2 – Trung cấp trên';
    if (highest === 'B1') return 'B1 – Trung cấp';
    if (highest === 'A2') return 'A2 – Sơ trung cấp';
    if (highest === 'A1') return 'A1 – Sơ cấp';
    return highest;
  }
  const weightedCore = sectionScores['CORE'] ?? 0;
  if (weightedCore >= 65) {
    if ((bandScores.B2 ?? 0) >= 55) return 'B1 – Đang tiến tới B2';
    if ((bandScores.B1 ?? 0) >= 55) return 'A2 – Đang tiến tới B1';
    if ((bandScores.A2 ?? 0) >= 55) return 'A1 – Đang tiến tới A2';
  }
  if (weightedCore >= 55) return 'A2 – Sơ trung cấp';
  if (weightedCore >= 40) return 'A1 – Sơ cấp';
  return 'Pre-A1 – Cần củng cố nền tảng';
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
    if (meta.section === 'LISTENING' && !meta.audioUrl?.trim()) {
      defects.push(`missing listening audio ${question.id}`);
    }
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
  permutations?: Record<number, number[]>,
): DiagnosticSkillProfile[] {
  const grouped = new Map<string, { correct: number; total: number }>();
  for (const question of questions) {
    const current = grouped.get(question.skill) ?? { correct: 0, total: 0 };
    current.total += 1;
    const answer = answers[String(question.id)];
    const perm = permutations?.[question.id];
    if (isDiagnosticAnswerCorrect(question, answer, perm)) {
      current.correct += 1;
    }
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
    strengths: Array.from(
      new Set(
        measured
          .filter((profile) => (profile.percentage ?? 0) >= 75)
          .sort((a, b) => (b.percentage ?? 0) - (a.percentage ?? 0))
          .map((profile) => profile.skill),
      ),
    ),
    weaknesses: Array.from(
      new Set(
        measured
          .filter((profile) => (profile.percentage ?? 0) < 60)
          .sort((a, b) => (a.percentage ?? 0) - (b.percentage ?? 0))
          .map((profile) => profile.skill),
      ),
    ),
  };
}

export type DiagnosticPracticeRecommendation = {
  id: string;
  skill: string;
  title: string;
  description: string;
  route: string;
  badge: string;
  fallback?: boolean;
};

export function buildPracticeRecommendations(
  level: string,
  weaknesses: string[],
  wrongQuestions?: DiagnosticQuestionForScoring[],
): DiagnosticPracticeRecommendation[] {
  const recommendations: DiagnosticPracticeRecommendation[] = [];
  const addedIds = new Set<string>();

  const pushRec = (rec: DiagnosticPracticeRecommendation) => {
    if (!addedIds.has(rec.id) && recommendations.length < 5) {
      addedIds.add(rec.id);
      recommendations.push(rec);
    }
  };

  // 1. Specific recommendation derived from wrong questions
  if (wrongQuestions && wrongQuestions.length > 0) {
    for (const q of wrongQuestions) {
      if (isOpenDiagnosticQuestion(q)) continue;
      const meta = getQuestionMeta(q);
      const construct = (meta.construct || '').toLowerCase();
      const intendedLevel = meta.intendedLevel || 'A1';
      const skill = q.skill;

      if (skill === 'Grammar') {
        if (
          construct.includes('present') ||
          construct.includes('be') ||
          construct.includes('singular')
        ) {
          pushRec({
            id: 'rec-gram-present',
            skill: 'Ngữ pháp',
            title: 'Present Simple & Adverbs of Frequency',
            description:
              'Củng cố thì hiện tại đơn, chia động từ to be và vị trí trạng từ tần suất.',
            route: '/reading?category=grammar&topicId=1',
            badge: 'Ngữ pháp A1',
          });
        } else if (construct.includes('past')) {
          pushRec({
            id: 'rec-gram-past',
            skill: 'Ngữ pháp',
            title: 'Past Simple & Time Expressions',
            description:
              'Ôn tập thì quá khứ đơn, động từ bất quy tắc và dấu hiệu mốc thời gian đã kết thúc.',
            route: '/reading?category=grammar&topicId=2',
            badge: 'Ngữ pháp A2',
          });
        } else if (construct.includes('future')) {
          pushRec({
            id: 'rec-gram-future',
            skill: 'Ngữ pháp',
            title: 'Future Forms & Diễn đạt tương lai',
            description:
              'Nắm vững phân biệt will và be going to khi diễn đạt dự định và dự đoán có căn cứ.',
            route: '/reading?category=grammar&topicId=4',
            badge: 'Ngữ pháp A2',
          });
        } else if (construct.includes('modal')) {
          pushRec({
            id: 'rec-gram-modal',
            skill: 'Ngữ pháp',
            title: 'Modals & Polite Requests',
            description:
              'Củng cố cách dùng động từ khuyết thiếu (must, should, can) và yêu cầu lịch sự.',
            route: '/reading?category=grammar&topicId=6',
            badge: 'Ngữ pháp A2',
          });
        } else if (construct.includes('perfect')) {
          pushRec({
            id: 'rec-gram-perfect',
            skill: 'Ngữ pháp',
            title: 'Present Perfect & Thì hoàn thành',
            description:
              'Rèn luyện thì hiện tại hoàn thành với since, for và đối chiếu quá khứ đơn.',
            route: '/reading?category=grammar&topicId=3',
            badge: 'Ngữ pháp B1',
          });
        } else if (construct.includes('relative')) {
          pushRec({
            id: 'rec-gram-relative',
            skill: 'Ngữ pháp',
            title: 'Relative Clauses & Mệnh đề quan hệ',
            description:
              'Phân biệt chính xác đại từ quan hệ who, which, that trong câu phức.',
            route: '/reading?category=grammar&topicId=10',
            badge: 'Ngữ pháp B1',
          });
        } else if (construct.includes('condition')) {
          pushRec({
            id: 'rec-gram-conditionals',
            skill: 'Ngữ pháp',
            title: 'Conditionals & Câu điều kiện',
            description:
              'Nắm chắc cấu trúc câu điều kiện loại 1 & 2 khi sử dụng mệnh đề if.',
            route: '/reading?category=grammar&topicId=9',
            badge: 'Ngữ pháp B1',
          });
        }
      } else if (skill === 'Vocabulary') {
        if (
          construct.includes('preposition') ||
          construct.includes('article') ||
          construct.includes('daily') ||
          construct.includes('school') ||
          construct.includes('object')
        ) {
          pushRec({
            id: 'rec-vocab-routines',
            skill: 'Từ vựng',
            title: 'Daily Routines & Time',
            description:
              'Mở rộng từ vựng sinh hoạt thường ngày, đồ dùng và mốc thời gian.',
            route: '/vocabulary/study?topicId=1',
            badge: 'Từ vựng A1',
          });
        } else if (
          construct.includes('collocation') ||
          construct.includes('travel')
        ) {
          pushRec({
            id: 'rec-vocab-travel',
            skill: 'Từ vựng',
            title: 'Travel & Transportation',
            description:
              'Trau dồi các cụm từ kết hợp (collocations) và từ vựng di chuyển thực tế.',
            route: '/vocabulary/study?topicId=2',
            badge: 'Từ vựng A2',
          });
        } else if (
          construct.includes('formation') ||
          construct.includes('register') ||
          construct.includes('precision') ||
          construct.includes('word-form') ||
          construct.includes('phrasal') ||
          construct.includes('workplace')
        ) {
          pushRec({
            id: 'rec-vocab-office',
            skill: 'Từ vựng',
            title: 'Office & Meetings',
            description:
              'Rèn luyện từ vựng công sở, chuyển đổi từ loại và văn phong trang trọng.',
            route: '/vocabulary/study?topicId=3',
            badge: 'Từ vựng B1',
          });
        }
      } else if (skill === 'Reading') {
        if (intendedLevel === 'A1' || intendedLevel === 'A2') {
          pushRec({
            id: 'rec-read-notices',
            skill: 'Đọc hiểu',
            title: 'Reading A2 — Notices & Messages',
            description:
              'Luyện kỹ năng đọc quét thông tin (scanning) trong thông báo ngắn và biển hiệu.',
            route: '/reading/2',
            badge: 'Đọc hiểu A2',
          });
        } else if (intendedLevel === 'B1') {
          pushRec({
            id: 'rec-read-workplace',
            skill: 'Đọc hiểu',
            title: 'Reading B1 — Workplace Documents',
            description:
              'Đọc hiểu email trao đổi công việc và tài liệu nội bộ để xác định mục đích chính.',
            route: '/reading/6',
            badge: 'Đọc hiểu B1',
          });
        } else if (intendedLevel === 'B2') {
          pushRec({
            id: 'rec-read-reports',
            skill: 'Đọc hiểu',
            title: 'Reading B2 — Workplace & Reports',
            description:
              'Nâng cao khả năng phân tích báo cáo công việc và suy luận ý đồ tác giả.',
            route: '/reading/15',
            badge: 'Đọc hiểu B2',
          });
        }
      } else if (skill === 'Listening') {
        if (intendedLevel === 'A1') {
          pushRec({
            id: 'rec-listen-essential',
            skill: 'Nghe hiểu',
            title: 'Listening A1 — Essential Everyday English',
            description:
              'Luyện nghe các thông báo ngắn về thời gian, địa điểm và sinh hoạt hằng ngày.',
            route: '/listening/9',
            badge: 'Nghe hiểu A1',
          });
        } else if (intendedLevel === 'A2') {
          pushRec({
            id: 'rec-listen-comm',
            skill: 'Nghe hiểu',
            title: 'Listening A2 — Everyday Communication',
            description:
              'Luyện nghe hội thoại giao tiếp thường nhật và tin nhắn thoại có nhiều chi tiết.',
            route: '/listening/1',
            badge: 'Nghe hiểu A2',
          });
        } else {
          pushRec({
            id: 'rec-listen-workplace',
            skill: 'Nghe hiểu',
            title: 'Listening B1 — Workplace Conversations',
            description:
              'Nghe hội thoại nơi làm việc, nắm bắt thay đổi lịch trình và hành động tiếp theo.',
            route: '/listening/5',
            badge: 'Nghe hiểu B1',
          });
        }
      }
    }
  }

  // 2. Specific recommendations from weaknesses if still under 3
  for (const weakness of weaknesses) {
    if (recommendations.length >= 4) break;
    if (weakness === 'Grammar') {
      pushRec({
        id: 'rec-gram-fallback',
        skill: 'Ngữ pháp',
        title: 'Present Simple & Adverbs of Frequency',
        description:
          'Củng cố các cấu trúc câu, trật tự từ và các thì ngữ pháp trọng tâm.',
        route: '/reading?category=grammar&topicId=1',
        badge: 'Ngữ pháp A1',
        fallback: true,
      });
    } else if (weakness === 'Vocabulary') {
      pushRec({
        id: 'rec-vocab-fallback',
        skill: 'Từ vựng',
        title: 'Daily Routines & Time',
        description:
          'Mở rộng vốn từ vựng nền tảng thông qua bài tập phản xạ và ngữ cảnh.',
        route: '/vocabulary/study?topicId=1',
        badge: 'Từ vựng A1',
        fallback: true,
      });
    } else if (weakness === 'Reading') {
      pushRec({
        id: 'rec-read-fallback',
        skill: 'Đọc hiểu',
        title: 'Reading A1–A2 — Everyday Texts',
        description:
          'Rèn luyện khả năng đọc hiểu ý chính và thông tin chi tiết qua đoạn văn ngắn.',
        route: '/reading/13',
        badge: 'Đọc hiểu A1–A2',
        fallback: true,
      });
    } else if (weakness === 'Listening') {
      pushRec({
        id: 'rec-listen-fallback',
        skill: 'Nghe hiểu',
        title: 'Listening A1 — Essential Everyday English',
        description:
          'Luyện nghe các thông báo ngắn và câu hỏi phản xạ thường nhật.',
        route: '/listening/9',
        badge: 'Nghe hiểu A1',
        fallback: true,
      });
    } else if (weakness === 'Speaking') {
      pushRec({
        id: 'rec-speak-fallback',
        skill: 'Nói',
        title: 'Pronunciation Foundations',
        description:
          'Thực hành phát âm chuẩn IPA, ngữ điệu câu và phản xạ giao tiếp cơ bản.',
        route: '/speaking/pronunciation-foundations',
        badge: 'Kỹ năng Nói',
        fallback: true,
      });
    } else if (weakness === 'Writing') {
      pushRec({
        id: 'rec-write-fallback',
        skill: 'Viết',
        title: 'Writing A2–B1 — Sentence Builder',
        description:
          'Luyện kỹ năng xây dựng câu hoàn chỉnh và diễn đạt ý mạch lạc.',
        route: '/writing/3',
        badge: 'Kỹ năng Viết',
        fallback: true,
      });
    }
  }

  // 3. Fallback fill if fewer than 3 items
  const fallbacks: DiagnosticPracticeRecommendation[] = [
    {
      id: 'rec-gram-default',
      skill: 'Ngữ pháp',
      title: 'Present Simple & Adverbs of Frequency',
      description: 'Củng cố nền tảng ngữ pháp câu và thì cơ bản.',
      route: '/reading?category=grammar&topicId=1',
      badge: 'Ngữ pháp A1',
      fallback: true,
    },
    {
      id: 'rec-vocab-default',
      skill: 'Từ vựng',
      title: 'Daily Routines & Time',
      description:
        'Trau dồi từ vựng thông dụng và cấu trúc giao tiếp hằng ngày.',
      route: '/vocabulary/study?topicId=1',
      badge: 'Từ vựng A1',
      fallback: true,
    },
    {
      id: 'rec-read-default',
      skill: 'Đọc hiểu',
      title: 'Reading A1–A2 — Everyday Texts',
      description:
        'Luyện đọc các đoạn văn thực tế ngắn với câu hỏi trắc nghiệm.',
      route: '/reading/13',
      badge: 'Đọc hiểu A1–A2',
      fallback: true,
    },
    {
      id: 'rec-listen-default',
      skill: 'Nghe hiểu',
      title: 'Listening A1 — Essential Everyday English',
      description: 'Luyện nghe phản xạ với các bài nghe ngắn kèm transcript.',
      route: '/listening/9',
      badge: 'Nghe hiểu A1',
      fallback: true,
    },
  ];

  for (const item of fallbacks) {
    if (recommendations.length >= 3) break;
    pushRec(item);
  }

  return recommendations.slice(0, 5);
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

/**
 * Which scoring algorithm an assessment is eligible for.
 *
 * This is deliberately derived from the structural metadata the algorithms
 * actually need, never from presentation data. An earlier implementation chose
 * the algorithm with `assessment.id === 2 || title.includes('v2')`, which meant
 * renaming an assessment silently changed every learner's score, and which
 * could select the section/band algorithm for items that carry no section
 * metadata at all - scoring every learner Pre-A1 regardless of their answers.
 */
export type DiagnosticScoringVersion =
  'OBJECTIVE_POOLED_V1' | 'SECTION_BAND_V2';

/** The metadata SECTION_BAND_V2 cannot work without. */
export type DiagnosticScoringCapability = {
  version: DiagnosticScoringVersion;
  /** Objective items carrying BOTH a section and an intended CEFR band. */
  itemsWithBandMetadata: number;
  objectiveItems: number;
  reason: string;
};

/**
 * Resolve the scoring version from item structure.
 *
 * SECTION_BAND_V2 is only offered when every objective item carries the
 * section and intendedLevel metadata its formulas read. Partial coverage falls
 * back to the pooled scorer rather than silently scoring the uncovered
 * sections as zero.
 */
export function resolveDiagnosticScoringVersion(
  questions: DiagnosticQuestionForScoring[],
): DiagnosticScoringCapability {
  const objective = questions.filter(
    (question) => !isOpenDiagnosticQuestion(question),
  );
  const withBandMetadata = objective.filter((question) => {
    const meta = getQuestionMeta(question);
    return Boolean(meta.section) && Boolean(meta.intendedLevel);
  });
  if (objective.length > 0 && withBandMetadata.length === objective.length) {
    return {
      version: 'SECTION_BAND_V2',
      itemsWithBandMetadata: withBandMetadata.length,
      objectiveItems: objective.length,
      reason:
        'every objective item carries section and intendedLevel metadata, so section and band percentages are computable',
    };
  }
  return {
    version: 'OBJECTIVE_POOLED_V1',
    itemsWithBandMetadata: withBandMetadata.length,
    objectiveItems: objective.length,
    reason:
      objective.length === 0
        ? 'no objective items to score'
        : `${withBandMetadata.length}/${objective.length} objective items carry section+intendedLevel metadata, which is insufficient for section/band scoring`,
  };
}

/**
 * Fail closed before running SECTION_BAND_V2. Its formulas return 0 for any
 * section with no matching items, so running it against items that lack the
 * metadata would produce a confident but meaningless placement.
 */
export function assertSectionBandV2Scorable(
  questions: DiagnosticQuestionForScoring[],
): void {
  const capability = resolveDiagnosticScoringVersion(questions);
  if (capability.version !== 'SECTION_BAND_V2') {
    throw new Error(
      `DIAGNOSTIC_SCORER_UNSUPPORTED: section/band scoring requires section+intendedLevel on every objective item (${capability.reason})`,
    );
  }
  // The catastrophic case is a form where none of the weighted sections match
  // any item: every section percentage would be 0, weightedCore would be 0 and
  // every learner would be placed at the bottom band with full confidence.
  // A form that covers only some weighted sections still produces meaningful
  // non-zero scores for the sections it has, so that is left to content
  // authoring rather than refused here.
  const weightedSections = ['LANGUAGE_USE', 'READING', 'LISTENING'];
  const covered = weightedSections.filter((section) =>
    questions.some(
      (question) =>
        getQuestionMeta(question).section === section &&
        !isOpenDiagnosticQuestion(question),
    ),
  );
  if (!covered.length) {
    throw new Error(
      `DIAGNOSTIC_SCORER_UNSUPPORTED: section/band scoring requires objective items in at least one of ${weightedSections.join(', ')}`,
    );
  }
}

/**
 * Describe the form that was actually administered, from its own items.
 *
 * CANONICAL_DIAGNOSTIC_BLUEPRINT describes a 52-item form that exists in no
 * backup and in no live database; presenting it to a learner as "canonical"
 * alongside a 20-item result overstated what was administered.
 */
export function describeAdministeredForm(
  questions: DiagnosticQuestionForScoring[],
) {
  const objective = questions.filter(
    (question) => !isOpenDiagnosticQuestion(question),
  );
  const bySkill: Record<string, number> = {};
  for (const question of questions) {
    bySkill[question.skill] = (bySkill[question.skill] ?? 0) + 1;
  }
  return {
    totalItems: questions.length,
    objectiveCount: objective.length,
    productiveCount: questions.length - objective.length,
    itemsBySkill: bySkill,
  };
}

/**
 * The scorer production runs for the Entry Diagnostic, stated explicitly.
 *
 * Earlier revisions inferred this twice over: first from the assessment's id
 * and title (so a rename changed every learner's score), then from the items'
 * own metadata (so enriching content with `section`/`intendedLevel` would have
 * silently switched algorithm). Scoring semantics must not move because
 * content metadata got richer, so the production scorer is now a constant.
 *
 * SECTION_BAND_V2 stays in the source because it is tested and may be used
 * once a 52-item form is actually authored - it exists in no canonical backup
 * today. It is reachable only by naming it explicitly, and
 * `assertSectionBandV2Scorable` still refuses to run it against a form that
 * lacks the structure its formulas read.
 *
 * When that content is authored, replace this constant with a persisted
 * `scoringVersion` on the assessment; do not reintroduce inference.
 */
export const CURRENT_AUTHORED_FORM_SCORER: DiagnosticScoringVersion =
  'OBJECTIVE_POOLED_V1';

/**
 * Scoring versions this build knows how to run.
 *
 * `CURRENT_AUTHORED_FORM_SCORER` above was the transitional application-level
 * constant used before the version was persisted. Now that every assessment
 * carries `scoringVersion`, production resolves the scorer from that stored
 * value, and this set is what makes an unknown or unimplemented version fail
 * closed instead of silently falling back to whatever the code last defaulted
 * to.
 */
export const SUPPORTED_DIAGNOSTIC_SCORING_VERSIONS = [
  'OBJECTIVE_POOLED_V1',
] as const satisfies readonly DiagnosticScoringVersion[];

/**
 * Scoring versions that are defined but not yet runnable in production.
 * FOUR_SKILL_PLACEMENT_V2 is authored content-side first (Step 2); until its
 * scorer is implemented, an assessment claiming it must be refused rather than
 * scored by the V1 algorithm.
 */
export const KNOWN_UNIMPLEMENTED_SCORING_VERSIONS = [
  'FOUR_SKILL_PLACEMENT_V2',
  'SECTION_BAND_V2',
] as const;

/**
 * Resolve the scorer for an assessment from its PERSISTED version.
 *
 * Deliberately takes only the stored version string: no id, title, question
 * count, skill label or item metadata is in scope, so none of them can change
 * which algorithm runs (DIAG-002 and DIAG-008).
 */
export function resolvePersistedScoringVersion(
  persisted: string | null | undefined,
): DiagnosticScoringVersion {
  const value = (persisted ?? '').trim();
  if (!value) {
    throw new Error(
      'DIAGNOSTIC_SCORER_UNSUPPORTED: assessment has no persisted scoringVersion',
    );
  }
  if (
    (SUPPORTED_DIAGNOSTIC_SCORING_VERSIONS as readonly string[]).includes(value)
  ) {
    return value as DiagnosticScoringVersion;
  }
  if (
    (KNOWN_UNIMPLEMENTED_SCORING_VERSIONS as readonly string[]).includes(value)
  ) {
    throw new Error(
      `DIAGNOSTIC_SCORER_UNSUPPORTED: scoringVersion "${value}" is known but its scorer is not implemented in this build`,
    );
  }
  throw new Error(
    `DIAGNOSTIC_SCORER_UNSUPPORTED: unknown scoringVersion "${value}"`,
  );
}
