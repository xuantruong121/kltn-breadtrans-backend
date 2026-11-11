import {
  hideUnansweredKeys,
  reviewStatus,
  summarizeLrReview,
} from './toeic-lr-review';

describe('TOEIC L&R post-submission summary', () => {
  it('classifies each question from the stored answer and key', () => {
    expect(reviewStatus(2, 2)).toBe('CORRECT');
    expect(reviewStatus(1, 2)).toBe('INCORRECT');
    expect(reviewStatus(null, 2)).toBe('SKIPPED');
    expect(reviewStatus(undefined, 0)).toBe('SKIPPED');
  });

  it('counts correct + incorrect + skipped = total per Part, skill and overall', () => {
    const s = summarizeLrReview([
      { part: 1, status: 'CORRECT' },
      { part: 1, status: 'INCORRECT' },
      { part: 2, status: 'SKIPPED' },
      { part: 6, status: 'CORRECT' },
    ]);
    expect(s.overall).toEqual({
      total: 4,
      correct: 2,
      incorrect: 1,
      skipped: 1,
      accuracy: 50,
    });
    expect(s.listening).toEqual({
      total: 3,
      correct: 1,
      incorrect: 1,
      skipped: 1,
      accuracy: 33.33,
    });
    expect(s.reading).toEqual({
      total: 1,
      correct: 1,
      incorrect: 0,
      skipped: 0,
      accuracy: 100,
    });
    // Only Parts that are in scope appear (a part practice lists its own).
    expect(s.parts.map((p) => p.part)).toEqual([1, 2, 6]);
    for (const p of s.parts)
      expect(p.correct + p.incorrect + p.skipped).toBe(p.total);
  });

  it('an empty skill has accuracy null, not 0', () => {
    const s = summarizeLrReview([{ part: 5, status: 'CORRECT' }]);
    expect(s.listening).toEqual({
      total: 0,
      correct: 0,
      incorrect: 0,
      skipped: 0,
      accuracy: null,
    });
  });
});

describe('hideUnansweredKeys', () => {
  const question = (
    id: number,
    groupId: number,
    selectedIndex: number | null,
  ) => ({
    questionId: id,
    groupId,
    selectedIndex,
    correctIndex: 2 as number | null,
    standardAnswer: 'since' as string | null,
    explanation: 'Since đi với mốc bắt đầu.' as string | null,
    transcript: `Lời thoại nhóm ${groupId}` as string | null,
    questionText: `Câu ${id}`,
    options: ['from', 'during', 'since', 'for'],
  });

  it('keeps the key, the worded answer and the explanation of an answered question, right or wrong', () => {
    const [wrong, right] = hideUnansweredKeys([
      question(1, 10, 0),
      question(2, 10, 2),
    ]);
    for (const q of [wrong, right]) {
      expect(q.correctIndex).toBe(2);
      expect(q.standardAnswer).toBe('since');
      expect(q.explanation).toBe('Since đi với mốc bắt đầu.');
    }
  });

  it('shows no key, no worded answer and no explanation for a skipped question', () => {
    const [skipped] = hideUnansweredKeys([question(1, 10, null)]);
    expect(skipped).toMatchObject({
      correctIndex: null,
      standardAnswer: null,
      explanation: null,
      // The question itself stays readable.
      questionText: 'Câu 1',
      options: ['from', 'during', 'since', 'for'],
    });
  });

  it('shows a transcript only for a group with at least one answered question', () => {
    const [a, b, c] = hideUnansweredKeys([
      question(1, 10, null),
      question(2, 10, 1),
      question(3, 20, null),
    ]);
    // Group 10 has an answer: both of its questions keep the transcript.
    expect(a.transcript).toBe('Lời thoại nhóm 10');
    expect(b.transcript).toBe('Lời thoại nhóm 10');
    expect(a.correctIndex).toBeNull();
    // Group 20 has none.
    expect(c.transcript).toBeNull();
  });
});
