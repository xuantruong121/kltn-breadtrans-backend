import type { ArenaWord } from '../events/arena-questions.logic';
import {
  BLASTER_BLOCKS,
  LANDING_GRACE_MS,
  BLASTER_MODES,
  acceptedMeanings,
  letterHint,
  mainSense,
  blasterPayout,
  blasterXp,
  buildBlasterRound,
  landsAt,
  matchShot,
  missingLetters,
  normalizeAnswer,
  publicBlocks,
  resolve,
  type BlasterBlock,
} from './word-blaster.logic';

/** Deterministic [0, 1) generator, so a failing seed can be replayed. */
function seeded(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

let nextId = 1;
const word = (
  headword: string,
  meaningVi: string,
  level: number,
): ArenaWord => ({
  id: nextId++,
  headword,
  displayWord: headword,
  pos: 'noun',
  meaningVi,
  exampleEn: null,
  ipa: null,
  level,
});

const letters = (i: number) =>
  String.fromCharCode(97 + (i % 26)) +
  String.fromCharCode(97 + Math.floor(i / 26));
const pool: ArenaWord[] = [
  ...[2, 3, 4].flatMap((lvl) =>
    Array.from({ length: 15 }, (_, i) =>
      word(`word${letters(i + lvl * 20)}`, `nghĩa ${lvl}-${i}`, lvl),
    ),
  ),
  word('security', 'bảo mật', 4),
  word('confidential', 'bảo mật; kín', 4),
  word('exchange', 'đổi (tiền, hàng)', 3),
  word('the', 'mạo từ', 1),
];

describe('normalizeAnswer and acceptedMeanings', () => {
  it('drops tone marks, case and extra spaces', () => {
    expect(normalizeAnswer('  Đàm   Phán ')).toBe('dam phan');
    expect(normalizeAnswer('Negotiate!')).toBe('negotiate');
    expect(normalizeAnswer("don't")).toBe("don't");
  });

  it('accepts each sense, without the notes in brackets', () => {
    expect(acceptedMeanings('hoá đơn, biên lai')).toEqual(
      expect.arrayContaining(['hoa don', 'bien lai']),
    );
    expect(acceptedMeanings('đổi (tiền, hàng)')).toEqual(['doi']);
  });
});

describe('missingLetters', () => {
  it('keeps the first letter, hides about 40 %, never all', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const out = missingLetters('negotiate', seeded(seed));
      expect(out[0]).toBe('n');
      expect(out).toHaveLength(9);
      const hidden = [...out].filter((c) => c === '_').length;
      expect(hidden).toBeGreaterThanOrEqual(3);
      expect(hidden).toBeLessThan(8);
    }
    expect(missingLetters('ox', seeded(1))).toBe('o_');
  });
});

describe('mainSense and letterHint', () => {
  it('the first sense, one underscore per letter, spaces kept', () => {
    expect(mainSense('đàm phán')).toBe('đàm phán');
    expect(mainSense('ý kiến; quan điểm')).toBe('ý kiến');
    expect(mainSense('đổi (tiền, hàng)')).toBe('đổi');
    expect(letterHint('đàm phán')).toBe('___ ____');
    expect(letterHint('ý kiến')).toBe('_ ____');
  });
});

describe('buildBlasterRound', () => {
  const cases = BLASTER_MODES.flatMap((mode) =>
    Array.from({ length: 10 }, (_, i) => [mode, i + 1] as const),
  );
  it.each(cases)(
    '%s, seed %i: 20 distinct words, all of the chosen kind, answers fit',
    (mode, seed) => {
      const blocks = buildBlasterRound(pool, seeded(seed), mode);
      expect(blocks).toHaveLength(BLASTER_BLOCKS);
      expect(new Set(blocks.map((b) => b.word.id)).size).toBe(20);
      expect(blocks.every((b) => b.kind === mode)).toBe(true);
      for (const [i, b] of blocks.entries()) {
        if (b.kind === 'en_to_vi')
          expect(b.hint).toBe(letterHint(mainSense(b.word.meaningVi)));
        else expect(b.hint).toBeNull();
        expect(b.word.displayWord).not.toBe('the');
        if (i > 0) expect(b.spawnAtMs).toBeGreaterThan(blocks[i - 1].spawnAtMs);
        if (b.kind === 'copy' || b.kind === 'missing' || b.kind === 'vi_to_en')
          expect(b.answers).toContain(normalizeAnswer(b.word.displayWord));
        if (b.kind === 'en_to_vi') expect(b.prompt).toBe(b.word.displayWord);
        if (b.kind === 'vi_to_en') expect(b.prompt).toBe(b.word.meaningVi);
        if (b.kind === 'missing') expect(b.prompt).toContain('_');
      }
      // Later blocks fall faster than early ones.
      expect(blocks[blocks.length - 1].fallMs).toBeLessThan(blocks[0].fallMs);
    },
  );

  it('a synonym in the decks is accepted for meaning-to-word', () => {
    let checked = 0;
    for (let seed = 1; seed <= 200 && checked < 3; seed += 1) {
      for (const b of buildBlasterRound(pool, seeded(seed), 'vi_to_en')) {
        if (b.kind !== 'vi_to_en' || b.word.displayWord !== 'security')
          continue;
        expect(b.answers).toEqual(
          expect.arrayContaining(['security', 'confidential']),
        );
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('the browser view has no answers and no word', () => {
    const view = publicBlocks(buildBlasterRound(pool, seeded(3), 'en_to_vi'));
    const json = JSON.stringify(view);
    expect(json).not.toContain('answers');
    expect(json).not.toContain('meaningVi');
    expect(Object.keys(view[0]).sort()).toEqual([
      'fallMs',
      'hint',
      'id',
      'kind',
      'lane',
      'prompt',
      'spawnAtMs',
    ]);
  });
});

/** Three blocks on a fixed schedule, for the rules of play. */
const block = (
  id: number,
  spawnAtMs: number,
  fallMs: number,
  answer: string,
): BlasterBlock => ({
  id,
  kind: 'copy',
  prompt: answer,
  answers: [answer],
  spawnAtMs,
  fallMs,
  lane: 0.5,
  hint: null,
  word: { id, displayWord: answer, meaningVi: '' },
});

describe('matchShot and resolve', () => {
  const three = [
    block(1, 0, 5000, 'alpha'),
    block(2, 1000, 5000, 'beta'),
    block(3, 2000, 5000, 'alpha'),
  ];

  it('hits the block on screen closest to landing', () => {
    expect(matchShot(three, {}, 'Alpha ', 2500)).toBe(1);
    expect(matchShot(three, { 1: 2500 }, 'alpha', 2600)).toBe(3);
  });

  it('misses a block not yet spawned or already landed', () => {
    expect(matchShot(three, {}, 'beta', 500)).toBeNull();
    expect(
      matchShot(three, {}, 'alpha', landsAt(three[0]) + LANDING_GRACE_MS + 1),
    ).toBe(3);
    expect(matchShot(three, {}, 'gamma', 2500)).toBeNull();
  });

  it('three landed blocks lose; every block gone with a life left wins', () => {
    const lost = resolve(three, {}, 10_000);
    expect(lost).toMatchObject({
      landed: 3,
      livesLeft: 0,
      over: true,
      outcome: 'lose',
      endedAtMs: 7000,
    });
    const won = resolve(three, { 1: 3000, 3: 4000 }, 10_000);
    expect(won).toMatchObject({
      destroyed: 2,
      landed: 1,
      livesLeft: 2,
      over: true,
      outcome: 'win',
    });
    const running = resolve(three, { 1: 3000 }, 4000);
    expect(running).toMatchObject({ over: false, outcome: null, livesLeft: 3 });
  });

  it('no shot counts once the game is lost', () => {
    const many = [1, 2, 3, 4].map((i) => block(i, 0, 1000 * i, `w${i}`));
    expect(resolve(many, {}, 3500).over).toBe(true);
    expect(matchShot(many, {}, 'w4', 3500)).toBeNull();
  });
});

describe('blasterPayout and blasterXp', () => {
  it('a win returns the stake and half of it; a loss nothing', () => {
    expect(blasterPayout(50, 'win')).toEqual({ returned: 50, bonus: 25 });
    expect(blasterPayout(20, 'win')).toEqual({ returned: 20, bonus: 10 });
    expect(blasterPayout(100, 'lose')).toEqual({ returned: 0, bonus: 0 });
  });

  it('2 XP per block, inside the Arena daily 150', () => {
    expect(blasterXp(20, 0)).toBe(40);
    expect(blasterXp(20, 130)).toBe(20);
    expect(blasterXp(20, 150)).toBe(0);
  });
});
