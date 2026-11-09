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

export const MONSTERS = ['moldy', 'mouse', 'ant', 'snail'] as const;
export const BOSSES = ['sourdough_king', 'flour_dragon'] as const;
export type MonsterKind = (typeof MONSTERS)[number] | (typeof BOSSES)[number];

export const isBossFloor = (floor: number) => floor % BOSS_EVERY === 0;

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
    line: '+20% sát thương mỗi cấp',
    rarity: 'common',
    max: 3,
  },
  sesame: {
    name: 'Mè đen',
    line: 'Hồi 3 máu mỗi câu đúng, mỗi cấp',
    rarity: 'common',
    max: 3,
  },
  cheese: {
    name: 'Phô mai',
    line: 'Chặn lần sai đầu tiên mỗi tầng (mỗi cấp thêm một lần)',
    rarity: 'rare',
    max: 3,
  },
  pate: {
    name: 'Pate',
    line: '+15% tỉ lệ chí mạng mỗi cấp',
    rarity: 'rare',
    max: 3,
  },
  chili: {
    name: 'Ớt',
    line: 'Combo tối đa +5 mỗi cấp',
    rarity: 'common',
    max: 3,
  },
  condensed_milk: {
    name: 'Sữa đặc',
    line: '+3 giây mỗi câu, mỗi cấp',
    rarity: 'common',
    max: 3,
  },
  floss: {
    name: 'Chà bông',
    line: 'Câu đầu mỗi tầng bỏ bớt 2 đáp án sai (mỗi cấp thêm một câu)',
    rarity: 'rare',
    max: 3,
  },
  egg: {
    name: 'Trứng ốp la',
    line: 'Hồi sinh một lần với 30 máu',
    rarity: 'epic',
    max: 1,
  },
  sausage: {
    name: 'Xúc xích',
    line: '+25 máu tối đa và hồi 25 máu',
    rarity: 'rare',
    max: 3,
  },
  shallot: {
    name: 'Hành phi',
    line: 'Thưởng tốc độ mạnh hơn mỗi cấp',
    rarity: 'rare',
    max: 3,
  },
  cucumber: {
    name: 'Dưa leo',
    line: 'Hồi 20 máu ngay',
    rarity: 'common',
    max: 99,
  },
  chili_sauce: {
    name: 'Tương ớt',
    line: 'Câu đúng đầu tiên mỗi tầng: sát thương ×2 (+0,5 mỗi cấp)',
    rarity: 'epic',
    max: 3,
  },
  breadstick: {
    name: 'Bánh mì que',
    line: 'Boss lộ thêm 1 chữ cái mỗi cấp',
    rarity: 'common',
    max: 3,
  },
  salt_pepper: {
    name: 'Muối tiêu',
    line: 'Bị đánh mất ít máu hơn 15% mỗi cấp',
    rarity: 'common',
    max: 3,
  },
} as const satisfies Record<
  string,
  { name: string; line: string; rarity: Rarity; max: number }
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
  const toppings = { ...run.toppings, [id]: level(run.toppings, id) + 1 };
  let { hp, maxHp } = run;
  if (id === 'sausage') {
    maxHp += 25;
    hp += 25;
  }
  if (id === 'cucumber') hp = Math.min(maxHp, hp + 20);
  return enterFloor({ ...run, toppings, hp, maxHp }, run.floor + 1);
}
