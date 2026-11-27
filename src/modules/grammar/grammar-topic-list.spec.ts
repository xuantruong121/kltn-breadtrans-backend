import {
  filterGrammarTopics,
  grammarPublishProblems,
} from './grammar-question.logic';

describe('grammarPublishProblems: the checklist the editor shows', () => {
  const valid = {
    question: 'She ___ here.',
    options: ['works', 'work', 'working', 'worked'],
    correctIndex: 0,
  };

  it('names every required item that is missing, in the editor words', () => {
    expect(
      grammarPublishProblems({ title: ' ', description: '', questions: [] }),
    ).toEqual(['có tên chủ đề', 'có phần lý thuyết', 'có ít nhất 1 câu hỏi']);
    expect(
      grammarPublishProblems({
        title: 'Thì hiện tại đơn',
        description: 'Thói quen.',
        questions: [valid, { ...valid, options: ['a', 'a', 'b', 'c'] }],
      }),
    ).toEqual(['mỗi câu có 4 phương án khác nhau và đáp án đúng']);
  });

  it('passes a topic with a title, a theory and valid questions', () => {
    expect(
      grammarPublishProblems({
        title: 'Thì hiện tại đơn',
        description: 'Thói quen.',
        questions: [valid],
      }),
    ).toEqual([]);
  });
});

const topic = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Topic ${id}`,
  level: 'BASIC',
  publicationStatus: 'DRAFT',
  totalQuestions: 10,
  learnerAttemptCount: 0,
  ...extra,
});

describe('admin grammar topic list sort', () => {
  const topics = [
    topic(1, { title: 'Câu bị động', level: 'ADVANCED', totalQuestions: 4 }),
    topic(2, { title: 'Ảnh hưởng', level: 'INTERMEDIATE', totalQuestions: 12 }),
    topic(3, { title: 'Bàn về thì', level: 'BASIC', totalQuestions: 4 }),
  ];
  const ids = (sort?: string) =>
    filterGrammarTopics([...topics], { sort }).map((t) => t.id);

  it('puts the newest first by default and the oldest first on OLDEST', () => {
    expect(ids()).toEqual([3, 2, 1]);
    expect(ids('NEWEST')).toEqual([3, 2, 1]);
    expect(ids('OLDEST')).toEqual([1, 2, 3]);
  });

  it('sorts by level, title and size', () => {
    expect(ids('LEVEL')).toEqual([3, 2, 1]);
    expect(ids('TITLE')).toEqual([2, 3, 1]);
    expect(ids('FEWEST')).toEqual([3, 1, 2]);
  });
});
