type GeneratedBatch = {
  part: number;
  candidate?: {
    groups?: Array<{ questions?: Array<{ text?: unknown }> }>;
  };
};

/**
 * Each batch is generated on its own and the model has no memory of the last
 * one, so it is told what the same Part already holds. Without this, Part 5
 * keeps returning the same sentences and fails the duplicate check.
 */
export function questionsToAvoid(
  batches: GeneratedBatch[],
  part: number,
  limit = 60,
) {
  return batches
    .filter((batch) => batch.part === part)
    .flatMap((batch) => batch.candidate?.groups ?? [])
    .flatMap((group) => group.questions ?? [])
    .map((question) => String(question.text ?? '').trim())
    .filter(Boolean)
    .slice(-limit);
}
