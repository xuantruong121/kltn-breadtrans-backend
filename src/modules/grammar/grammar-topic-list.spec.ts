import { filterGrammarTopics } from './grammar-question.logic';

const topic = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Topic ${id}`,
  level: 'BEGINNER',
  publicationStatus: 'DRAFT',
  totalQuestions: 10,
  learnerAttemptCount: 0,
  ...extra,
});

describe('admin grammar topic list sort', () => {
  const topics = [
    topic(1, { title: 'Câu bị động', level: 'ADVANCED', totalQuestions: 4 }),
    topic(2, { title: 'Ảnh hưởng', level: 'INTERMEDIATE', totalQuestions: 12 }),
    topic(3, { title: 'Bàn về thì', level: 'BEGINNER', totalQuestions: 4 }),
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
