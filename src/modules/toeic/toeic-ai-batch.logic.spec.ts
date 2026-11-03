import { questionsToAvoid } from './toeic-ai-batch.logic';

describe('questionsToAvoid', () => {
  const batch = (part: number, ...texts: string[]) => ({
    part,
    candidate: {
      groups: [{ questions: texts.map((text) => ({ text })) }],
    },
  });

  it('lists questions already generated for the same Part', () => {
    expect(
      questionsToAvoid([batch(5, 'A', 'B'), batch(6, 'C'), batch(5, 'D')], 5),
    ).toEqual(['A', 'B', 'D']);
  });

  it('skips questions without text', () => {
    expect(questionsToAvoid([batch(5, ' ', 'A')], 5)).toEqual(['A']);
  });

  it('keeps the most recent questions when there are many', () => {
    expect(questionsToAvoid([batch(5, 'A', 'B', 'C')], 5, 2)).toEqual([
      'B',
      'C',
    ]);
  });
});
