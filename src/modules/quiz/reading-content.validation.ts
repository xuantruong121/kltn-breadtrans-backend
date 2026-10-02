import { BadRequestException } from '@nestjs/common';

export const READING_MICRO_SKILLS = [
  'DETAIL',
  'PURPOSE',
  'INFERENCE',
  'MAIN_IDEA',
  'PROMOTION',
  'VOCAB_IN_CONTEXT',
] as const;

export type ReadingMicroSkill = (typeof READING_MICRO_SKILLS)[number];

export type ReadingCorrectOption =
  | { status: 'available'; answer: string; index: number }
  | { status: 'unavailable'; reason: string };

type ReadingContent = Record<string, unknown>;

function asContent(value: unknown): ReadingContent {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as ReadingContent)
    : {};
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

export function resolveReadingCorrectOption(
  value: unknown,
): ReadingCorrectOption {
  const content = asContent(value);
  const options = content.options;
  const index = content.correctIndex;

  if (Array.isArray(options) && Number.isInteger(index)) {
    const numericIndex = index as number;
    if (numericIndex < 0 || numericIndex >= options.length) {
      return { status: 'unavailable', reason: 'correctIndex is out of range' };
    }
    const answer = asNonEmptyString(options[numericIndex]);
    return answer
      ? { status: 'available', answer, index: numericIndex }
      : { status: 'unavailable', reason: 'correct option is empty' };
  }

  if (Array.isArray(options) && index !== undefined) {
    return { status: 'unavailable', reason: 'correctIndex must be an integer' };
  }

  const legacy =
    asNonEmptyString(content.correct) ??
    asNonEmptyString(content.correctAnswer);
  return legacy
    ? { status: 'available', answer: legacy, index: -1 }
    : { status: 'unavailable', reason: 'no valid Reading answer key' };
}

export function resolveReadingMicroSkillForAuthoring(
  value: unknown,
): ReadingMicroSkill | null {
  const content = asContent(value);
  const raw =
    typeof content.questionType === 'string'
      ? content.questionType.trim().toUpperCase()
      : '';
  return (READING_MICRO_SKILLS as readonly string[]).includes(raw)
    ? (raw as ReadingMicroSkill)
    : null;
}

function validateSafeAnswerStructure(content: ReadingContent): void {
  if (content.options !== undefined && !Array.isArray(content.options)) {
    throw new BadRequestException('Reading options phải là một mảng');
  }
  if (Array.isArray(content.options)) {
    for (const option of content.options) {
      if (typeof option !== 'string' || option.trim().length === 0) {
        throw new BadRequestException(
          'Reading options không được rỗng hoặc không phải chuỗi',
        );
      }
    }
  }
  if (
    content.correctIndex !== undefined &&
    !Number.isInteger(content.correctIndex)
  ) {
    throw new BadRequestException('Reading correctIndex phải là số nguyên');
  }
  if (
    Array.isArray(content.options) &&
    Number.isInteger(content.correctIndex)
  ) {
    const index = content.correctIndex as number;
    if (index < 0 || index >= content.options.length) {
      throw new BadRequestException(
        'Reading correctIndex nằm ngoài phạm vi options',
      );
    }
  }
  if (content.correctIndex !== undefined && content.options === undefined) {
    throw new BadRequestException('Reading correctIndex cần đi kèm options');
  }
  const resolved = resolveReadingCorrectOption(content);
  if (
    resolved.status === 'available' &&
    resolved.index >= 0 &&
    (asNonEmptyString(content.correct) ??
      asNonEmptyString(content.correctAnswer)) &&
    (asNonEmptyString(content.correct) ??
      asNonEmptyString(content.correctAnswer)) !== resolved.answer
  ) {
    throw new BadRequestException(
      'Reading canonical answer và legacy answer không khớp',
    );
  }
}

export function validateReadingQuestionContent(
  value: unknown,
  mode: 'DRAFT' | 'PUBLISHED',
): ReadingContent {
  const content = asContent(value);
  validateSafeAnswerStructure(content);

  if (mode === 'DRAFT') return content;

  if (!asNonEmptyString(content.text)) {
    throw new BadRequestException('Reading question text không được để trống');
  }
  if (!asNonEmptyString(content.passage)) {
    throw new BadRequestException('Reading passage không được để trống');
  }
  if (!Array.isArray(content.options) || content.options.length < 2) {
    throw new BadRequestException('Reading cần ít nhất 2 options');
  }
  const normalizedOptions = (content.options as string[]).map((option) =>
    option.trim().toLocaleLowerCase(),
  );
  if (new Set(normalizedOptions).size !== normalizedOptions.length) {
    throw new BadRequestException('Reading options không được trùng nhau');
  }
  if (!Number.isInteger(content.correctIndex)) {
    throw new BadRequestException('Reading correctIndex là bắt buộc');
  }
  const correct = resolveReadingCorrectOption(content);
  if (correct.status === 'unavailable') {
    throw new BadRequestException(
      `Reading answer không hợp lệ: ${correct.reason}`,
    );
  }
  if (correct.index < 0) {
    throw new BadRequestException(
      'Reading answer phải dùng correctIndex canonical',
    );
  }
  if (!resolveReadingMicroSkillForAuthoring(content)) {
    throw new BadRequestException(
      'Reading questionType phải là một micro-skill hợp lệ',
    );
  }
  if (content.explanation !== undefined) {
    const explanation = content.explanation;
    const validExplanation =
      typeof explanation === 'string' ||
      (explanation &&
        typeof explanation === 'object' &&
        !Array.isArray(explanation));
    if (!validExplanation)
      throw new BadRequestException('Reading explanation không hợp lệ');
  }
  return content;
}
