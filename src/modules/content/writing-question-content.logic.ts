import { SENTENCE_TRANSLATION } from '../writing/sentence-translation.logic';

/** What the CMS question form sends for one Writing task. */
export type WritingQuestionInput = {
  prompt: string;
  taskType?: string;
  level?: string;
  imageUrl?: string;
  keywords?: string[];
  wordRange?: number[];
  sampleSentences?: string[];
  explanation?: string;
  acceptedAnswers?: string[];
  hints?: Array<{ vi: string; en: string }>;
  grammarTip?: string;
};

/** Keys the CMS question form owns: they are written from the form, or dropped. */
export const WRITING_FORM_KEYS = [
  'skill',
  'prompt',
  'taskType',
  'level',
  'imageUrl',
  'keywords',
  'requiredKeywords',
  'wordRange',
  'sampleSentences',
  'explanation',
  'acceptedAnswers',
  'hints',
  'grammarTip',
] as const;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const upper = (value: unknown) =>
  typeof value === 'string' ? value.trim().toUpperCase() : '';

const unique = (list?: string[]) => [
  ...new Set((list ?? []).map((x) => x.trim()).filter(Boolean)),
];

const isWordRange = (value: unknown): value is number[] =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every((n) => Number.isInteger(n) && (n as number) > 0);

/**
 * The stored content of a Writing task after a CMS edit (owner 2026-11-19).
 *
 * The form only knows its own fields. A seeded picture task also carries
 * `rubric`, `sceneDescription`, `sampleResponse`, `requirements` and
 * `requireLinking`; without `rubric` the task is no longer graded by its
 * rubric (practiceWritingTask returns null). So every key the form does not
 * own is kept while the task type stays the same. A new task type starts
 * clean: another type's rubric or scene would grade the wrong task.
 *
 * Suggested words go to `keywords` and `requiredKeywords` (the grader reads
 * the second). An old word range stays when the form sends none.
 */
export function writingQuestionContent(
  dto: WritingQuestionInput,
  previous?: unknown,
): Record<string, unknown> {
  const before = record(previous);
  const taskType = dto.taskType?.trim() ?? '';
  const sameTask =
    !before.taskType || upper(before.taskType) === upper(taskType);
  const kept = sameTask
    ? Object.fromEntries(
        Object.entries(before).filter(
          ([key]) => !(WRITING_FORM_KEYS as readonly string[]).includes(key),
        ),
      )
    : {};
  const translation = upper(taskType) === SENTENCE_TRANSLATION;
  const keywords = unique(dto.keywords);
  const sampleSentences = unique(dto.sampleSentences);
  const wordRange = isWordRange(dto.wordRange)
    ? dto.wordRange
    : sameTask && isWordRange(before.wordRange)
      ? before.wordRange
      : null;
  return {
    ...kept,
    ...(translation
      ? {
          acceptedAnswers: unique(dto.acceptedAnswers),
          hints: (dto.hints ?? [])
            .map((h) => ({ vi: h.vi.trim(), en: h.en.trim() }))
            .filter((h) => h.vi && h.en),
          grammarTip: dto.grammarTip?.trim() ?? '',
        }
      : {}),
    skill: 'WRITING',
    prompt: dto.prompt.trim(),
    ...(taskType ? { taskType } : {}),
    ...(dto.level?.trim() ? { level: dto.level.trim() } : {}),
    ...(dto.imageUrl?.trim() ? { imageUrl: dto.imageUrl.trim() } : {}),
    ...(keywords.length ? { keywords, requiredKeywords: keywords } : {}),
    ...(wordRange ? { wordRange } : {}),
    ...(sampleSentences.length ? { sampleSentences } : {}),
    ...(dto.explanation?.trim() ? { explanation: dto.explanation.trim() } : {}),
  };
}
