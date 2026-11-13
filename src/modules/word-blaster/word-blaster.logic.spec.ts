import type { ArenaWord } from '../events/arena-questions.logic';
import {
  BLASTER_BLOCKS,
  LANDING_GRACE_MS,
  BLASTER_MODES,
  EMPTY_LEAD_MS,
  FIRST_SPAWN_MS,
  PAIR_GAP_MS,
  acceptedMeanings,
  blasterTiming,
  pairsWithPrevious,
  pullForward,
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
      // Room for the 3-2-1 countdown before the first block.
      expect(blocks[0].spawnAtMs).toBe(FIRST_SPAWN_MS);
      for (const [i, b] of blocks.entries()) {
        if (b.kind === 'en_to_vi')
          expect(b.hint).toBe(letterHint(mainSense(b.word.meaningVi)));
        else if (b.kind === 'vi_to_en')
          expect(b.hint).toBe(letterHint(b.word.displayWord));
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
  it('a win returns the stake and adds the stake again; a loss nothing', () => {
    expect(blasterPayout(50, 'win')).toEqual({ returned: 50, bonus: 50 });
    expect(blasterPayout(20, 'win')).toEqual({ returned: 20, bonus: 20 });
    expect(blasterPayout(100, 'win')).toEqual({ returned: 100, bonus: 100 });
    expect(blasterPayout(100, 'lose')).toEqual({ returned: 0, bonus: 0 });
  });

  it('2 XP per block, inside the Arena daily 150', () => {
    expect(blasterXp(20, 0)).toBe(40);
    expect(blasterXp(20, 130)).toBe(20);
    expect(blasterXp(20, 150)).toBe(0);
  });
});

describe('pace (owner 2026-11-08: too slow for a fast typist)', () => {
  it('gaps shrink from 3.2 s to 2.3 s and falls speed up by 25 % (owner 2026-11-12: the end was too fast)', () => {
    expect(blasterTiming(0, 20)).toEqual({ gapMs: 3200, speed: 1 });
    expect(blasterTiming(19, 20)).toEqual({ gapMs: 2300, speed: 1.25 });
  });

  it('the last block falls 7.2 s in copy mode and 10.4 s in Vietnamese', () => {
    const copy = buildBlasterRound(pool, seeded(1), 'copy');
    expect(copy[copy.length - 1].fallMs).toBe(7200);
    const vi = buildBlasterRound(pool, seeded(1), 'en_to_vi');
    expect(vi[vi.length - 1].fallMs).toBe(10400);
  });

  it('only the second to last block falls together with the one before it, a lane apart', () => {
    const paired = Array.from({ length: 20 }, (_, i) => i).filter((i) =>
      pairsWithPrevious(i, 20),
    );
    expect(paired).toEqual([18]);
    expect(
      Array.from({ length: 5 }, (_, i) => i).filter((i) =>
        pairsWithPrevious(i, 5),
      ),
    ).toEqual([]);
    const lanes = [0.12, 0.31, 0.5, 0.69, 0.88];
    for (let seed = 1; seed <= 30; seed += 1) {
      const blocks = buildBlasterRound(pool, seeded(seed), 'copy');
      for (const i of paired) {
        expect(blocks[i].spawnAtMs - blocks[i - 1].spawnAtMs).toBe(PAIR_GAP_MS);
        const apart = Math.abs(
          lanes.indexOf(blocks[i].lane) - lanes.indexOf(blocks[i - 1].lane),
        );
        expect(apart).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('a game still runs about a minute', () => {
    // Owner 2026-11-12: the slower end adds a few seconds; pullForward still
    // cuts the wait for a learner who clears the field early.
    const blocks = buildBlasterRound(pool, seeded(1), 'copy');
    expect(landsAt(blocks[blocks.length - 1])).toBeLessThan(65_000);
  });
});

describe('pullForward', () => {
  const schedule = () => [
    block(1, 0, 5000, 'alpha'),
    block(2, 4000, 5000, 'beta'),
    block(3, 7000, 5000, 'gamma'),
  ];

  it('an empty field brings the next block in soon and keeps the spacing', () => {
    const blocks = schedule();
    const moved = pullForward(blocks, { 1: 1500 }, 1500);
    expect(moved).toBe(4000 - (1500 + EMPTY_LEAD_MS));
    expect(blocks.map((b) => b.spawnAtMs)).toEqual([
      0,
      1500 + EMPTY_LEAD_MS,
      1500 + EMPTY_LEAD_MS + 3000,
    ]);
  });

  it('nothing moves while a block is still on screen', () => {
    const blocks = schedule();
    expect(pullForward(blocks, {}, 1500)).toBe(0);
    expect(blocks.map((b) => b.spawnAtMs)).toEqual([0, 4000, 7000]);
  });

  it('a landed block inside the grace still counts as on screen', () => {
    const blocks = schedule();
    expect(pullForward(blocks, {}, 5000 + LANDING_GRACE_MS)).toBe(0);
  });

  it('nothing moves when the next block is already close, or none is left', () => {
    const blocks = schedule();
    expect(pullForward(blocks, { 1: 3500 }, 3500)).toBe(0);
    const done = schedule();
    expect(pullForward(done, { 1: 1, 2: 4100, 3: 7100 }, 7100)).toBe(0);
  });

  it('the game resolves the same after a pull: past hits and landings stay', () => {
    const blocks = schedule();
    const hits = { 1: 1500 };
    pullForward(blocks, hits, 1500);
    expect(resolve(blocks, hits, 1500)).toMatchObject({
      destroyed: 1,
      landed: 0,
    });
  });
});
