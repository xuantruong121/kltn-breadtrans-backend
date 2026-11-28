import {
  buildArenaQuestions,
  type ArenaWord,
} from '../events/arena-questions.logic';
import {
  ANSWER_GRACE_MS,
  BOSS_REWARD,
  BOSS_STRIKE_EVERY,
  DESPERATE_BOOST,
  DESPERATE_SHARE,
  STRIKE_BREAK_BOOST,
  STRIKE_HIT_BOOST,
  isDesperate,
  strikeIn,
  DUNGEON_TICKET,
  PLAYER_HP,
  RETRY_AFTER,
  TOPPINGS,
  TOPPING_IDS,
  applyAnswer,
  choiceQuestion,
  dailySeed,
  dungeonPayout,
  dungeonXp,
  floorIntroMs,
  RUN_INTRO_MS,
  hardWordsOfRun,
  hitDamage,
  isBossFloor,
  issueQuestion,
  monsterFor,
  monsterHit,
  monsterHp,
  newRun,
  pickTopping,
  questionTimeMs,
  seededRng,
  toppingOffers,
  toppingOffer,
  toppingsHeld,
  critChance,
  comboCap,
  typedQuestion,
  type BankEntry,
  type RunState,
} from './dungeon.logic';

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
];

/** A run's bank as the service builds it. */
function bankFor(seed: number, size = 20): BankEntry[] {
  const rng = seededRng(seed);
  const byId = new Map(pool.map((w) => [w.id, w]));
  return buildArenaQuestions(pool, size, rng).map((q) => ({
    choice: choiceQuestion(q, rng),
    typed: typedQuestion(byId.get(q.id)!, pool),
  }));
}

/** Answers the question now out, right or wrong, `ms` after it went out. */
function answer(run: RunState, bank: BankEntry[], right: boolean, ms = 1000) {
  const issued = issueQuestion(run, bank);
  const q = issued.question;
  const given =
    q.type === 'choice'
      ? right
        ? q.correct
        : (q.correct + 1) % q.options.length
      : right
        ? q.answers[0]
        : 'zzzz';
  return { issued, ...applyAnswer(issued.run, q, issued.bankIndex, given, ms) };
}

describe('floors and monsters', () => {
  it('the run opens on the map; a floor after a topping opens briefly, a boss a little longer', () => {
    expect(RUN_INTRO_MS).toBe(4000);
    expect(floorIntroMs(2)).toBe(2000);
    expect(floorIntroMs(6)).toBe(2000);
    expect(floorIntroMs(5)).toBe(2600);
  });
  it('every fifth floor is a boss with twice the health', () => {
    expect([1, 4, 5, 10].map(isBossFloor)).toEqual([false, false, true, true]);
    expect(monsterHp(1)).toBe(60);
    expect(monsterHp(5)).toBe(2 * (60 + 18 * 4));
  });
  it('the same seed and floor give the same monster', () => {
    expect(monsterFor(42, 3)).toBe(monsterFor(42, 3));
    expect(monsterFor(42, 5)).toBe('sourdough_king');
    expect(monsterFor(42, 10)).toBe('flour_dragon');
    expect([15, 20, 25, 30].map((f) => monsterFor(42, f))).toEqual([
      'matcha_cake',
      'pandan_jelly',
      'yeast_frog',
      'sourdough_king',
    ]);
    // Ordinary floors draw from all nine monsters.
    const seen = new Set<string>();
    for (let seed = 1; seed <= 60; seed += 1)
      for (const f of [1, 2, 3, 4]) seen.add(monsterFor(seed, f));
    expect(seen.size).toBe(9);
  });
  it('the day dungeon is the same all day in Vietnam and changes at midnight there', () => {
    const morning = dailySeed(new Date('2026-11-09T01:00:00+07:00'));
    const night = dailySeed(new Date('2026-11-09T23:30:00+07:00'));
    const next = dailySeed(new Date('2026-11-10T00:10:00+07:00'));
    expect(morning).toEqual(night);
    expect(morning.day).toBe('2026-11-09');
    expect(next.seed).not.toBe(morning.seed);
  });
});

describe('damage', () => {
  const base = {
    remainingShare: 0,
    combo: 0,
    toppings: {},
    boss: false,
    firstHitOfFloor: false,
    crit: false,
  };
  it('quicker answers and streaks hit harder; a typed boss answer hardest', () => {
    expect(hitDamage(base)).toBe(20);
    expect(hitDamage({ ...base, remainingShare: 1 })).toBe(32);
    expect(hitDamage({ ...base, combo: 5 })).toBe(30);
    expect(hitDamage({ ...base, combo: 50 })).toBe(40);
    expect(hitDamage({ ...base, boss: true })).toBe(50);
    expect(hitDamage({ ...base, crit: true })).toBe(30);
  });
  it('toppings stack: garlic butter, chili lifts the combo cap, chili sauce on the first hit', () => {
    expect(hitDamage({ ...base, toppings: { garlic_butter: 2 } })).toBe(28);
    expect(hitDamage({ ...base, combo: 50, toppings: { chili: 1 } })).toBe(50);
    expect(
      hitDamage({
        ...base,
        firstHitOfFloor: true,
        toppings: { chili_sauce: 1 },
      }),
    ).toBe(40);
    expect(
      hitDamage({
        ...base,
        firstHitOfFloor: false,
        toppings: { chili_sauce: 1 },
      }),
    ).toBe(20);
  });
  it('monsters hit harder deeper; salt and pepper softens it', () => {
    expect(monsterHit(1, false, {})).toBe(10);
    expect(monsterHit(5, true, {})).toBe(27);
    expect(monsterHit(1, false, { salt_pepper: 2 })).toBe(7);
  });
  it('a boss on floor 5 falls in about three typed answers', () => {
    const typical = hitDamage({
      ...base,
      remainingShare: 0.5,
      combo: 3,
      boss: true,
    });
    expect(Math.ceil(monsterHp(5) / typical)).toBeLessThanOrEqual(4);
  });
  it('the clock: 10 s, shorter deeper (not under 7 s), 15 s for a boss, condensed milk adds', () => {
    expect(questionTimeMs(1, false, {})).toBe(10_000);
    expect(questionTimeMs(40, false, {})).toBe(7_000);
    expect(questionTimeMs(5, true, {})).toBe(15_000);
    expect(questionTimeMs(1, false, { condensed_milk: 1 })).toBe(13_000);
  });
});

describe('toppings', () => {
  it('three distinct offers, the same for everyone on the same seed and floor', () => {
    const a = toppingOffers(7, 2, {});
    expect(new Set(a).size).toBe(3);
    expect(toppingOffers(7, 2, {})).toEqual(a);
  });
  it('after a boss only rare and epic ones; none at its cap', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      for (const id of toppingOffers(seed, 5, {}))
        expect(TOPPINGS[id].rarity).not.toBe('common');
      expect(toppingOffers(seed, 3, { egg: 1 })).not.toContain('egg');
    }
  });
  it('picking: sausage raises max health, cucumber heals, and the next floor starts', () => {
    let run = {
      ...newRun(1, 'free'),
      phase: 'pick' as const,
      offers: ['sausage' as const],
      hp: 50,
    };
    run = pickTopping(run, 'sausage') as typeof run;
    expect(run.maxHp).toBe(PLAYER_HP + 25);
    expect(run.hp).toBe(75);
    expect(run.floor).toBe(2);
    expect(run.phase).toBe('fight');
    const healed = pickTopping(
      { ...newRun(1, 'free'), phase: 'pick', offers: ['cucumber'], hp: 90 },
      'cucumber',
    );
    expect(healed.hp).toBe(PLAYER_HP);
    expect(() => pickTopping(newRun(1, 'free'), 'egg')).toThrow();
  });
  it('every topping has a name and a cap', () => {
    for (const id of TOPPING_IDS) {
      expect(TOPPINGS[id].name.length).toBeGreaterThan(1);
      expect(TOPPINGS[id].max).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('a run', () => {
  const bank = bankFor(11);

  it('a right answer hits the monster and builds the combo; enough kills it and offers toppings', () => {
    let run = newRun(11, 'free');
    let killed = false;
    for (let i = 0; i < 10 && !killed; i += 1) {
      const step = answer(run, bank, true);
      expect(step.outcome.right).toBe(true);
      run = step.run;
      killed = step.outcome.killed;
    }
    expect(killed).toBe(true);
    expect(run.phase).toBe('pick');
    expect(run.offers).toHaveLength(3);
    expect(run.combo).toBeGreaterThan(1);
  });

  it('a wrong answer costs health, ends the combo, and the word comes back a few questions later', () => {
    let run = newRun(11, 'free');
    const miss = answer(run, bank, false);
    expect(miss.outcome.right).toBe(false);
    expect(miss.run.hp).toBe(PLAYER_HP - monsterHit(1, false, {}));
    expect(miss.run.combo).toBe(0);
    expect(miss.outcome.answer.length).toBeGreaterThan(0);
    run = miss.run;
    const seen: number[] = [];
    for (let i = 0; i < RETRY_AFTER + 1; i += 1) {
      const step = answer(run, bank, true, 9000);
      seen.push(step.issued.bankIndex);
      run =
        step.run.phase === 'pick'
          ? pickTopping(step.run, step.run.offers[0])
          : step.run;
    }
    expect(seen[RETRY_AFTER]).toBe(miss.issued.bankIndex);
  });

  it('an answer after the deadline is a timeout, whatever it says', () => {
    const run = newRun(11, 'free');
    const issued = issueQuestion(run, bank);
    const q = issued.question;
    const late = applyAnswer(
      issued.run,
      q,
      issued.bankIndex,
      q.type === 'choice' ? q.correct : q.answers[0],
      10_000 + ANSWER_GRACE_MS + 1,
    );
    expect(late.outcome.right).toBe(false);
    expect(late.outcome.timedOut).toBe(true);
  });

  it('cheese blocks the first wrong answer of a floor; the egg brings you back once', () => {
    const shielded = answer(
      { ...newRun(11, 'free'), shieldsLeft: 1 },
      bank,
      false,
    );
    expect(shielded.outcome.shielded).toBe(true);
    expect(shielded.run.hp).toBe(PLAYER_HP);

    const egg = answer(
      // The run's last breath is already spent, so the egg is what saves it.
      {
        ...newRun(11, 'free'),
        hp: 1,
        toppings: { egg: 1 },
        lastBreathUsed: true,
      },
      bank,
      false,
    );
    expect(egg.outcome.revived).toBe(true);
    expect(egg.run.hp).toBe(30);
    const dead = answer({ ...egg.run, hp: 1 }, bank, false);
    expect(dead.outcome.died).toBe(true);
    expect(dead.run.phase).toBe('over');
  });

  it('a boss asks for the word typed; a deck synonym is right too', () => {
    const run = {
      ...newRun(11, 'free'),
      floor: 5,
      monster: {
        kind: 'sourdough_king' as const,
        hp: 264,
        maxHp: 264,
        boss: true,
      },
    };
    const issued = issueQuestion(run, bank);
    expect(issued.question.type).toBe('typed');
    expect(issued.publicView.type).toBe('typed');
    // The part of speech in Vietnamese, like the multiple-choice prompts.
    if (issued.publicView.type === 'typed')
      expect(issued.publicView.pos).toBe('danh từ');
    expect(JSON.stringify(issued.publicView)).not.toMatch(/answers|display/);

    const security = pool.find((w) => w.headword === 'security')!;
    const typed = typedQuestion(security, pool);
    const step = applyAnswer(run, typed, 0, 'Confidential', 2000);
    expect(step.outcome.right).toBe(true);
    expect(step.outcome.damage).toBeGreaterThanOrEqual(50);
  });

  it('a boss down counts, and its offer is rare or better', () => {
    const run = {
      ...newRun(11, 'free'),
      floor: 5,
      monster: {
        kind: 'sourdough_king' as const,
        hp: 1,
        maxHp: 264,
        boss: true,
      },
    };
    const step = answer(run, bank, true);
    expect(step.outcome.killed).toBe(true);
    expect(step.run.bossesDown).toBe(1);
    for (const id of step.run.offers)
      expect(TOPPINGS[id].rarity).not.toBe('common');
  });

  it('floss strikes two wrong options from the first question of a floor', () => {
    const issued = issueQuestion({ ...newRun(11, 'free'), flossLeft: 1 }, bank);
    const view = issued.publicView;
    expect(view.type).toBe('choice');
    if (view.type === 'choice' && issued.question.type === 'choice') {
      expect(view.removed).toHaveLength(2);
      expect(view.removed).not.toContain(issued.question.correct);
    }
    expect(JSON.stringify(view)).not.toMatch(/correct/);
  });

  it('the same seed gives the same questions in the same order', () => {
    const a = bankFor(99).map((e) => e.choice.wordId);
    const b = bankFor(99).map((e) => e.choice.wordId);
    expect(a).toEqual(b);
  });
});

describe('rewards', () => {
  it('the ticket comes back once the floor 5 boss is down; each boss adds 10', () => {
    expect(dungeonPayout(0)).toEqual({ returned: 0, bonus: 0 });
    expect(dungeonPayout(1)).toEqual({
      returned: DUNGEON_TICKET,
      bonus: BOSS_REWARD,
    });
    expect(dungeonPayout(3)).toEqual({
      returned: DUNGEON_TICKET,
      bonus: 3 * BOSS_REWARD,
    });
  });
  it('XP: 2 per right answer inside the Arena daily cap', () => {
    expect(dungeonXp(10, 0)).toBe(20);
    expect(dungeonXp(100, 140)).toBe(10);
    expect(dungeonXp(5, 150)).toBe(0);
  });
});

describe('topping text (owner 2026-11-10: plain words, real numbers)', () => {
  const choosing = (over: Partial<ReturnType<typeof newRun>> = {}) => ({
    ...newRun(1, 'free'),
    phase: 'pick' as const,
    hp: 70,
    ...over,
  });

  it('every topping has a plain sentence and a before/after number', () => {
    for (const id of TOPPING_IDS) {
      const { line, effect } = toppingOffer(choosing(), id);
      expect(line).toMatch(/\.$/);
      expect(line).not.toMatch(/combo|mỗi cấp|buff|crit\b/i);
      expect(effect.label.length).toBeGreaterThan(2);
      expect(effect.now).not.toBe(effect.next);
    }
  });

  it('the numbers come from the rules, for the floor about to start', () => {
    const run = choosing({ floor: 1 });
    expect(toppingOffer(run, 'condensed_milk').effect).toEqual({
      label: 'Thời gian mỗi câu ở tầng 2',
      now: `${String(questionTimeMs(2, false, {}) / 1000).replace('.', ',')} giây`,
      next: `${String(questionTimeMs(2, false, { condensed_milk: 1 }) / 1000).replace('.', ',')} giây`,
    });
    expect(toppingOffer(run, 'pate').effect.next).toBe(
      `${Math.round(critChance({ pate: 1 }) * 100)}%`,
    );
    expect(toppingOffer(run, 'chili').effect.next).toBe(
      `${comboCap({ chili: 1 })} câu (+150%)`,
    );
    expect(toppingOffer(run, 'salt_pepper').effect).toMatchObject({
      now: `${monsterHit(2, false, {})}`,
      next: `${monsterHit(2, false, { salt_pepper: 1 })}`,
    });
    expect(toppingOffer(run, 'sausage').effect).toMatchObject({
      now: '70/100',
      next: '95/125',
    });
    expect(toppingOffer(run, 'cucumber').effect.next).toBe('90/100');
  });

  it('a boss floor ahead and higher levels change the words', () => {
    const run = choosing({
      floor: 4,
      toppings: { chili_sauce: 1, condensed_milk: 2 },
    });
    expect(toppingOffer(run, 'condensed_milk').effect.label).toBe(
      'Thời gian mỗi câu ở tầng 5 (boss)',
    );
    expect(toppingOffer(run, 'condensed_milk').effect.next).toBe(
      `${questionTimeMs(5, true, { condensed_milk: 3 }) / 1000} giây`,
    );
    const sauce = toppingOffer(run, 'chili_sauce');
    expect(sauce.line).toContain('gấp 2,5 lần');
    expect(sauce.effect).toMatchObject({ now: '×2', next: '×2,5' });
  });

  it('the held list says what each topping does now', () => {
    const run = {
      ...newRun(1, 'free'),
      toppings: { egg: 1, sausage: 2, garlic_butter: 1 },
      revived: true,
    };
    const held = toppingsHeld(run);
    expect(held.map((h) => h.id)).toEqual(['garlic_butter', 'egg', 'sausage']);
    expect(held[0]).toMatchObject({ level: 1, max: 3, value: '×1,2' });
    expect(held[1]).toMatchObject({ value: '0' });
    expect(held[1].line).toContain('Đã dùng');
    expect(held[2].line).toBe('Đã tăng 50 máu tối đa.');
    expect(toppingsHeld(newRun(1, 'free'))).toEqual([]);
  });
});

describe("the learner's hard words in a free run (thesis supervisor 2026-11-26)", () => {
  const flaggedBank = () => {
    const bank = bankFor(7);
    bank[0] = { ...bank[0], oftenForgotten: true };
    return bank;
  };

  it('marks the question for the browser, and only that one', () => {
    const bank = flaggedBank();
    const first = issueQuestion(newRun(7, 'free'), bank);
    expect(first.publicView.oftenForgotten).toBe(true);
    expect(JSON.stringify(first.publicView)).not.toMatch(/answers|display/);
    const plain = issueQuestion(newRun(7, 'free'), bankFor(7));
    expect(plain.publicView).not.toHaveProperty('oftenForgotten');
  });

  it('counts the first answer of a hard word, right or wrong, once', () => {
    const bank = flaggedBank();
    const run = newRun(7, 'free');
    const issued = issueQuestion(run, bank);
    const q = issued.question;
    if (q.type !== 'choice') throw new Error('expected a choice question');
    const right = applyAnswer(issued.run, q, 0, q.correct, 1000, true);
    expect(hardWordsOfRun(right.run)).toEqual({ hit: 1, total: 1 });
    const wrong = applyAnswer(
      issued.run,
      q,
      0,
      (q.correct + 1) % 4,
      1000,
      true,
    );
    expect(hardWordsOfRun(wrong.run)).toEqual({ hit: 0, total: 1 });
    // The word comes back after a miss: answering it right then changes nothing.
    const again = applyAnswer(wrong.run, q, 0, q.correct, 1000, true);
    expect(hardWordsOfRun(again.run)).toEqual({ hit: 0, total: 1 });
  });

  it('an ordinary question counts nothing, and an old run reads as zero', () => {
    const { run } = answer(newRun(7, 'free'), bankFor(7), true);
    expect(hardWordsOfRun(run)).toEqual({ hit: 0, total: 0 });
    expect(hardWordsOfRun({})).toEqual({ hit: 0, total: 0 });
  });
});

describe('low health and the last breath (2026-11-27)', () => {
  const bank = bankFor(11);
  it('is desperate at a quarter of health or less, never at zero', () => {
    expect(isDesperate(25, 100)).toBe(true);
    expect(isDesperate(26, 100)).toBe(false);
    expect(isDesperate(31, 125)).toBe(true);
    expect(isDesperate(0, 100)).toBe(false);
    expect(DESPERATE_SHARE).toBe(0.25);
  });

  it('a right answer at low health hits harder by the boost', () => {
    const base = newRun(11, 'free');
    const healthy = answer({ ...base, hp: 80 }, bank, true, 0);
    const low = answer({ ...base, hp: 20 }, bank, true, 0);
    expect(healthy.outcome.desperate).toBeUndefined();
    expect(low.outcome.desperate).toBe(true);
    // Both are rounded once from the same raw hit, so they agree within 1.
    expect(
      Math.abs(low.outcome.damage - healthy.outcome.damage * DESPERATE_BOOST),
    ).toBeLessThanOrEqual(1);
    expect(low.outcome.damage).toBeGreaterThan(healthy.outcome.damage);
  });

  it('the first lethal hit of a run leaves 1 health, the second ends it', () => {
    const first = answer({ ...newRun(11, 'free'), hp: 3 }, bank, false);
    expect(first.outcome.lastBreath).toBe(true);
    expect(first.outcome.died).toBe(false);
    expect(first.run.hp).toBe(1);
    expect(first.run.phase).toBe('fight');
    expect(first.run.lastBreathUsed).toBe(true);

    const second = answer(first.run, bank, false);
    expect(second.outcome.lastBreath).toBeUndefined();
    expect(second.outcome.died).toBe(true);
    expect(second.run.phase).toBe('over');
  });

  it('spends the last breath before the egg', () => {
    const first = answer(
      { ...newRun(11, 'free'), hp: 1, toppings: { egg: 1 } },
      bank,
      false,
    );
    expect(first.outcome.lastBreath).toBe(true);
    expect(first.outcome.revived).toBe(false);
    const second = answer(first.run, bank, false);
    expect(second.outcome.revived).toBe(true);
    expect(second.run.hp).toBe(30);
  });
});

describe("the boss's strike (2026-11-27)", () => {
  const bank = bankFor(11);
  const bossRun = () => ({
    ...newRun(11, 'free'),
    floor: 5,
    monster: {
      kind: 'sourdough_king' as const,
      hp: 5000,
      maxHp: 5000,
      boss: true,
    },
    floorAnswered: 0,
  });

  it('counts down 2, 1, 0 and starts again; no count off a boss floor', () => {
    expect([0, 1, 2, 3, 4, 5].map((n) => strikeIn(true, n))).toEqual([
      2, 1, 0, 2, 1, 0,
    ]);
    expect(strikeIn(false, 2)).toBeNull();
    expect(BOSS_STRIKE_EVERY).toBe(3);
  });

  it('tells the page how far the strike is, on boss questions only', () => {
    expect(issueQuestion(bossRun(), bank).publicView.strikeIn).toBe(2);
    expect(
      issueQuestion({ ...bossRun(), floorAnswered: 2 }, bank).publicView
        .strikeIn,
    ).toBe(0);
    expect(
      issueQuestion(newRun(11, 'free'), bank).publicView.strikeIn,
    ).toBeUndefined();
  });

  it('a right answer on the strike breaks it and hits twice as hard', () => {
    const plain = answer({ ...bossRun(), floorAnswered: 1 }, bank, true, 0);
    const strike = answer({ ...bossRun(), floorAnswered: 2 }, bank, true, 0);
    expect(plain.outcome.strike).toBeUndefined();
    expect(strike.outcome.strike).toBe(true);
    expect(
      Math.abs(
        strike.outcome.damage - plain.outcome.damage * STRIKE_BREAK_BOOST,
      ),
    ).toBeLessThanOrEqual(1);
    expect(strike.run.floorAnswered).toBe(3);
  });

  it('a miss on the strike costs one and a half hits; cheese still blocks it', () => {
    const plain = answer({ ...bossRun(), floorAnswered: 1 }, bank, false);
    const strike = answer({ ...bossRun(), floorAnswered: 2 }, bank, false);
    expect(strike.outcome.strike).toBe(true);
    expect(strike.outcome.taken).toBe(
      Math.round(plain.outcome.taken * STRIKE_HIT_BOOST),
    );
    const blocked = answer(
      { ...bossRun(), floorAnswered: 2, shieldsLeft: 1 },
      bank,
      false,
    );
    expect(blocked.outcome.shielded).toBe(true);
    expect(blocked.outcome.taken).toBe(0);
  });

  it('a monster floor has no strike, and a new floor starts the count again', () => {
    const run = { ...newRun(11, 'free'), floorAnswered: 2 };
    const third = answer(run, bank, false);
    expect(third.outcome.strike).toBeUndefined();
    expect(third.outcome.taken).toBe(
      answer(newRun(11, 'free'), bank, false).outcome.taken,
    );
    const picked = pickTopping(
      { ...run, phase: 'pick', offers: ['sesame'] },
      'sesame',
    );
    expect(picked.floorAnswered).toBe(0);
  });
});
