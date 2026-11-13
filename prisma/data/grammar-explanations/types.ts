/**
 * Step-by-step explanations for the grammar practice questions (owner
 * 2026-11-13: one line was too little; each explanation names the kind of
 * question, reads the clues, rules out every wrong option and ends with a
 * tip). Original text written for BreadTrans.
 *
 * Each entry repeats the question, its options and its key, so the apply
 * script and the seed only touch a question that still has exactly that
 * content, and the spec can check the explanation names the right option
 * and every wrong one.
 */
export type GrammarExplanationEntry = {
  id: number;
  question: string;
  options: string[];
  correctIndex: number;
  /** Bước 1: what kind of question this is. */
  kind: string;
  /** Bước 2: the clues in the sentence and why each wrong option fails. */
  analysis: string;
  /** Bước 3: the reason, after "Chọn (X) "option":". */
  answer: string;
  /** Lưu ý: one tip to remember. */
  tip: string;
};

export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

/** The stored text: four labelled steps, one per line pair. */
export function composeExplanation(entry: GrammarExplanationEntry): string {
  const letter = LETTERS[entry.correctIndex];
  const option = entry.options[entry.correctIndex];
  return [
    'Bước 1: Xác định dạng câu hỏi',
    entry.kind,
    'Bước 2: Phân tích câu để tìm đáp án',
    entry.analysis,
    'Bước 3: Chọn đáp án',
    `Chọn (${letter}) "${option}": ${entry.answer}`,
    `Lưu ý: ${entry.tip}`,
  ].join('\n');
}

export function e(
  id: number,
  question: string,
  options: string[],
  correctIndex: number,
  kind: string,
  analysis: string,
  answer: string,
  tip: string,
): GrammarExplanationEntry {
  return { id, question, options, correctIndex, kind, analysis, answer, tip };
}
