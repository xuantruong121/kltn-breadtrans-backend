/**
 * A question an admin writes by hand in an exam group, checked as the
 * learner-ready rules check it (toeic.validation.ts), so a manual question
 * that saves is one the readiness check accepts. No I/O.
 */

/** Part 2 answers are three spoken responses; every other Part has four. */
export const optionCountForPart = (part: number) => (part === 2 ? 3 : 4);

/** Parts 1 and 2 hold one question per group: its audio is built from it. */
export const SINGLE_QUESTION_PARTS = [1, 2];

export function examQuestionProblems(
  part: number,
  question: { options?: unknown; correctIndex?: number | null },
): string[] {
  const problems: string[] = [];
  const expected = optionCountForPart(part);
  const options = Array.isArray(question.options) ? question.options : [];
  if (
    options.length !== expected ||
    options.some((option) => typeof option !== 'string' || !option.trim())
  )
    problems.push(
      `Part ${part} cần đúng ${expected} phương án, không để trống.`,
    );
  const key = Number(question.correctIndex);
  if (!Number.isInteger(key) || key < 0 || key >= options.length)
    problems.push('Đáp án đúng nằm ngoài các phương án đã nhập.');
  return problems;
}

/** Why one more question cannot go into this group, or null. */
export function addQuestionRefusal(
  part: number,
  questionsInGroup: number,
): string | null {
  return SINGLE_QUESTION_PARTS.includes(part) && questionsInGroup >= 1
    ? `Mỗi nhóm Part ${part} chỉ có một câu hỏi; hãy sửa câu đã có hoặc thêm nhóm mới.`
    : null;
}
