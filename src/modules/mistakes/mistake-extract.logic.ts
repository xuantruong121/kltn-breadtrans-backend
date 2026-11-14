/**
 * Mistake notebook: what a graded attempt says about each thing the learner
 * answered (owner 2026-11-11).
 *
 * An attempt becomes a list of observations: this question was answered wrong
 * (with a snapshot to show later) or right. The notebook keeps one row per
 * item; a wrong answer opens or reopens it, and RESOLVE_AFTER_CORRECT right
 * answers in a row close it. Writing corrections and weak words are items
 * too: a correction has no "right answer" event and is closed by the learner;
 * a word closes when later recordings pronounce it well. A translated
 * sentence ("Dịch câu") is answered again in the notebook, by typing.
 *
 * Pure: no Prisma, no I/O.
 */

export const MISTAKE_SKILLS = [
  'LISTENING',
  'SPEAKING',
  'READING',
  'WRITING',
  'GRAMMAR',
] as const;
export type MistakeSkill = (typeof MISTAKE_SKILLS)[number];

export const MISTAKE_SOURCES = [
  'QUIZ_QUESTION',
  'GRAMMAR_QUESTION',
  'WRITING_CORRECTION',
  'SPEAKING_WORD',
  'TRANSLATION_SENTENCE',
] as const;
export type MistakeSource = (typeof MISTAKE_SOURCES)[number];

/** Right answers in a row that close a mistake. */
export const RESOLVE_AFTER_CORRECT = 2;
/** A word scored below this is weak; from SPEAKING_GOOD_FROM it counts as right. */
export const SPEAKING_WEAK_BELOW = 60;
export const SPEAKING_GOOD_FROM = 80;
const MAX_ITEMS_PER_ATTEMPT = 40;
const PASSAGE_MAX = 1500;
const TEXT_MAX = 600;

export type MistakeDetail = {
  kind: 'CHOICE' | 'DICTATION' | 'CORRECTION' | 'WORD' | 'TRANSLATION';
  /** Where it came from, in the learner's words: quiz title, exam, topic. */
  title: string;
  question?: string;
  /** Reading passage; for listening, the transcript (shown only with the key). */
  passage?: string;
  passageKind?: 'PASSAGE' | 'TRANSCRIPT';
  options?: string[];
  selectedIndex?: number | null;
  correctIndex?: number;
  explanation?: string;
  yourAnswer?: string;
  correctAnswer?: string;
  /** Word accuracy, 0-100. */
  score?: number;
  /** The item can be answered again inside the notebook (choice or typed translation). */
  answerable: boolean;
  /** Ids for links and for the tutor; the frontend builds the addresses. */
  ref: {
    quizId?: number;
    submissionId?: number;
    questionId?: number;
    attemptId?: number;
    topicId?: number;
    exerciseId?: number;
  };
};

export type MistakeObservation = {
  sourceType: MistakeSource;
  itemKey: string;
  skill: MistakeSkill;
  tag: string | null;
  outcome: 'WRONG' | 'CORRECT';
  at: Date;
  /** Present on WRONG. */
  detail?: MistakeDetail;
};

const clean = (value: unknown, max = TEXT_MAX): string => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
};
const optionList = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((o) => clean(o, 300)).filter(Boolean) : [];
const validIndex = (value: unknown, length: number): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n < length ? n : null;
};

/** A stable key for free text (a correction, a word): lower case, one space. */
export function textKey(...parts: string[]): string {
  return parts
    .map((p) =>
      p.replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase(),
    )
    .join('→')
    .slice(0, 191);
}

/** The reading sub-skill a question trains, as the reading tracking names it. */
function readingSubskill(content: Record<string, unknown>): string | null {
  for (const key of ['questionType', 'category', 'subskill']) {
    const value = content[key];
    if (typeof value !== 'string' || !value.trim()) continue;
    const code = value.trim().toUpperCase().slice(0, 120);
    if (code !== 'READING' && code !== 'BILINGUAL_READING') return code;
  }
  return null;
}

const READING_TAG_VI: Record<string, string> = {
  MAIN_IDEA: 'ý chính',
  DETAIL: 'chi tiết',
  INFERENCE: 'suy luận',
  PURPOSE: 'mục đích',
  VOCAB_IN_CONTEXT: 'từ vựng trong ngữ cảnh',
};

const QUIZ_SKILL: Record<string, MistakeSkill> = {
  LISTENING_PRACTICE: 'LISTENING',
  BILINGUAL_READING: 'READING',
};

/**
 * A practice quiz submission (listening or reading). Choice answers are
 * stored as the option text, or as `{ selectedIndex }`.
 */
export function quizObservations(submission: {
  id: number;
  submittedAt: Date;
  quiz: { id: number; type: string; title: string };
  questions: Array<{ id: number; type: string; content: unknown }>;
  results: Array<{
    questionId: number;
    answer: unknown;
    isCorrect: boolean | null;
  }>;
}): MistakeObservation[] {
  const skill = QUIZ_SKILL[submission.quiz.type];
  if (!skill) return [];
  const out: MistakeObservation[] = [];
  for (const result of submission.results) {
    if (typeof result.isCorrect !== 'boolean') continue;
    const question = submission.questions.find(
      (q) => q.id === result.questionId,
    );
    if (!question) continue;
    const content = (question.content ?? {}) as Record<string, unknown>;
    const base = {
      sourceType: 'QUIZ_QUESTION' as const,
      itemKey: String(question.id),
      skill,
      tag: skill === 'READING' ? readingSubskill(content) : null,
      at: submission.submittedAt,
    };
    if (result.isCorrect) {
      out.push({ ...base, outcome: 'CORRECT' });
      continue;
    }
    const ref = {
      quizId: submission.quiz.id,
      submissionId: submission.id,
      questionId: question.id,
    };
    if (question.type === 'DICTATION') {
      out.push({
        ...base,
        outcome: 'WRONG',
        detail: {
          kind: 'DICTATION',
          title: submission.quiz.title,
          yourAnswer: clean(result.answer) || undefined,
          correctAnswer: clean(
            content.correctAnswer ?? content.text ?? content.audioText,
          ),
          explanation: clean(content.translation) || undefined,
          answerable: false,
          ref,
        },
      });
      continue;
    }
    const options = optionList(content.options);
    const correctIndex = validIndex(content.correctIndex, options.length);
    const answer = result.answer;
    const selectedIndex =
      answer && typeof answer === 'object'
        ? validIndex(
            (answer as { selectedIndex?: unknown }).selectedIndex,
            options.length,
          )
        : typeof answer === 'string' && options.includes(answer.trim())
          ? options.indexOf(answer.trim())
          : null;
    const listening = skill === 'LISTENING';
    const passage = clean(
      listening ? content.audioText : content.passage,
      PASSAGE_MAX,
    );
    out.push({
      ...base,
      outcome: 'WRONG',
      detail: {
        kind: 'CHOICE',
        title: submission.quiz.title,
        question: clean(content.text) || undefined,
        passage: passage || undefined,
        passageKind: passage
          ? listening
            ? 'TRANSCRIPT'
            : 'PASSAGE'
          : undefined,
        options,
        selectedIndex,
        ...(correctIndex === null ? {} : { correctIndex }),
        explanation: clean(content.explanation) || undefined,
        yourAnswer:
          selectedIndex === null && typeof answer === 'string'
            ? clean(answer, 200) || undefined
            : undefined,
        // A listening item needs its audio; it is redone in the exercise.
        answerable: !listening && options.length > 1 && correctIndex !== null,
        ref,
      },
    });
  }
  return out.slice(0, MAX_ITEMS_PER_ATTEMPT * 3);
}

/** A grammar attempt: `answers` maps question id to the chosen index. */
export function grammarObservations(attempt: {
  id: number;
  createdAt: Date;
  topic: { id: number; title: string };
  answers: unknown;
  questions: Array<{
    id: number;
    question: string;
    options: unknown;
    correctIndex: number;
    explanation: string | null;
  }>;
}): MistakeObservation[] {
  const answers =
    attempt.answers && typeof attempt.answers === 'object'
      ? (attempt.answers as Record<string, unknown>)
      : {};
  const out: MistakeObservation[] = [];
  for (const q of attempt.questions) {
    const options = optionList(q.options);
    const selectedIndex = validIndex(answers[String(q.id)], options.length);
    if (selectedIndex === null) continue;
    const base = {
      sourceType: 'GRAMMAR_QUESTION' as const,
      itemKey: String(q.id),
      skill: 'GRAMMAR' as const,
      tag: clean(attempt.topic.title, 120) || null,
      at: attempt.createdAt,
    };
    if (selectedIndex === q.correctIndex) {
      out.push({ ...base, outcome: 'CORRECT' });
      continue;
    }
    out.push({
      ...base,
      outcome: 'WRONG',
      detail: {
        kind: 'CHOICE',
        title: attempt.topic.title,
        question: clean(q.question),
        options,
        selectedIndex,
        correctIndex: q.correctIndex,
        explanation: clean(q.explanation) || undefined,
        answerable: options.length > 1,
        ref: {
          attemptId: attempt.id,
          topicId: attempt.topic.id,
          questionId: q.id,
        },
      },
    });
  }
  return out;
}

/**
 * One checked "Dịch câu" sentence (SENTENCE_TRANSLATION_V1, owner
 * 2026-11-14): anything but a right translation opens the sentence in the
 * notebook; a right one counts towards closing it.
 */
function translationObservations(
  submission: {
    id: number;
    submittedAt: Date;
    quiz: { id: number; title: string };
    questions?: Array<{ id: number; content: unknown }>;
    results?: Array<{ questionId: number }>;
  },
  translation: Record<string, unknown>,
): MistakeObservation[] {
  const questionId = submission.results?.[0]?.questionId;
  if (typeof questionId !== 'number') return [];
  const base = {
    sourceType: 'TRANSLATION_SENTENCE' as const,
    itemKey: `q:${questionId}`,
    skill: 'WRITING' as const,
    tag: clean(submission.quiz.title, 120) || null,
    at: submission.submittedAt,
  };
  if (translation.verdict === 'CORRECT')
    return [{ ...base, outcome: 'CORRECT' }];
  const content = (submission.questions?.find((q) => q.id === questionId)
    ?.content ?? {}) as Record<string, unknown>;
  const prompt = clean(content.prompt);
  const closest = clean(translation.closest);
  if (!prompt || !closest) return [];
  return [
    {
      ...base,
      outcome: 'WRONG',
      detail: {
        kind: 'TRANSLATION',
        title: submission.quiz.title,
        question: prompt,
        yourAnswer: clean(translation.answer, 400) || undefined,
        correctAnswer: closest,
        explanation:
          clean(translation.explanation) ||
          clean(translation.grammarTip) ||
          undefined,
        answerable: true,
        ref: {
          quizId: submission.quiz.id,
          submissionId: submission.id,
          questionId,
        },
      },
    },
  ];
}

/**
 * The corrections of a graded practice Writing answer (PRACTICE_WRITING_V1).
 * Each one quotes the learner's text; the same slip in a later answer is the
 * same item. A "Dịch câu" sentence goes to translationObservations.
 */
export function writingObservations(submission: {
  id: number;
  submittedAt: Date;
  quiz: { id: number; type: string; title: string };
  aiFeedback: string | null;
  questions?: Array<{ id: number; content: unknown }>;
  results?: Array<{ questionId: number }>;
}): MistakeObservation[] {
  if (!submission.quiz.type.startsWith('WRITING_') || !submission.aiFeedback)
    return [];
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(submission.aiFeedback) as Record<string, unknown>;
  } catch {
    return [];
  }
  if (
    parsed.rubricVersion === 'SENTENCE_TRANSLATION_V1' &&
    parsed.translation &&
    typeof parsed.translation === 'object'
  )
    return translationObservations(
      submission,
      parsed.translation as Record<string, unknown>,
    );
  if (
    parsed.rubricVersion !== 'PRACTICE_WRITING_V1' ||
    !Array.isArray(parsed.corrections)
  )
    return [];
  const seen = new Set<string>();
  const out: MistakeObservation[] = [];
  for (const item of parsed.corrections as Array<Record<string, unknown>>) {
    const original = clean(item?.original, 200);
    const corrected = clean(item?.corrected, 200);
    if (!original || !corrected) continue;
    const itemKey = textKey(original, corrected);
    if (seen.has(itemKey)) continue;
    seen.add(itemKey);
    out.push({
      sourceType: 'WRITING_CORRECTION',
      itemKey,
      skill: 'WRITING',
      tag: null,
      outcome: 'WRONG',
      at: submission.submittedAt,
      detail: {
        kind: 'CORRECTION',
        title: submission.quiz.title,
        yourAnswer: original,
        correctAnswer: corrected,
        explanation: clean(item?.explanation) || undefined,
        answerable: false,
        ref: { quizId: submission.quiz.id, submissionId: submission.id },
      },
    });
  }
  return out.slice(0, 10);
}

/**
 * Words of a graded recording. Below SPEAKING_WEAK_BELOW the word is a
 * mistake; from SPEAKING_GOOD_FROM it counts as said well; in between it says
 * nothing. A word said several times counts once, with its lowest score.
 */
export function speakingObservations(submission: {
  id: number;
  exerciseId: number;
  exerciseTitle: string;
  submittedAt: Date;
  aiFeedback: unknown;
}): MistakeObservation[] {
  const words = (submission.aiFeedback as { words?: unknown } | null)?.words;
  if (!Array.isArray(words)) return [];
  const lowest = new Map<string, { word: string; score: number }>();
  for (const item of words as Array<Record<string, unknown>>) {
    const word = clean(item?.word, 60).replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
    const score = Number(item?.accuracyScore);
    // One-letter words ("a", "I") are too short to practise on their own.
    if (word.length < 2 || !Number.isFinite(score)) continue;
    const key = textKey(word);
    const known = lowest.get(key);
    if (!known || score < known.score) lowest.set(key, { word, score });
  }
  const out: MistakeObservation[] = [];
  for (const [itemKey, { word, score }] of lowest) {
    const base = {
      sourceType: 'SPEAKING_WORD' as const,
      itemKey,
      skill: 'SPEAKING' as const,
      tag: null,
      at: submission.submittedAt,
    };
    if (score >= SPEAKING_GOOD_FROM) out.push({ ...base, outcome: 'CORRECT' });
    else if (score < SPEAKING_WEAK_BELOW)
      out.push({
        ...base,
        outcome: 'WRONG',
        detail: {
          kind: 'WORD',
          title: submission.exerciseTitle,
          correctAnswer: word,
          score: Math.round(score),
          answerable: false,
          ref: {
            exerciseId: submission.exerciseId,
            submissionId: submission.id,
          },
        },
      });
  }
  // The weakest words first, and not a whole paragraph of them.
  const wrong = out
    .filter((o) => o.outcome === 'WRONG')
    .sort((a, b) => (a.detail?.score ?? 0) - (b.detail?.score ?? 0))
    .slice(0, 8);
  return [...wrong, ...out.filter((o) => o.outcome === 'CORRECT')];
}

export type MistakeState = {
  wrongCount: number;
  correctStreak: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  resolvedAt: Date | null;
  skill: MistakeSkill;
  tag: string | null;
  detail: MistakeDetail;
};

/**
 * The notebook row after one observation, or null when nothing is to be
 * stored (a right answer for an item that was never a mistake).
 */
export function applyObservation(
  state: MistakeState | null,
  obs: MistakeObservation,
): MistakeState | null {
  if (obs.outcome === 'WRONG') {
    if (!obs.detail) return state;
    return {
      wrongCount: (state?.wrongCount ?? 0) + 1,
      correctStreak: 0,
      firstSeenAt: state?.firstSeenAt ?? obs.at,
      lastSeenAt: obs.at,
      resolvedAt: null,
      skill: obs.skill,
      tag: obs.tag,
      detail: obs.detail,
    };
  }
  // A right answer matters only for an open mistake.
  if (!state || state.resolvedAt) return state;
  const correctStreak = state.correctStreak + 1;
  return {
    ...state,
    correctStreak,
    resolvedAt: correctStreak >= RESOLVE_AFTER_CORRECT ? obs.at : null,
  };
}

/**
 * A choice item as shown before the learner answers it again: no key, no
 * explanation, no earlier choice. A listening transcript is left out too. A
 * translation item carries only its Vietnamese sentence.
 */
export function reviewQuestion(
  id: number,
  skill: string,
  detail: MistakeDetail,
) {
  return {
    id,
    skill,
    title: detail.title,
    // The source's id, so the learner sees the Vietnamese title the catalog
    // shows (the stored title is the authoring one). No key travels with it.
    quizId: detail.ref.quizId ?? null,
    topicId: detail.ref.topicId ?? null,
    question: detail.question ?? null,
    passage: detail.passageKind === 'PASSAGE' ? (detail.passage ?? null) : null,
    options: detail.options ?? [],
    kind: detail.kind === 'TRANSLATION' ? 'TRANSLATION' : 'CHOICE',
  };
}

/** The tags the learner gets wrong most, for the tutor. */
export function topMistakeTags(
  rows: Array<{ skill: string; tag: string | null; wrongCount: number }>,
  limit = 3,
): string[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (!row.tag) continue;
    const tag =
      row.skill === 'READING' ? (READING_TAG_VI[row.tag] ?? row.tag) : row.tag;
    const label = `${SKILL_LABEL_VI[row.skill as MistakeSkill] ?? row.skill}: ${tag}`;
    totals.set(label, (totals.get(label) ?? 0) + Math.max(1, row.wrongCount));
  }
  return [...totals]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label]) => label);
}

export const SKILL_LABEL_VI: Record<MistakeSkill, string> = {
  LISTENING: 'Nghe',
  SPEAKING: 'Nói',
  READING: 'Đọc',
  WRITING: 'Viết',
  GRAMMAR: 'Ngữ pháp',
};
