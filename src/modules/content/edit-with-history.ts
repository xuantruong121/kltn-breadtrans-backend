/**
 * Skill practice with learner attempts may be edited in place: a past attempt
 * keeps its stored score. Its stored answers point at a question and, for
 * choice questions, at an option, so the shape of a question must not change.
 */
type QuestionShape = { type?: string | null; content?: unknown };

const optionCount = (content: unknown) => {
  const options = (content as { options?: unknown } | null)?.options;
  return Array.isArray(options) ? options.length : 0;
};

export function historyEditProblem(
  before: QuestionShape,
  after: QuestionShape,
): string | null {
  if (after.type !== undefined && after.type !== before.type)
    return 'Nội dung đã có lịch sử làm bài; không thể đổi loại câu.';
  if (optionCount(before.content) !== optionCount(after.content))
    return 'Nội dung đã có lịch sử làm bài; không thể thêm hoặc bớt lựa chọn.';
  return null;
}
