/**
 * One readable line of an AI grading result for the admin's learner profile.
 * A submission stores its feedback as the grader's JSON text (writing:
 * PRACTICE_WRITING_V1 with a Vietnamese `feedback` sentence, criteria,
 * corrections); the profile used to cut the first 180 characters of that
 * text, which showed raw JSON. Plain text feedback is kept as written.
 * Pure: no I/O.
 */
const SUMMARY_MAX = 180;
const TEXT_KEYS = [
  'feedback',
  'summary',
  'overallFeedback',
  'overall',
  'comment',
];

const oneLine = (text: string) => {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > SUMMARY_MAX
    ? `${normalized.slice(0, SUMMARY_MAX - 3)}...`
    : normalized;
};

export function feedbackSummary(feedback: unknown): string | null {
  if (feedback === null || feedback === undefined) return null;
  let value: unknown = feedback;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return null;
    if (!/^[{[]/.test(text)) return oneLine(text);
    try {
      value = JSON.parse(text);
    } catch {
      // Cut-off or invalid JSON: never show it as text.
      return null;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  for (const key of TEXT_KEYS) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim())
      return oneLine(candidate);
  }
  return null;
}
