import type { ArenaWord } from './arena-questions.logic';
import {
  HARD_UNTIL_DAYS,
  hardShownKey,
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
  intervalDays: 1,
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
    expect(isHardWord({ lapses: 1, easeFactor: 2.5, intervalDays: 1 })).toBe(
      true,
    );
    expect(isHardWord({ lapses: 0, easeFactor: 2.35, intervalDays: 1 })).toBe(
      true,
    );
    expect(isHardWord({ lapses: 0, easeFactor: 2.5, intervalDays: 1 })).toBe(
      false,
    );
    expect(isHardWord({ lapses: 0, easeFactor: 2.65, intervalDays: 1 })).toBe(
      false,
    );
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

describe('hard words wear off and wait for tomorrow (owner 2026-11-27)', () => {
  it('a word recalled across a week is no longer hard (rule A)', () => {
    expect(HARD_UNTIL_DAYS).toBe(7);
    expect(isHardWord({ lapses: 3, easeFactor: 2.2, intervalDays: 6 })).toBe(
      true,
    );
    expect(isHardWord({ lapses: 3, easeFactor: 2.2, intervalDays: 7 })).toBe(
      false,
    );
    // Graded "Khó" once, then remembered for 11 days.
    expect(isHardWord({ lapses: 0, easeFactor: 2.35, intervalDays: 11 })).toBe(
      false,
    );
    // Just forgotten: the interval starts again.
    expect(isHardWord({ lapses: 1, easeFactor: 2.3, intervalDays: 0 })).toBe(
      true,
    );
  });

  it('leaves out the words already put into a game today (rule B)', () => {
    const rows = [
      row(1),
      row(2, { nextReviewAt: new Date('2026-11-25T00:00:00Z') }),
      row(3, { nextReviewAt: null }),
    ];
    expect(hardWordOrder(rows, NOW, keepOrder).sort()).toEqual([1, 2, 3]);
    expect(hardWordOrder(rows, NOW, keepOrder, new Set([2])).sort()).toEqual([
      1, 3,
    ]);
    expect(hardWordOrder(rows, NOW, keepOrder, new Set([1, 2, 3]))).toEqual([]);
    // A word past a week is left out whatever the record says.
    expect(
      hardWordOrder([row(4, { intervalDays: 9 })], NOW, keepOrder),
    ).toEqual([]);
  });

  it('keeps the record per learner and per learner day', () => {
    expect(hardShownKey(7, '2026-11-27')).toBe('arena:hard-shown:7:2026-11-27');
  });
});
