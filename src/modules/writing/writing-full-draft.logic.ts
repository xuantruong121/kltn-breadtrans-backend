import {
  SENTENCE_TRANSLATION,
  translationTaskIssues,
} from './sentence-translation.logic';

/**
 * "Tạo bằng AI" on the Writing page (owner 2026-11-19): email and "Dịch câu"
 * only. A picture exercise needs real photographs, so the AI is not offered
 * one. The model's answer is untrusted: every task is checked here and a bad
 * one is dropped, not repaired.
 */
export type WritingDraftKind = 'EMAIL' | 'TRANSLATION';
export const WRITING_DRAFT_KINDS: WritingDraftKind[] = ['EMAIL', 'TRANSLATION'];

/** The email families the Writing editor offers (no essays, no picture tasks). */
export const EMAIL_TASK_TYPES = [
  'EMAIL',
  'SHORT_MESSAGE',
  'INVITATION',
  'REQUEST',
  'THANK_YOU',
  'STATUS_UPDATE',
  'CUSTOMER_EMAIL',
  'INFORMATION_REQUEST',
  'MEETING_FOLLOWUP',
];

export type EmailDraftTask = {
  taskType: string;
  prompt: string;
  wordRange?: [number, number];
  explanation?: string;
};

export type TranslationDraftTask = {
  taskType: typeof SENTENCE_TRANSLATION;
  prompt: string;
  acceptedAnswers: string[];
  hints: Array<{ vi: string; en: string }>;
  grammarTip: string;
};

export type WritingFullDraft = {
  kind: WritingDraftKind;
  title: string;
  description: string;
  tasks: Array<EmailDraftTask | TranslationDraftTask>;
  /** Tasks the model returned that failed a check. */
  dropped: number;
};

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

function emailTask(raw: unknown): EmailDraftTask | null {
  const t = record(raw);
  const taskType = text(t.taskType, 40).toUpperCase();
  const prompt = text(t.prompt, 3000);
  if (!prompt || !EMAIL_TASK_TYPES.includes(taskType)) return null;
  const range = Array.isArray(t.wordRange) ? t.wordRange.map(Number) : [];
  const wordRange =
    range.length === 2 &&
    range.every((n) => Number.isInteger(n) && n > 0 && n <= 1000) &&
    range[0] < range[1]
      ? ([range[0], range[1]] as [number, number])
      : undefined;
  const explanation = text(t.explanation, 1000);
  return {
    taskType,
    prompt,
    ...(wordRange ? { wordRange } : {}),
    ...(explanation ? { explanation } : {}),
  };
}

function translationTask(raw: unknown): TranslationDraftTask | null {
  const t = record(raw);
  const acceptedAnswers = [
    ...new Set(
      (Array.isArray(t.acceptedAnswers) ? t.acceptedAnswers : [])
        .map((a) => text(a, 400))
        .filter(Boolean),
    ),
  ].slice(0, 5);
  const hints = (Array.isArray(t.hints) ? t.hints : [])
    .map((h) => ({ vi: text(record(h).vi, 80), en: text(record(h).en, 80) }))
    .filter((h) => h.vi && h.en)
    .slice(0, 6);
  const task: TranslationDraftTask = {
    taskType: SENTENCE_TRANSLATION,
    prompt: text(t.prompt, 400),
    acceptedAnswers,
    hints,
    grammarTip: text(t.grammarTip, 400),
  };
  // The same checks the CMS runs before a "Dịch câu" sentence is published.
  return translationTaskIssues(task).length ? null : task;
}

/** The checked draft, at most `count` tasks; empty `tasks` means nothing usable came back. */
export function cleanWritingFullDraft(
  raw: unknown,
  kind: WritingDraftKind,
  count: number,
): WritingFullDraft {
  const draft = record(raw);
  const offered = (Array.isArray(draft.tasks) ? draft.tasks : []).slice(
    0,
    Math.min(Math.max(count, 1), 10),
  );
  const tasks = offered
    .map((task) =>
      kind === 'TRANSLATION' ? translationTask(task) : emailTask(task),
    )
    .filter((task): task is EmailDraftTask | TranslationDraftTask => !!task);
  return {
    kind,
    title: text(draft.title, 200),
    description: text(draft.description, 1000),
    tasks,
    dropped: offered.length - tasks.length,
  };
}
