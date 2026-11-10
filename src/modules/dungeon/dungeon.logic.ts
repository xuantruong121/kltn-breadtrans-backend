/**
 * Hầm Bánh Mì (owner 2026-11-09): a roguelite under the bakery. Each floor
 * has one monster, every fifth a boss; a right answer hits it (harder when
 * quick and on a streak), a wrong one or a timeout lets it hit back. After a
 * floor the learner picks one of three toppings; at 0 HP the run ends.
 * Monsters answer multiple choice; bosses want the English word typed from
 * its meaning. A word answered wrong comes back a few questions later.
 *
 * Two modes: "Hầm hôm nay" is the same dungeon for everyone on a day (same
 * monsters, questions and topping offers, from a seed of the date), one run a
 * day, ranked; "Hầm tự do" is random, with a personal record.
 *
 * Pure: no I/O. Randomness comes from seeds, so a day's dungeon is the same
 * for everyone and every rule is testable.
 */
import {
  ARENA_XP_DAILY_CAP,
  type ArenaQuestion,
  type ArenaWord,
  meaningsClash,
  POS_VI,
} from '../events/arena-questions.logic';
import {
  letterHint,
  normalizeAnswer,
} from '../word-blaster/word-blaster.logic';

export const DUNGEON_MODES = ['daily', 'free'] as const;
export type DungeonMode = (typeof DUNGEON_MODES)[number];

export const DUNGEON_TICKET = 20;
/** Bánh Mì per boss beaten, inside the 150 a day cap. */
export const BOSS_REWARD = 10;
export const BOSS_EVERY = 5;
export const PLAYER_HP = 100;
export const DUNGEON_XP_PER_CORRECT = 2;
/** Multiple-choice questions made at the start of a run (more are made if it runs out). */
export const BANK_SIZE = 60;
/** A wrong word comes back after this many other questions. */
export const RETRY_AFTER = 3;
/** An answer this long after the deadline still counts (network delay). */
export const ANSWER_GRACE_MS = 600;

// ---------------------------------------------------------------- randomness

/** A small seeded generator (mulberry32): the same seed, the same numbers. */
export function seededRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** A number from text (FNV-1a), for seeds. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The day's dungeon, by the date in Vietnam: "2026-11-09" for everyone that day. */
export function dailySeed(now: Date): { seed: number; day: string } {
  const vn = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const day = vn.toISOString().slice(0, 10);
  return { seed: hashSeed(`dungeon:${day}`), day };
}

/** A generator for one floor's choices, so they do not depend on what happened before. */
export const floorRng = (seed: number, floor: number, what: string) =>
  seededRng(hashSeed(`${seed}:${floor}:${what}`));

// ---------------------------------------------------------------- monsters

// Owner 2026-11-09: more monsters and bosses (the art is Kenney's New Platformer Pack).
export const MONSTERS = [
  'moldy',
  'mouse',
  'ant',
  'snail',
  'bee',
  'fly',
  'flour_worm',
  'cheese_worm',
  'taiyaki',
] as const;
/** One boss every five floors, in this order, then round again. */
export const BOSSES = [
  'sourdough_king',
  'flour_dragon',
  'matcha_cake',
  'pandan_jelly',
  'yeast_frog',
] as const;
export type MonsterKind = (typeof MONSTERS)[number] | (typeof BOSSES)[number];

export const isBossFloor = (floor: number) => floor % BOSS_EVERY === 0;

/**
 * How long a run opens before the first question's clock starts: the chapter
 * map, then the first monster's greeting (owner 2026-11-09: the map went by
 * before it could be read).
 */
export const RUN_INTRO_MS = 4000;

/**
 * How long a floor reached through a topping opens before its first question:
 * the map was already on the topping screen (owner 2026-11-09: the map showed
 * twice), so only the monster's entrance and greeting, a boss's a little longer.
 */
export function floorIntroMs(floor: number): number {
  return isBossFloor(floor) ? 2600 : 2000;
}

export function monsterHp(floor: number): number {
  const normal = 60 + 18 * (floor - 1);
  return isBossFloor(floor) ? normal * 2 : normal;
}

export function monsterFor(seed: number, floor: number): MonsterKind {
  if (isBossFloor(floor))
    return BOSSES[(floor / BOSS_EVERY - 1) % BOSSES.length];
  const rng = floorRng(seed, floor, 'monster');
  return MONSTERS[Math.floor(rng() * MONSTERS.length)];
}

// ---------------------------------------------------------------- toppings

export type Rarity = 'common' | 'rare' | 'epic';
export const TOPPINGS = {
  garlic_butter: {
    name: 'Bơ tỏi',
    rarity: 'common',
    max: 3,
  },
  sesame: {
    name: 'Mè đen',
    rarity: 'common',
    max: 3,
  },
  cheese: {
    name: 'Phô mai',
    rarity: 'rare',
    max: 3,
  },
  pate: {
    name: 'Pate',
    rarity: 'rare',
    max: 3,
  },
  chili: {
    name: 'Ớt',
    rarity: 'common',
    max: 3,
  },
  condensed_milk: {
    name: 'Sữa đặc',
    rarity: 'common',
    max: 3,
  },
  floss: {
    name: 'Chà bông',
    rarity: 'rare',
    max: 3,
  },
  egg: {
    name: 'Trứng ốp la',
    rarity: 'epic',
    max: 1,
  },
  sausage: {
    name: 'Xúc xích',
    rarity: 'rare',
    max: 3,
  },
  shallot: {
    name: 'Hành phi',
    rarity: 'rare',
    max: 3,
  },
  cucumber: {
    name: 'Dưa leo',
    rarity: 'common',
    max: 99,
  },
  chili_sauce: {
    name: 'Tương ớt',
    rarity: 'epic',
    max: 3,
  },
  breadstick: {
    name: 'Bánh mì que',
    rarity: 'common',
    max: 3,
  },
  salt_pepper: {
    name: 'Muối tiêu',
    rarity: 'common',
    max: 3,
  },
} as const satisfies Record<
  string,
  { name: string; rarity: Rarity; max: number }
>;
export type ToppingId = keyof typeof TOPPINGS;
export const TOPPING_IDS = Object.keys(TOPPINGS) as ToppingId[];
export type Toppings = Partial<Record<ToppingId, number>>;

const RARITY_WEIGHT: Record<Rarity, number> = {
  common: 60,
  rare: 30,
  epic: 10,
};
export const level = (t: Toppings, id: ToppingId) => t[id] ?? 0;

/**
 * Three toppings to choose from after `floor`: distinct, none at its cap,
 * by rarity weight; after a boss only rare and epic ones. The same seed and
 * floor give the same offer, so the day's dungeon offers everyone the same.
 */
export function toppingOffers(
  seed: number,
  floor: number,
  owned: Toppings,
): ToppingId[] {
  const rng = floorRng(seed, floor, 'toppings');
  const afterBoss = isBossFloor(floor);
  let pool = TOPPING_IDS.filter(
    (id) =>
      level(owned, id) < TOPPINGS[id].max &&
      (!afterBoss || TOPPINGS[id].rarity !== 'common'),
  );
  const offers: ToppingId[] = [];
  while (offers.length < 3 && pool.length > 0) {
    const total = pool.reduce(
      (s, id) => s + RARITY_WEIGHT[TOPPINGS[id].rarity],
      0,
    );
    let roll = rng() * total;
    let picked = pool[pool.length - 1];
    for (const id of pool) {
      roll -= RARITY_WEIGHT[TOPPINGS[id].rarity];
      if (roll < 0) {
        picked = id;
        break;
      }
    }
    offers.push(picked);
    pool = pool.filter((id) => id !== picked);
  }
  return offers;
}

// ---------------------------------------------------------------- combat

/** Time for a question: 10 s, a fifth of a second less per floor down to 7 s; a boss gets 15 s. */
export function questionTimeMs(
  floor: number,
  boss: boolean,
  t: Toppings,
): number {
  const base = boss ? 15_000 : Math.max(7_000, 10_000 - 200 * (floor - 1));
  return base + 3_000 * level(t, 'condensed_milk');
}

export const comboCap = (t: Toppings) => 10 + 5 * level(t, 'chili');
export const critChance = (t: Toppings) =>
  Math.min(0.85, 0.1 + 0.15 * level(t, 'pate'));

/**
 * The damage of a right answer. `remainingShare` is the part of the time
 * left (0 to 1); `combo` the right answers in a row before this one.
 */
export function hitDamage(input: {
  remainingShare: number;
  combo: number;
  toppings: Toppings;
  boss: boolean;
  firstHitOfFloor: boolean;
  crit: boolean;
}): number {
  const t = input.toppings;
  const share = Math.min(1, Math.max(0, input.remainingShare));
  const speed = 1 + 0.6 * share * (1 + 0.5 * level(t, 'shallot'));
  const combo = 1 + 0.1 * Math.min(input.combo, comboCap(t));
  const garlic = 1 + 0.2 * level(t, 'garlic_butter');
  const sauce =
    input.firstHitOfFloor && level(t, 'chili_sauce') > 0
      ? 1.5 + 0.5 * level(t, 'chili_sauce')
      : 1;
  const typed = input.boss ? 2.5 : 1;
  const crit = input.crit ? 1.5 : 1;
  return Math.round(20 * speed * combo * garlic * sauce * typed * crit);
}

/** What a wrong answer or a timeout costs. */
export function monsterHit(floor: number, boss: boolean, t: Toppings): number {
  const raw = (8 + 2 * floor) * (boss ? 1.5 : 1);
  const guard = 1 - Math.min(0.45, 0.15 * level(t, 'salt_pepper'));
  return Math.max(1, Math.round(raw * guard));
}

export const healOnCorrect = (t: Toppings) => 3 * level(t, 'sesame');
export const shieldsPerFloor = (t: Toppings) => level(t, 'cheese');
export const flossQuestions = (t: Toppings) => level(t, 'floss');
export const bossHintLetters = (t: Toppings) => level(t, 'breadstick');

// ---------------------------------------------------------------- questions

/** A question as the server keeps it: the answer stays here. */
export type DungeonQuestion =
  | {
      type: 'choice';
      wordId: number;
      kind: ArenaQuestion['kind'];
      prompt: string;
      ipa: string | null;
      options: string[];
      correct: number;
    }
  | {
      type: 'typed';
      wordId: number;
      prompt: string;
      pos: string | null;
      /** One "_" per letter of the English word, spaces kept. */
      hint: string;
      /** The English word and its synonyms in the decks, normalised. */
      answers: string[];
      /** The word as shown, for the letters a topping reveals. */
      display: string;
    };

/** A multiple-choice question from the Arena's question builder, options shuffled. */
export function choiceQuestion(
  q: ArenaQuestion,
  rng: () => number,
): DungeonQuestion {
  const options = [...q.options];
  for (let i = options.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return {
    type: 'choice',
    wordId: q.id,
    kind: q.kind,
    prompt: q.prompt,
    ipa: q.ipa,
    options,
    correct: options.indexOf(q.correctAnswer),
  };
}

/**
 * A boss question: the meaning, and the English word typed. A synonym from
 * the decks is right too ("bảo mật": security, confidential).
 */
export function typedQuestion(
  word: ArenaWord,
  pool: readonly ArenaWord[],
): DungeonQuestion {
  const display = word.displayWord.trim();
  const answers = [
    ...new Set(
      pool
        .filter((w) => w === word || meaningsClash(w.meaningVi, word.meaningVi))
        .map((w) => normalizeAnswer(w.displayWord)),
    ),
  ];
  if (!answers.includes(normalizeAnswer(display)))
    answers.unshift(normalizeAnswer(display));
  return {
    type: 'typed',
    wordId: word.id,
    prompt: word.meaningVi.trim(),
    // The part of speech in Vietnamese, as the multiple-choice prompts say it.
    pos: word.pos ? (POS_VI[word.pos] ?? word.pos) : null,
    hint: letterHint(display),
    answers,
    display,
  };
}

/** A typed answer is right when it is one of the answers, tone marks and case aside. */
export const typedIsRight = (
  q: Extract<DungeonQuestion, { type: 'typed' }>,
  text: string,
) => q.answers.includes(normalizeAnswer(text));

/** What the browser sees of a question: no answer. `removed`: options a topping struck out. */
export type PublicQuestion =
  | {
      type: 'choice';
      kind: ArenaQuestion['kind'];
      prompt: string;
      ipa: string | null;
      options: string[];
      removed: number[];
    }
  | {
      type: 'typed';
      prompt: string;
      pos: string | null;
      hint: string;
      revealed: string;
    };

export function publicQuestion(
  q: DungeonQuestion,
  removed: number[] = [],
  reveal = 0,
): PublicQuestion {
  if (q.type === 'choice')
    return {
      type: 'choice',
      kind: q.kind,
      prompt: q.prompt,
      ipa: q.ipa,
      options: q.options,
      removed,
    };
  return {
    type: 'typed',
    prompt: q.prompt,
    pos: q.pos,
    hint: q.hint,
    revealed: [...q.display].slice(0, Math.max(0, reveal)).join(''),
  };
}

/** Two wrong options to strike out (Chà bông), chosen by the floor's seed. */
export function struckOptions(q: DungeonQuestion, rng: () => number): number[] {
  if (q.type !== 'choice') return [];
  const wrong = q.options.map((_, i) => i).filter((i) => i !== q.correct);
  for (let i = wrong.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [wrong[i], wrong[j]] = [wrong[j], wrong[i]];
  }
  return wrong.slice(0, 2).sort((a, b) => a - b);
}

/** A word answered wrong (by its place in the bank) waits here to come back after a few questions. */
export type Retry = { bank: number; dueAfter: number };

/**
 * The next question: a word due again comes first; otherwise the next from
 * the bank. `answered` is how many questions the run has had.
 */
export function nextFromQueue(
  retries: Retry[],
  answered: number,
): { due: Retry | null; rest: Retry[] } {
  const index = retries.findIndex((r) => r.dueAfter <= answered);
  if (index < 0) return { due: null, rest: retries };
  return { due: retries[index], rest: retries.filter((_, i) => i !== index) };
}

// ---------------------------------------------------------------- rewards

/**
 * Bánh Mì at the end: the ticket back once the floor 5 boss is down (outside
 * the daily cap, like Pháo Bánh Mì's returned stake), and 10 per boss as a
 * bonus inside it.
 */
export function dungeonPayout(bossesDown: number) {
  return {
    returned: bossesDown >= 1 ? DUNGEON_TICKET : 0,
    bonus: BOSS_REWARD * bossesDown,
  };
}

/** XP: 2 per right answer, inside the Arena's 150 a day. */
export function dungeonXp(correct: number, earnedToday: number): number {
  return Math.max(
    0,
    Math.min(
      correct * DUNGEON_XP_PER_CORRECT,
      ARENA_XP_DAILY_CAP - earnedToday,
    ),
  );
}

// ---------------------------------------------------------------- a run

/** Each word of the run, as a monster question and as a boss question. */
export type BankEntry = { choice: DungeonQuestion; typed: DungeonQuestion };

export type Monster = {
  kind: MonsterKind;
  hp: number;
  maxHp: number;
  boss: boolean;
};

export type RunState = {
  seed: number;
  mode: DungeonMode;
  floor: number;
  hp: number;
  maxHp: number;
  toppings: Toppings;
  combo: number;
  bestCombo: number;
  monster: Monster;
  /** fight: a question is out; pick: choosing a topping; over: the run has ended. */
  phase: 'fight' | 'pick' | 'over';
  offers: ToppingId[];
  /** Left on this floor: wrong answers the cheese blocks, questions the floss trims. */
  shieldsLeft: number;
  flossLeft: number;
  firstHitDone: boolean;
  revived: boolean;
  answered: number;
  correct: number;
  bossesDown: number;
  bankCursor: number;
  retries: Retry[];
};

function enterFloor(run: RunState, floor: number): RunState {
  const hp = monsterHp(floor);
  return {
    ...run,
    floor,
    monster: {
      kind: monsterFor(run.seed, floor),
      hp,
      maxHp: hp,
      boss: isBossFloor(floor),
    },
    phase: 'fight',
    offers: [],
    shieldsLeft: shieldsPerFloor(run.toppings),
    flossLeft: flossQuestions(run.toppings),
    firstHitDone: false,
  };
}

export function newRun(seed: number, mode: DungeonMode): RunState {
  return enterFloor(
    {
      seed,
      mode,
      floor: 1,
      hp: PLAYER_HP,
      maxHp: PLAYER_HP,
      toppings: {},
      combo: 0,
      bestCombo: 0,
      monster: { kind: 'moldy', hp: 1, maxHp: 1, boss: false },
      phase: 'fight',
      offers: [],
      shieldsLeft: 0,
      flossLeft: 0,
      firstHitDone: false,
      revived: false,
      answered: 0,
      correct: 0,
      bossesDown: 0,
      bankCursor: 0,
      retries: [],
    },
    1,
  );
}

/** The question to ask now: a word due again, else the next in the bank (going round). */
export function issueQuestion(
  run: RunState,
  bank: BankEntry[],
): {
  run: RunState;
  bankIndex: number;
  question: DungeonQuestion;
  publicView: PublicQuestion;
} {
  const { due, rest } = nextFromQueue(run.retries, run.answered);
  const bankIndex = due ? due.bank : run.bankCursor % bank.length;
  const entry = bank[bankIndex];
  const question = run.monster.boss ? entry.typed : entry.choice;
  let removed: number[] = [];
  let flossLeft = run.flossLeft;
  if (question.type === 'choice' && flossLeft > 0) {
    removed = struckOptions(
      question,
      floorRng(run.seed, run.answered, 'floss'),
    );
    flossLeft -= 1;
  }
  return {
    run: {
      ...run,
      retries: rest,
      bankCursor: due ? run.bankCursor : run.bankCursor + 1,
      flossLeft,
    },
    bankIndex,
    question,
    publicView: publicQuestion(
      question,
      removed,
      bossHintLetters(run.toppings),
    ),
  };
}

export type AnswerOutcome = {
  right: boolean;
  timedOut: boolean;
  damage: number;
  crit: boolean;
  taken: number;
  shielded: boolean;
  killed: boolean;
  died: boolean;
  revived: boolean;
  /** The right answer, shown after a miss so the learner sees it. */
  answer: string;
};

/**
 * Applies one answer. `given` is the option index or the typed text; null is
 * a timeout. `elapsedMs` is the server's time since the question went out.
 */
export function applyAnswer(
  run: RunState,
  question: DungeonQuestion,
  bankIndex: number,
  given: number | string | null,
  elapsedMs: number,
): { run: RunState; outcome: AnswerOutcome } {
  const limit = questionTimeMs(run.floor, run.monster.boss, run.toppings);
  const timedOut = given === null || elapsedMs > limit + ANSWER_GRACE_MS;
  const right =
    !timedOut &&
    (question.type === 'choice'
      ? given === question.correct
      : typeof given === 'string' && typedIsRight(question, given));
  const answer =
    question.type === 'choice'
      ? question.options[question.correct]
      : question.display;
  const next: RunState = {
    ...run,
    answered: run.answered + 1,
    retries: [...run.retries],
  };
  const outcome: AnswerOutcome = {
    right,
    timedOut,
    damage: 0,
    crit: false,
    taken: 0,
    shielded: false,
    killed: false,
    died: false,
    revived: false,
    answer,
  };

  if (right) {
    const crit =
      floorRng(run.seed, run.answered, 'crit')() < critChance(run.toppings);
    const damage = hitDamage({
      remainingShare: 1 - elapsedMs / limit,
      combo: run.combo,
      toppings: run.toppings,
      boss: run.monster.boss,
      firstHitOfFloor: !run.firstHitDone,
      crit,
    });
    next.monster = { ...run.monster, hp: Math.max(0, run.monster.hp - damage) };
    next.combo = run.combo + 1;
    next.bestCombo = Math.max(run.bestCombo, next.combo);
    next.correct = run.correct + 1;
    next.firstHitDone = true;
    next.hp = Math.min(run.maxHp, run.hp + healOnCorrect(run.toppings));
    outcome.damage = damage;
    outcome.crit = crit;
  } else {
    next.combo = 0;
    next.retries.push({
      bank: bankIndex,
      dueAfter: next.answered + RETRY_AFTER,
    });
    if (run.shieldsLeft > 0) {
      next.shieldsLeft = run.shieldsLeft - 1;
      outcome.shielded = true;
    } else {
      const taken = monsterHit(run.floor, run.monster.boss, run.toppings);
      next.hp = run.hp - taken;
      outcome.taken = taken;
      if (next.hp <= 0) {
        if (level(run.toppings, 'egg') > 0 && !run.revived) {
          next.hp = 30;
          next.revived = true;
          outcome.revived = true;
        } else {
          next.hp = 0;
          next.phase = 'over';
          outcome.died = true;
        }
      }
    }
  }

  if (next.phase !== 'over' && next.monster.hp <= 0) {
    outcome.killed = true;
    if (run.monster.boss) next.bossesDown = run.bossesDown + 1;
    next.phase = 'pick';
    next.offers = toppingOffers(run.seed, run.floor, next.toppings);
  }
  return { run: next, outcome };
}

/** Takes one of the offered toppings and goes down to the next floor. */
export function pickTopping(run: RunState, id: ToppingId): RunState {
  if (run.phase !== 'pick' || !run.offers.includes(id))
    throw new Error('not offered');
  return enterFloor({ ...run, ...takeTopping(run, id) }, run.floor + 1);
}

/** What taking a topping changes at once: its level, and the HP Xúc xích and Dưa leo give. */
function takeTopping(
  run: Pick<RunState, 'toppings' | 'hp' | 'maxHp'>,
  id: ToppingId,
): Pick<RunState, 'toppings' | 'hp' | 'maxHp'> {
  const toppings = { ...run.toppings, [id]: level(run.toppings, id) + 1 };
  let { hp, maxHp } = run;
  if (id === 'sausage') {
    maxHp += 25;
    hp += 25;
  }
  if (id === 'cucumber') hp = Math.min(maxHp, hp + 20);
  return { toppings, hp, maxHp };
}

// ---------------------------------------------------------------- topping text

/**
 * The words a learner reads about a topping (owner 2026-11-10: the old lines
 * used game jargon and "mỗi cấp" without saying what the base is). Every
 * number here comes from the rule functions above, so the text cannot drift
 * from the rules.
 */
type EffectContext = {
  floor: number;
  boss: boolean;
  hp: number;
  maxHp: number;
  toppings: Toppings;
  revived: boolean;
};

const num = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');
/** The damage of a plain right answer with only `t`: no speed, no streak, no crit. */
const plainHit = (
  t: Toppings,
  over: Partial<Parameters<typeof hitDamage>[0]>,
) =>
  hitDamage({
    remainingShare: 0,
    combo: 0,
    toppings: t,
    boss: false,
    firstHitOfFloor: false,
    crit: false,
    ...over,
  });
const garlicScale = (l: number) =>
  plainHit({ garlic_butter: l }, {}) / plainHit({}, {});
const streakBonus = (l: number) =>
  Math.round(
    (plainHit({ chili: l }, { combo: comboCap({ chili: l }) }) /
      plainHit({}, {}) -
      1) *
      100,
  );
const speedBonus = (l: number) =>
  Math.round(
    (plainHit({ shallot: l }, { remainingShare: 1 }) / plainHit({}, {}) - 1) *
      100,
  );
const sauceScale = (l: number) =>
  plainHit({ chili_sauce: l }, { firstHitOfFloor: true }) / plainHit({}, {});
const guardPct = (l: number) =>
  Math.round(
    (1 -
      monsterHit(100, false, { salt_pepper: l }) / monsterHit(100, false, {})) *
      100,
  );
const critPct = (t: Toppings) => Math.round(critChance(t) * 100);
const times = (n: number, one: string, many: string) =>
  n === 1 ? one : `${n} ${many}`;

type EffectText = {
  /** What the topping does at level `l` (1 or more), in plain words. */
  sentence: (l: number, c: EffectContext) => string;
  /** The number the topping moves, and its value in context `c`. */
  label: (c: EffectContext) => string;
  value: (c: EffectContext) => string;
};

const floorNote = (c: EffectContext) =>
  ` ở tầng ${c.floor}${c.boss ? ' (boss)' : ''}`;

export const TOPPING_TEXT: Record<ToppingId, EffectText> = {
  garlic_butter: {
    sentence: (l) =>
      `Mỗi câu đúng gây thêm ${Math.round((garlicScale(l) - 1) * 100)}% sát thương.`,
    label: () => 'Sát thương',
    value: (c) => `×${num(garlicScale(level(c.toppings, 'garlic_butter')))}`,
  },
  sesame: {
    sentence: (l) =>
      `Mỗi câu trả lời đúng hồi ${healOnCorrect({ sesame: l })} máu.`,
    label: () => 'Hồi mỗi câu đúng',
    value: (c) => `${healOnCorrect(c.toppings)} máu`,
  },
  cheese: {
    sentence: (l) =>
      `${times(shieldsPerFloor({ cheese: l }), 'Lần', 'lần')} trả lời sai hoặc hết giờ đầu tiên ở mỗi tầng không bị mất máu.`,
    label: () => 'Lần sai được đỡ mỗi tầng',
    value: (c) => `${shieldsPerFloor(c.toppings)}`,
  },
  pate: {
    sentence: (l) =>
      `Tăng khả năng ra đòn chí mạng (đòn gây gấp rưỡi sát thương) lên ${critPct({ pate: l })}%.`,
    label: () => 'Tỉ lệ chí mạng',
    value: (c) => `${critPct(c.toppings)}%`,
  },
  chili: {
    sentence: (l) =>
      `Trả lời đúng liên tiếp thì mỗi câu mạnh thêm 10%, tính tối đa ${comboCap({ chili: l })} câu liền (+${streakBonus(l)}%).`,
    label: () => 'Chuỗi đúng tính tối đa',
    value: (c) => {
      const l = level(c.toppings, 'chili');
      return `${comboCap(c.toppings)} câu (+${streakBonus(l)}%)`;
    },
  },
  condensed_milk: {
    sentence: (l) =>
      `Mỗi câu có thêm ${num((questionTimeMs(1, false, { condensed_milk: l }) - questionTimeMs(1, false, {})) / 1000)} giây để trả lời.`,
    label: (c) => `Thời gian mỗi câu${floorNote(c)}`,
    value: (c) =>
      `${num(questionTimeMs(c.floor, c.boss, c.toppings) / 1000)} giây`,
  },
  floss: {
    sentence: (l) =>
      `${times(flossQuestions({ floss: l }), 'Câu', 'câu')} đầu tiên của mỗi tầng được bỏ bớt 2 đáp án sai (tầng boss không có).`,
    label: () => 'Câu được bỏ bớt đáp án mỗi tầng',
    value: (c) => `${flossQuestions(c.toppings)}`,
  },
  egg: {
    sentence: (_l, c) =>
      c.revived && level(c.toppings, 'egg') > 0
        ? 'Đã dùng lượt sống lại của lượt chơi này.'
        : 'Khi hết máu, bạn sống lại một lần với 30 máu.',
    label: () => 'Lượt sống lại',
    value: (c) => `${level(c.toppings, 'egg') > 0 && !c.revived ? 1 : 0}`,
  },
  sausage: {
    sentence: () => 'Máu tối đa tăng 25 và hồi ngay 25 máu.',
    label: () => 'Máu',
    value: (c) => `${c.hp}/${c.maxHp}`,
  },
  shallot: {
    sentence: (l) =>
      `Trả lời càng nhanh đòn càng mạnh. Hành phi nâng thưởng khi trả lời ngay lên +${speedBonus(l)}% sát thương.`,
    label: () => 'Thưởng khi trả lời ngay',
    value: (c) => `+${speedBonus(level(c.toppings, 'shallot'))}%`,
  },
  cucumber: {
    sentence: () => 'Hồi ngay 20 máu (không vượt quá máu tối đa).',
    label: () => 'Máu',
    value: (c) => `${c.hp}/${c.maxHp}`,
  },
  chili_sauce: {
    sentence: (l) => {
      const x = sauceScale(l);
      return `Câu đúng đầu tiên của mỗi tầng gây sát thương ${x === 2 ? 'gấp đôi' : `gấp ${num(x)} lần`}.`;
    },
    label: () => 'Câu đúng đầu tầng',
    value: (c) => `×${num(sauceScale(level(c.toppings, 'chili_sauce')))}`,
  },
  breadstick: {
    sentence: (l) =>
      `Khi đánh boss (phải gõ từ), hiện sẵn ${bossHintLetters({ breadstick: l })} chữ cái của đáp án.`,
    label: () => 'Chữ cái gợi ý ở tầng boss',
    value: (c) => `${bossHintLetters(c.toppings)}`,
  },
  salt_pepper: {
    sentence: (l) =>
      `Khi trả lời sai hoặc hết giờ, bạn mất ít máu hơn ${guardPct(l)}%.`,
    label: (c) => `Máu mất mỗi lần sai${floorNote(c)}`,
    value: (c) => `${monsterHit(c.floor, c.boss, c.toppings)}`,
  },
};

export type ToppingEffect = { label: string; now: string; next: string };

/**
 * The context the numbers are read in: while choosing, the floor about to
 * start (its clock and its monster's hit); otherwise the floor being fought.
 */
function effectContext(run: RunState): EffectContext {
  const floor = run.phase === 'pick' ? run.floor + 1 : run.floor;
  return {
    floor,
    boss: isBossFloor(floor),
    hp: run.hp,
    maxHp: run.maxHp,
    toppings: run.toppings,
    revived: run.revived,
  };
}

/** One offer in words: what the topping does at the level it would reach, and the number before and after. */
export function toppingOffer(
  run: RunState,
  id: ToppingId,
): { line: string; effect: ToppingEffect } {
  const now = effectContext(run);
  const next = { ...now, ...takeTopping(now, id) };
  const text = TOPPING_TEXT[id];
  return {
    line: text.sentence(level(next.toppings, id), next),
    effect: {
      label: text.label(now),
      now: text.value(now),
      next: text.value(next),
    },
  };
}

/** The toppings the run holds, in words, with their value now. */
export function toppingsHeld(run: RunState): {
  id: ToppingId;
  name: string;
  level: number;
  max: number;
  line: string;
  label: string;
  value: string;
}[] {
  const c = effectContext(run);
  return TOPPING_IDS.filter((id) => level(run.toppings, id) > 0).map((id) => {
    const text = TOPPING_TEXT[id];
    const l = level(run.toppings, id);
    return {
      id,
      name: TOPPINGS[id].name,
      level: l,
      max: TOPPINGS[id].max,
      line: held(id, l, c),
      label: text.label(c),
      value: text.value(c),
    };
  });
}

/** Instant toppings say what they did; the rest say what they do. */
function held(id: ToppingId, l: number, c: EffectContext): string {
  if (id === 'sausage') return `Đã tăng ${25 * l} máu tối đa.`;
  if (id === 'cucumber')
    return l === 1 ? 'Đã hồi 20 máu.' : `Đã dùng ${l} lần, mỗi lần hồi 20 máu.`;
  return TOPPING_TEXT[id].sentence(l, c);
}
