import { PART_1 } from './part1';
import { PART_2 } from './part2';
import { PART_3 } from './part3';
import { PART_4 } from './part4';
import { PART_5 } from './part5';
import { composeExplanation, type GrammarExplanationEntry } from './types';

export { composeExplanation };
export type { GrammarExplanationEntry };

export const GRAMMAR_EXPLANATIONS: GrammarExplanationEntry[] = [
  ...PART_1,
  ...PART_2,
  ...PART_3,
  ...PART_4,
  ...PART_5,
];

/** The step-by-step text for a question, when it still has exactly the content written for. */
export function explanationFor(question: {
  id: number;
  question: string;
  options: unknown;
  correctIndex: number;
}): string | null {
  const entry = GRAMMAR_EXPLANATIONS.find((x) => x.id === question.id);
  if (
    !entry ||
    entry.question !== question.question ||
    entry.correctIndex !== question.correctIndex ||
    JSON.stringify(entry.options) !== JSON.stringify(question.options)
  )
    return null;
  return composeExplanation(entry);
}
