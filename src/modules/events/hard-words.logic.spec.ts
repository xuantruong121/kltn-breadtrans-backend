import type { ArenaWord } from './arena-questions.logic';
import {
  hardWordOrder,
  isHardWord,
  pickHardWords,
  spreadIndexes,
  type HardWordRow,
} from './hard-words.logic';

const NOW = new Date('2026-11-26T12:00:00Z');
const row = (
  entryId: number,
  over: Partial<HardWordRow> = {},
): HardWordRow => ({
  entryId,
  lapses: 1,
  easeFactor: 2.3,
  nextReviewAt: new Date('2026-12-01T00:00:00Z'),
  ...over,
});
// Arena words are letters only (isDuelWord), so the fixtures are named, not numbered.
const NAMES = [
  'zero',
  'alpha',
  'bravo',
  'charlie',
  'delta',
  'echo',
  'foxtrot',
  'golf',
  'hotel',
  'india',
  'juliet',
];
const word = (id: number, headword = NAMES[id]): ArenaWord => ({
  id,
  headword,
  displayWord: headword,
  pos: 'noun',
  meaningVi: `nghĩa ${id}`,
  exampleEn: null,
  ipa: null,
  level: 3,
});
const keepOrder = () => 0.999;

describe('hard words (thesis supervisor 2026-11-26)', () => {
  it('a lapse or a lowered ease makes a word hard', () => {
    expect(isHardWord({ lapses: 1, easeFactor: 2.5 })).toBe(true);
    expect(isHardWord({ lapses: 0, easeFactor: 2.35 })).toBe(true);
    expect(isHardWord({ lapses: 0, easeFactor: 2.5 })).toBe(false);
    expect(isHardWord({ lapses: 0, easeFactor: 2.65 })).toBe(false);
  });

  it('puts words due for review first, each entry once, easy ones out', () => {
    const order = hardWordOrder(
      [
        row(1),
        row(2, { nextReviewAt: new Date('2026-11-26T11:00:00Z') }),
        row(3, { lapses: 0, easeFactor: 2.5 }),
        row(1, { nextReviewAt: new Date('2026-11-25T00:00:00Z') }),
        row(4, { nextReviewAt: null }),
      ],
      NOW,
      keepOrder,
    );
    expect(order.slice(0, 2).sort()).toEqual([1, 2]);
    expect(order.slice(2)).toEqual([4]);
  });

  it('takes at most six words that fit the game, distinct headwords, in order', () => {
    const pool = [1, 2, 3, 4, 5, 6, 7, 8].map((id) => word(id));
    pool.push(word(9, 'alpha'));
    pool.push({ ...word(10), meaningVi: '' });
    const picked = pickHardWords(
      pool,
      [10, 9, 1, 2, 3, 4, 99, 5, 6, 7, 8],
      (w) => w.id !== 4,
    );
    expect(picked.map((w) => w.id)).toEqual([9, 2, 3, 5, 6, 7]);
  });

  it('spreads the places over the game', () => {
    expect(spreadIndexes(4, 20)).toEqual([2, 7, 12, 17]);
    expect(spreadIndexes(1, 20)).toEqual([10]);
    expect(spreadIndexes(6, 20)).toEqual([1, 5, 8, 11, 15, 18]);
    expect(spreadIndexes(0, 20)).toEqual([]);
  });
});
