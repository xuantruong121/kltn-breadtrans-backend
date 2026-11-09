import {
  buildArenaQuestions,
  type ArenaWord,
} from '../events/arena-questions.logic';
import {
  ANSWER_GRACE_MS,
  BOSS_REWARD,
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
      { ...newRun(11, 'free'), hp: 1, toppings: { egg: 1 } },
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
