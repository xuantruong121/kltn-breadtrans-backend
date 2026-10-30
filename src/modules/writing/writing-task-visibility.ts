/**
 * Learner-facing contract for Writing task content (Question.content of
 * WRITING_EMAIL / WRITING_PICTURE quizzes). Pure: no Prisma, no I/O.
 *
 * An allowlist, so the contract fails closed: a field is sent to learners
 * only when it is listed here. Grader-only data - the reference answer
 * (`sampleResponse`) and the authored picture description
 * (`sceneDescription`) - and any field added later stay on the server until
 * someone decides it is learner-visible. Admin authoring reads the raw row.
 */
export const LEARNER_VISIBLE_WRITING_FIELDS = [
  'skill',
  'level',
  'taskType',
  'prompt',
  'instructions',
  'email',
  'imageUrl',
  'wordRange',
  'requirements',
  'requiredKeywords',
  'keywords',
  'requireLinking',
  'rubric',
] as const;

export function isWritingQuizType(type: unknown): boolean {
  return type === 'WRITING_EMAIL' || type === 'WRITING_PICTURE';
}

export function learnerVisibleTaskContent(content: unknown): unknown {
  if (!content || typeof content !== 'object' || Array.isArray(content))
    return content;
  const source = content as Record<string, unknown>;
  const visible: Record<string, unknown> = {};
  for (const key of LEARNER_VISIBLE_WRITING_FIELDS)
    if (key in source) visible[key] = source[key];
  return visible;
}
