import {
  decksToLearn,
  deckLevel,
  foundationPlan,
  grammarLevel,
  grammarToStudy,
  type DeckInput,
  type GrammarInput,
} from './foundation.logic';

const topic = (over: Partial<GrammarInput> & { id: number }): GrammarInput => ({
  title: `Topic ${over.id}`,
  level: 'BEGINNER',
  best: null,
  ...over,
});
const deck = (over: Partial<DeckInput> & { id: number }): DeckInput => ({
  title: `Deck ${over.id}`,
  level: 'A2',
  total: 10,
  mastered: 0,
  ...over,
});

describe('foundation levels', () => {
  it('maps grammar and deck tags to practice levels', () => {
    expect(grammarLevel('BEGINNER')).toBe('BASIC');
    expect(grammarLevel('ADVANCED')).toBe('ADVANCED');
    expect(deckLevel('A1')).toBe('STARTER');
    expect(deckLevel('A2')).toBe('BASIC');
    expect(deckLevel('B2')).toBe('INTERMEDIATE');
    expect(deckLevel(null)).toBeNull();
  });
});

describe('grammarToStudy', () => {
  it('leaves out passed topics and suggests a low score again', () => {
    const items = grammarToStudy(
      [
        topic({ id: 1, best: 90 }),
        topic({ id: 2, best: 40 }),
        topic({ id: 3 }),
      ],
      'BASIC',
    );
    expect(items.map((i) => i.id)).toEqual([2, 3]);
    expect(items[0].reason).toContain('40%');
    expect(items[1].route).toBe('/reading?category=grammar&topicId=3');
  });

  it('puts the own level first, then below, then above, never further', () => {
    const items = grammarToStudy(
      [
        topic({ id: 1, level: 'ADVANCED' }),
        topic({ id: 2, level: 'INTERMEDIATE' }),
        topic({ id: 3, level: 'BEGINNER' }),
      ],
      'INTERMEDIATE',
    );
    expect(items.map((i) => i.id)).toEqual([2, 3, 1]);
    const starter = grammarToStudy(
      [topic({ id: 1, level: 'ADVANCED' }), topic({ id: 3 })],
      'STARTER',
    );
    expect(starter.map((i) => i.id)).toEqual([3]);
  });
});

describe('decksToLearn', () => {
  it('skips finished and empty decks and shows progress', () => {
    const items = decksToLearn(
      [
        deck({ id: 1, mastered: 10 }),
        deck({ id: 2, total: 0 }),
        deck({ id: 3, mastered: 4 }),
      ],
      'BASIC',
    );
    expect(items.map((i) => i.id)).toEqual([3]);
    expect(items[0].reason).toBe('Đã thuộc 4/10 từ');
  });

  it('keeps an untagged deck, after the tagged ones', () => {
    const items = decksToLearn(
      [deck({ id: 1, level: null }), deck({ id: 2 })],
      'BASIC',
    );
    expect(items.map((i) => i.id)).toEqual([2, 1]);
    expect(items[1].reason).toBe('Bộ từ vựng bạn chưa học');
  });
});

describe('foundationPlan', () => {
  const input = {
    learner: 'BASIC' as const,
    dueWords: 0,
    grammar: [topic({ id: 1 }), topic({ id: 2 }), topic({ id: 3 })],
    decks: [deck({ id: 7 }), deck({ id: 8 })],
  };

  it('alternates grammar and decks up to the limit', () => {
    const plan = foundationPlan(input, 4);
    expect(plan.map((i) => i.kind)).toEqual([
      'GRAMMAR',
      'VOCAB_DECK',
      'GRAMMAR',
      'VOCAB_DECK',
    ]);
  });

  it('puts due words first with a matching count', () => {
    const [first] = foundationPlan({ ...input, dueWords: 7 }, 3);
    expect(first.kind).toBe('VOCAB_REVIEW');
    expect(first.title).toBe('Ôn 7 từ đến hạn');
    expect(first.minutes).toBe(4);
    expect(first.route).toBe('/vocabulary/study');
  });

  it('never goes past the limit and handles nothing to do', () => {
    expect(foundationPlan({ ...input, dueWords: 3 }, 2)).toHaveLength(2);
    expect(
      foundationPlan({ ...input, grammar: [], decks: [] }, 6),
    ).toHaveLength(0);
  });
});
