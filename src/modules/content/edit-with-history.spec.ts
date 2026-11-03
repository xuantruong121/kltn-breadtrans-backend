import { historyEditProblem } from './edit-with-history';

describe('historyEditProblem', () => {
  const mcq = (options: string[], correctAnswer: string) => ({
    type: 'MULTIPLE_CHOICE',
    content: { question: 'Câu hỏi', options, correctAnswer },
  });

  it('allows fixing the wording', () => {
    expect(
      historyEditProblem(mcq(['A', 'B'], 'A'), {
        ...mcq(['A', 'B'], 'A'),
        content: {
          question: 'Câu đã sửa',
          options: ['A', 'B'],
          correctAnswer: 'A',
        },
      }),
    ).toBeNull();
  });

  it('allows changing the correct answer and an option text', () => {
    expect(
      historyEditProblem(mcq(['A', 'B'], 'A'), mcq(['A', 'Bé'], 'Bé')),
    ).toBeNull();
  });

  it('refuses another question type', () => {
    expect(
      historyEditProblem(mcq(['A', 'B'], 'A'), {
        type: 'FILL_BLANK',
        content: {},
      }),
    ).toContain('loại câu');
  });

  it('refuses adding or removing an option', () => {
    expect(
      historyEditProblem(mcq(['A', 'B'], 'A'), mcq(['A', 'B', 'C'], 'A')),
    ).toContain('lựa chọn');
    expect(historyEditProblem(mcq(['A', 'B'], 'A'), mcq(['A'], 'A'))).toContain(
      'lựa chọn',
    );
  });

  it('accepts questions without options, such as writing prompts', () => {
    expect(
      historyEditProblem(
        { type: 'WRITING', content: { prompt: 'Cũ' } },
        { type: 'WRITING', content: { prompt: 'Mới' } },
      ),
    ).toBeNull();
  });
});
