import {
  ARENA_ROUNDS,
  arenaXp,
  vietnamDayStart,
  blankedExample,
  buildArenaQuestions,
  kindsFor,
  meaningsClash,
  roundPoints,
  stageLevels,
  type ArenaWord,
} from './arena-questions.logic';

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
  level: number | null,
  pos = 'noun',
  example: string | null = `We talked about the ${headword} today.`,
): ArenaWord => ({
  id: nextId++,
  headword,
  displayWord: headword,
  pos,
  meaningVi,
  exampleEn: example,
  ipa: `/${headword}/`,
  level,
});

// 3 levels x 16 nouns (letters only: a digit would make them junk), 12 verbs,
// plus junk and a clashing meaning.
const pool: ArenaWord[] = [
  ...['A2', 'B1', 'B2'].flatMap((lvl, li) =>
    Array.from({ length: 16 }, (_, i) =>
      word(
        `noun${['aa', 'bb', 'cc'][li]}x${String.fromCharCode(97 + i)}`,
        `danh từ ${lvl} số ${i}`,
        li + 2,
      ),
    ),
  ),
  ...Array.from({ length: 12 }, (_, i) =>
    word(
      `verbx${String.fromCharCode(97 + i)}`,
      `động từ số ${i}`,
      3,
      'verb',
      `They verbx${String.fromCharCode(97 + i)} every day.`,
    ),
  ),
  word('the', 'mạo từ xác định', 1, 'article'),
  word('00', 'số không', 1, 'number'),
  word('security', 'bảo mật', 4),
  word('confidential', 'bảo mật; kín', 4, 'adjective'),
];

describe('roundPoints', () => {
  it('100 plus up to 50 for speed within 12 seconds', () => {
    expect(roundPoints(true, 0, 0, 10)).toBe(150);
    expect(roundPoints(true, 6000, 0, 10)).toBe(125);
    expect(roundPoints(true, 12_000, 0, 10)).toBe(100);
    expect(roundPoints(true, 20_000, 0, 10)).toBe(100);
    expect(roundPoints(false, 0, 0, 10)).toBe(0);
  });

  it('the last question is worth double', () => {
    expect(roundPoints(true, 0, 9, 10)).toBe(300);
    expect(roundPoints(false, 0, 9, 10)).toBe(0);
  });
});

describe('arenaXp and vietnamDayStart', () => {
  it('5 XP per correct answer, never past 150 a day', () => {
    expect(arenaXp(10, 0)).toBe(50);
    expect(arenaXp(0, 0)).toBe(0);
    expect(arenaXp(7, 120)).toBe(30);
    expect(arenaXp(7, 150)).toBe(0);
    expect(arenaXp(7, 400)).toBe(0);
  });

  it('the day starts at midnight in Vietnam', () => {
    // 03:00 on 9 Nov in Vietnam is 20:00 UTC on 8 Nov.
    expect(
      vietnamDayStart(new Date('2026-11-08T20:00:00Z')).toISOString(),
    ).toBe('2026-11-08T17:00:00.000Z');
    // 23:59 on 8 Nov in Vietnam.
    expect(
      vietnamDayStart(new Date('2026-11-08T16:59:00Z')).toISOString(),
    ).toBe('2026-11-07T17:00:00.000Z');
  });
});

describe('stageLevels and kindsFor', () => {
  it('10 rounds: 1-3 A2-B1, 4-7 B1, 8-10 B2', () => {
    const stages = Array.from({ length: 10 }, (_, i) => stageLevels(i, 10));
    expect(stages.slice(0, 3)).toEqual([
      [2, 3],
      [2, 3],
      [2, 3],
    ]);
    expect(stages.slice(3, 7)).toEqual([[3], [3], [3], [3]]);
    expect(stages.slice(7)).toEqual([[4], [4], [4]]);
  });

  it('every kind appears at least three times in 10 rounds', () => {
    const kinds = kindsFor(10, seeded(1));
    for (const k of ['fill_blank', 'meaning_to_word', 'word_to_meaning'])
      expect(kinds.filter((x) => x === k).length).toBeGreaterThanOrEqual(3);
  });
});

describe('helpers', () => {
  it('blanks the word only as a whole word', () => {
    const w = word(
      'contract',
      'hợp đồng',
      3,
      'noun',
      'Contract law: sign the contract, not the contractor.',
    );
    expect(blankedExample(w)).toBe(
      '_____ law: sign the _____, not the contractor.',
    );
    expect(
      blankedExample(word('plan', 'kế hoạch', 3, 'noun', 'We are planning.')),
    ).toBeNull();
  });

  it('meanings clash when they share a sense', () => {
    expect(meaningsClash('bảo mật', 'bảo mật; kín')).toBe(true);
    expect(meaningsClash('mở; khai mạc', 'đóng')).toBe(false);
  });

  it('meanings clash when one sense holds the other as whole words', () => {
    expect(meaningsClash('hóa đơn, biên lai', 'hóa đơn thanh toán')).toBe(true);
    expect(meaningsClash('thanh toán', 'hóa đơn thanh toán')).toBe(true);
    expect(meaningsClash('lợi nhuận', 'doanh thu')).toBe(false);
    // Whole words only: "phí" is not inside "phía".
    expect(meaningsClash('phí', 'phía trước')).toBe(false);
  });
});

describe('buildArenaQuestions', () => {
  const seeds = Array.from({ length: 40 }, (_, i) => i + 1);

  it.each(seeds)('seed %i: 10 sound questions', (seed) => {
    const qs = buildArenaQuestions(pool, ARENA_ROUNDS, seeded(seed));
    expect(qs).toHaveLength(10);
    const byId = new Map(pool.map((w) => [w.id, w]));
    const targetWords = new Set(
      qs.map((q) => byId.get(q.id)!.displayWord.toLowerCase()),
    );
    const targetMeanings = new Set(qs.map((q) => byId.get(q.id)!.meaningVi));

    for (const [i, q] of qs.entries()) {
      // Four different options, one of them right.
      expect(new Set(q.options.map((o) => o.toLowerCase())).size).toBe(4);
      expect(q.options).toContain(q.correctAnswer);
      const target = byId.get(q.id)!;
      expect(target.headword).toMatch(/^[a-z][a-z'-]{2,}$/);

      // Distractors are never the answer of another round.
      for (const o of q.options) {
        if (o === q.correctAnswer) continue;
        expect(targetWords.has(o.toLowerCase())).toBe(false);
        expect(targetMeanings.has(o)).toBe(false);
      }

      // Harder as the match goes on.
      if (i < 3) expect(target.level!).toBeLessThanOrEqual(3);
      if (i >= 7) expect(target.level!).toBe(4);

      if (q.kind === 'fill_blank') {
        expect(q.prompt).toContain('_____');
        expect(q.prompt.toLowerCase()).not.toMatch(
          new RegExp(`\\b${target.headword}\\b`),
        );
      }
      if (q.kind !== 'word_to_meaning') expect(q.ipa).toBeNull();
      else expect(q.ipa).toBe(target.headword);
    }
    expect(new Set(qs.map((q) => q.kind)).size).toBe(3);
  });

  it('never offers two meanings that share a sense', () => {
    for (const seed of seeds) {
      for (const q of buildArenaQuestions(pool, ARENA_ROUNDS, seeded(seed))) {
        if (q.kind !== 'word_to_meaning') continue;
        for (const a of q.options)
          for (const b of q.options)
            if (a !== b) expect(meaningsClash(a, b)).toBe(false);
      }
    }
  });

  it('distractors share the part of speech when enough words do', () => {
    const verbs = new Set(
      pool.filter((w) => w.pos === 'verb').map((w) => w.displayWord),
    );
    let checked = 0;
    for (const seed of seeds) {
      const qs = buildArenaQuestions(pool, ARENA_ROUNDS, seeded(seed));
      const byId = new Map(pool.map((w) => [w.id, w.displayWord]));
      const answers = new Set(qs.map((q) => byId.get(q.id)));
      const spareVerbs = [...verbs].filter((v) => !answers.has(v)).length;
      if (spareVerbs < 3) continue;
      for (const q of qs) {
        if (q.kind === 'word_to_meaning' || !verbs.has(q.correctAnswer))
          continue;
        checked += 1;
        expect(q.options.every((o) => verbs.has(o))).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('meaning questions take their distractors from the target deck', () => {
    // Deck 5 (finance) next to many unrelated B2 nouns from other decks.
    const finance = [
      ['profit', 'lợi nhuận'],
      ['revenue', 'doanh thu'],
      ['expense', 'chi phí'],
      ['budget', 'ngân sách'],
      ['forecast', 'dự báo'],
      ['estimate', 'bản ước tính'],
      ['invoice', 'hóa đơn thanh toán'],
      ['payment', 'thanh toán'],
    ].map(([w, m]) => ({ ...word(w, m, 4), topics: [5] }));
    const others = Array.from({ length: 30 }, (_, i) => ({
      ...word(
        `otherx${String.fromCharCode(97 + (i % 26))}${'abc'[Math.floor(i / 26)]}`,
        `nghĩa khác số ${i}`,
        [2, 3, 4][i % 3],
      ),
      topics: [100 + (i % 4)],
    }));
    const deck = [...finance, ...others];
    const financeIds = new Set(finance.map((w) => w.id));
    const byText = new Map<string, number>();
    for (const w of deck) {
      byText.set(w.displayWord, w.id);
      byText.set(w.meaningVi, w.id);
    }
    let checked = 0;
    for (const seed of seeds) {
      const qs = buildArenaQuestions(deck, ARENA_ROUNDS, seeded(seed));
      const targets = new Set(qs.map((q) => q.id));
      const spare = finance.filter((w) => !targets.has(w.id)).length;
      for (const q of qs) {
        if (q.kind === 'fill_blank' || !financeIds.has(q.id)) continue;
        if (spare < 5) continue; // invoice/payment clash may leave fewer
        checked += 1;
        for (const o of q.options)
          expect(financeIds.has(byText.get(o)!)).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('returns fewer questions when the pool is too small', () => {
    expect(
      buildArenaQuestions(pool.slice(0, 5), 10, seeded(3)).length,
    ).toBeLessThan(10);
  });
});
