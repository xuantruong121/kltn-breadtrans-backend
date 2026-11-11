/**
 * Turns one answered item into what the tutor is told about it: the
 * question, what the learner chose, the key and the stored explanation.
 * Pure: the service reads the rows (and checks who owns them and that the
 * attempt is over); these functions only shape text.
 */
import type { TutorContext } from './tutor-prompt.logic';

export const TUTOR_CONTEXT_SOURCES = [
  'TOEIC_ATTEMPT',
  'QUIZ_SUBMISSION',
  'GRAMMAR_ATTEMPT',
] as const;
export type TutorContextSource = (typeof TUTOR_CONTEXT_SOURCES)[number];

export type TutorContextRef = {
  sourceType: TutorContextSource;
  sourceId: number;
  questionId?: number;
};

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const PASSAGE_MAX = 1200;
const TEXT_MAX = 700;

const clean = (value: unknown, max = TEXT_MAX): string => {
  const text =
    typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

const optionList = (options: unknown): string[] =>
  Array.isArray(options)
    ? options.map((o) => clean(o, 200)).filter(Boolean)
    : [];

const pick = (options: string[], index: unknown): string | null => {
  // Number(null) is 0, which would read a blank answer as choice A.
  if (index === null || index === undefined || index === '') return null;
  const i = Number(index);
  return Number.isInteger(i) && i >= 0 && i < options.length
    ? `${LETTERS[i] ?? i + 1}. ${options[i]}`
    : null;
};

/** The lines of a multiple-choice item; empty parts are left out. */
function choiceLines(item: {
  passage?: unknown;
  passageLabel?: string;
  question?: unknown;
  options?: unknown;
  selectedIndex?: unknown;
  correctIndex?: unknown;
  explanation?: unknown;
}): string[] {
  const options = optionList(item.options);
  const chosen = pick(options, item.selectedIndex);
  const key = pick(options, item.correctIndex);
  const lines: string[] = [];
  const passage = clean(item.passage, PASSAGE_MAX);
  if (passage) lines.push(`${item.passageLabel ?? 'Đoạn văn'}: ${passage}`);
  const question = clean(item.question);
  if (question) lines.push(`Câu hỏi: ${question}`);
  if (options.length) {
    lines.push(
      `Các lựa chọn: ${options.map((o, i) => `${LETTERS[i] ?? i + 1}. ${o}`).join(' | ')}`,
    );
  }
  lines.push(`Người học chọn: ${chosen ?? 'bỏ trống'}`);
  if (key) lines.push(`Đáp án đúng: ${key}`);
  if (chosen && key)
    lines.push(chosen === key ? 'Kết quả: đúng' : 'Kết quả: sai');
  const explanation = clean(item.explanation);
  if (explanation) lines.push(`Lời giải của đề: ${explanation}`);
  return lines;
}

export function toeicItemContext(item: {
  part: number;
  questionNumber: number;
  text?: string | null;
  options: unknown;
  correctIndex: number;
  explanation?: string | null;
  passageText?: string | null;
  transcriptText?: string | null;
  selectedIndex?: number | null;
}): TutorContext {
  const listening = item.part <= 4;
  return {
    label: `Câu ${item.questionNumber}, Part ${item.part}, đề luyện TOEIC đã nộp`,
    lines: choiceLines({
      passage: listening ? item.transcriptText : item.passageText,
      passageLabel: listening ? 'Lời thoại' : 'Đoạn văn',
      question: item.text,
      options: item.options,
      selectedIndex: item.selectedIndex,
      correctIndex: item.correctIndex,
      explanation: item.explanation,
    }),
  };
}

export function grammarItemContext(item: {
  topicTitle?: string | null;
  position: number;
  question: string;
  options: unknown;
  correctIndex: number;
  explanation?: string | null;
  selectedIndex?: number | null;
}): TutorContext {
  const topic = clean(item.topicTitle, 80);
  return {
    label: `Câu ${item.position}, bài ngữ pháp${topic ? ` "${topic}"` : ''}`,
    lines: choiceLines({
      question: item.question,
      options: item.options,
      selectedIndex: item.selectedIndex,
      correctIndex: item.correctIndex,
      explanation: item.explanation,
    }),
  };
}

const SKILL_OF_QUIZ: Record<string, string> = {
  LISTENING_PRACTICE: 'bài luyện nghe',
  BILINGUAL_READING: 'bài luyện đọc',
  WRITING_PICTURE: 'bài luyện viết',
  WRITING_EMAIL: 'bài luyện viết',
  TOEIC: 'đề luyện',
};

/**
 * A practice-quiz item. `content` is the question's JSON and `answer` the
 * stored result: `{ selectedIndex }` for a choice, a string for dictation or
 * writing.
 */
export function quizItemContext(item: {
  quizType: string;
  quizTitle?: string | null;
  position: number;
  questionType: string;
  content: Record<string, unknown> | null;
  answer: unknown;
  isCorrect?: boolean | null;
  feedback?: string | null;
}): TutorContext {
  const content = item.content ?? {};
  const kind = SKILL_OF_QUIZ[item.quizType] ?? 'bài luyện';
  const title = clean(item.quizTitle, 80);
  const label = `Câu ${item.position}, ${kind}${title ? ` "${title}"` : ''}`;
  const answerText = typeof item.answer === 'string' ? item.answer : '';
  const selectedIndex =
    item.answer && typeof item.answer === 'object'
      ? (item.answer as { selectedIndex?: unknown }).selectedIndex
      : undefined;

  if (item.questionType === 'WRITING') {
    const lines = [
      `Đề bài: ${clean(content.prompt)}`,
      `Bài viết của người học: ${clean(answerText, PASSAGE_MAX) || 'chưa có'}`,
    ];
    const feedback = clean(item.feedback, PASSAGE_MAX);
    if (feedback) lines.push(`Nhận xét đã chấm: ${feedback}`);
    return { label, lines };
  }

  if (item.questionType === 'DICTATION') {
    const lines = [
      `Câu cần chép: ${clean(content.correctAnswer ?? content.text ?? content.audioText)}`,
      `Người học chép: ${clean(answerText) || 'bỏ trống'}`,
    ];
    if (typeof item.isCorrect === 'boolean') {
      lines.push(item.isCorrect ? 'Kết quả: đúng' : 'Kết quả: sai');
    }
    const translation = clean(content.translation);
    if (translation) lines.push(`Nghĩa: ${translation}`);
    return { label, lines };
  }

  return {
    label,
    lines: choiceLines({
      passage: content.passage ?? content.audioText,
      passageLabel: content.passage ? 'Đoạn văn' : 'Lời thoại',
      question: content.text,
      options: content.options,
      selectedIndex,
      correctIndex: content.correctIndex,
      explanation: content.explanation,
    }),
  };
}

/** A context reference from a request body, or null when it is not one. */
export function parseTutorContextRef(value: unknown): TutorContextRef | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const sourceId = Number(v.sourceId);
  if (
    !TUTOR_CONTEXT_SOURCES.includes(v.sourceType as TutorContextSource) ||
    !Number.isInteger(sourceId) ||
    sourceId <= 0
  ) {
    return null;
  }
  const questionId = Number(v.questionId);
  return {
    sourceType: v.sourceType as TutorContextSource,
    sourceId,
    ...(Number.isInteger(questionId) && questionId > 0 ? { questionId } : {}),
  };
}
