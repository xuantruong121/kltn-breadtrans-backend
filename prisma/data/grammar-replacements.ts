/**
 * Corrected Grammar items (Checkpoint 56). Topics 1 and 2 kept five ambiguous
 * questions; their attempts block in-place edits, so replacement topics 13 and
 * 14 carry these corrections and copy the other questions verbatim. Shared by
 * scripts/grammar-replace-cp56.ts (deployment) and prisma/seed.ts.
 * Keys are the original question ids.
 */
export type GrammarItem = {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
};

export const GRAMMAR_REPLACEMENTS: Array<{
  originalId: number;
  replacementId: number;
  corrections: Record<number, GrammarItem>;
}> = [
  {
    originalId: 1,
    replacementId: 13,
    corrections: {
      // `opened` was also grammatical as a past habit.
      1: {
        question: 'The reception desk ______ at 8 A.M. every weekday.',
        options: ['opening', 'are opening', 'open', 'opens'],
        correctIndex: 3,
        explanation:
          'Chủ ngữ số ít (the reception desk) và thói quen lặp lại (every weekday) → hiện tại đơn: opens.',
      },
      // `Did` was also correct for a past habit.
      3: {
        question: '______ your manager work from home on Fridays?',
        options: ['Does', 'Has', 'Do', 'Is'],
        correctIndex: 0,
        explanation:
          'Câu hỏi hiện tại đơn với chủ ngữ số ít (your manager) dùng Does + động từ nguyên mẫu.',
      },
      // `had` was also grammatical as a past habit.
      4: {
        question: 'My colleagues ______ lunch in the cafeteria most days.',
        options: ['is having', 'having', 'have', 'has'],
        correctIndex: 2,
        explanation:
          'Chủ ngữ số nhiều (my colleagues) và thói quen (most days) → hiện tại đơn: have.',
      },
      // `left` was also grammatical as a past timetable.
      5: {
        question: 'The train to the airport ______ every thirty minutes.',
        options: ['are leaving', 'leaving', 'leave', 'leaves'],
        correctIndex: 3,
        explanation:
          'Lịch trình cố định với chủ ngữ số ít (the train) → hiện tại đơn: leaves.',
      },
    },
  },
  {
    originalId: 2,
    replacementId: 14,
    corrections: {
      // Without a time marker `is closing` was also correct.
      9: {
        question: 'The store ______ early yesterday because of the storm.',
        options: ['closed', 'has close', 'is closing', 'closes'],
        correctIndex: 0,
        explanation:
          'Yesterday là mốc quá khứ đã kết thúc → quá khứ đơn: closed.',
      },
    },
  },
];
