import {
  GRAMMAR_EXPLANATIONS,
  composeExplanation,
  explanationFor,
} from './index';
import { LETTERS } from './types';

// Owner 2026-11-13: every grammar question gets a full step-by-step
// explanation. These checks keep each one honest about its own options.
describe('grammar explanations', () => {
  it('one entry per question id', () => {
    const ids = GRAMMAR_EXPLANATIONS.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(GRAMMAR_EXPLANATIONS.map((x) => [x.id, x] as const))(
    'question %i: names its answer, rules out every wrong option, has all steps',
    (_id, entry) => {
      const text = composeExplanation(entry);
      const right = LETTERS[entry.correctIndex];
      expect(text).toContain(
        `Chọn (${right}) "${entry.options[entry.correctIndex]}"`,
      );
      entry.options.forEach((option, index) => {
        if (index === entry.correctIndex) return;
        // Each wrong option is named with its letter and its text.
        expect(entry.analysis).toContain(`(${LETTERS[index]}) "${option}"`);
      });
      // The right option is never "ruled out".
      expect(entry.analysis).not.toMatch(new RegExp(`[Ll]oại \\(${right}\\)`));
      for (const step of ['Bước 1:', 'Bước 2:', 'Bước 3:', 'Lưu ý:'])
        expect(text).toContain(step);
      expect(entry.options).toHaveLength(4);
      expect(entry.kind.length).toBeGreaterThan(20);
      expect(entry.analysis.length).toBeGreaterThan(120);
      expect(entry.tip.length).toBeGreaterThan(20);
    },
  );

  it('only a question with exactly the written content gets the text', () => {
    const first = GRAMMAR_EXPLANATIONS[0];
    expect(explanationFor(first)).toContain('Bước 1:');
    expect(explanationFor({ ...first, question: 'changed' })).toBeNull();
    expect(
      explanationFor({ ...first, correctIndex: (first.correctIndex + 1) % 4 }),
    ).toBeNull();
    expect(explanationFor({ ...first, id: 99999 })).toBeNull();
  });
});
