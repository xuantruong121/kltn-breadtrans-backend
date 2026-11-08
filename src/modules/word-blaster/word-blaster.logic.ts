/**
 * Pháo Bánh Mì (owner 2026-11-08): word blocks fall; the learner types the
 * answer and the bread cannon breaks the block before it lands. 20 blocks,
 * 3 lives: the game is won when every block is gone (shot or landed) with a
 * life left. Pure: words and randomness come in as arguments, and every time
 * is in milliseconds since the game started, by the server's clock.
 *
 * Reward (owner: "as little inflation as possible, not x3"): a win returns
 * the stake and adds half of it, and that half counts toward the shared 150
 * Bánh Mì daily cap; a loss keeps the stake. The game takes Bánh Mì out more
 * than it puts in.
 */
import {
  ARENA_XP_DAILY_CAP,
  isDuelWord,
  meaningsClash,
  senses,
  shuffle,
  stageLevels,
  type ArenaWord,
} from '../events/arena-questions.logic';

export const BLASTER_BLOCKS = 20;
export const BLASTER_LIVES = 3;
export const BLASTER_STAKES = [20, 50, 100] as const;
/** A shot this long after a block's landing still counts (network delay). */
export const LANDING_GRACE_MS = 400;
export const BLASTER_XP_PER_BLOCK = 2;
/** The page counts down 3, 2, 1 before the first block appears. */
export const FIRST_SPAWN_MS = 3500;
const LANES = [0.12, 0.31, 0.5, 0.69, 0.88];

export type BlasterKind = 'copy' | 'missing' | 'vi_to_en' | 'en_to_vi';

/**
 * Owner 2026-11-08: the learner picks one kind for the whole game instead of
 * a mix: copy the word, fill the missing letters, Vietnamese meaning to the
 * English word, or the English word to its Vietnamese meaning.
 */
export type BlasterMode = BlasterKind;
export const BLASTER_MODES: BlasterMode[] = [
  'copy',
  'missing',
  'vi_to_en',
  'en_to_vi',
];
/** A meaning longer than this makes a block too wide to read while it falls. */
const MAX_HINT_LENGTH = 24;

/** Slower falls for kinds that take longer to type (Vietnamese most of all). */
const BASE_FALL_MS: Record<BlasterKind, number> = {
  copy: 9000,
  missing: 10000,
  vi_to_en: 11000,
  en_to_vi: 13000,
};

export type BlasterBlock = {
  id: number;
  kind: BlasterKind;
  prompt: string;
  /** Normalised accepted answers. Never sent to the browser. */
  answers: string[];
  spawnAtMs: number;
  fallMs: number;
  /** Horizontal position, 0 (left) to 1 (right). */
  lane: number;
  /**
   * One "_" per letter of the answer to type, spaces kept: the meaning for
   * en_to_vi ("đàm phán" → "___ ____"), the English word for vi_to_en
   * ("negotiate" → "_________"). Null when the word is on the block.
   */
  hint: string | null;
  word: { id: number; displayWord: string; meaningVi: string };
};

export type PublicBlock = Pick<
  BlasterBlock,
  'id' | 'kind' | 'prompt' | 'spawnAtMs' | 'fallMs' | 'lane' | 'hint'
>;

/** What the browser may see: no answers, no word behind the prompt. */
export function publicBlocks(blocks: BlasterBlock[]): PublicBlock[] {
  return blocks.map(({ id, kind, prompt, spawnAtMs, fallMs, lane, hint }) => ({
    id,
    kind,
    prompt,
    spawnAtMs,
    fallMs,
    lane,
    hint,
  }));
}

/** The meaning the hint stands for: the first sense, without notes in brackets. */
export function mainSense(meaningVi: string): string {
  const plain = meaningVi.replace(/\([^)]*\)/g, ' ');
  const first = plain
    .split(/[;,]/)
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .find(Boolean);
  return (first ?? plain.trim()).normalize('NFC');
}

/** One "_" per letter, spaces kept: "đàm phán" → "___ ____". */
export function letterHint(sense: string): string {
  return [...sense.normalize('NFC')]
    .map((c) => (c === ' ' ? ' ' : '_'))
    .join('');
}

/** Lower case, no Vietnamese tone marks, single spaces: "Đàm  Phán" → "dam phan". */
export function normalizeAnswer(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9'\- ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The meanings a learner may type: every sense, without the notes in brackets. */
export function acceptedMeanings(meaningVi: string): string[] {
  const plain = meaningVi.replace(/\([^)]*\)/g, ' ');
  const all = [...senses(plain), plain].map(normalizeAnswer).filter(Boolean);
  return [...new Set(all)];
}

/** About 40 % of the letters after the first become "_"; at least one, never all. */
export function missingLetters(word: string, rng: () => number): string {
  const chars = [...word];
  const slots = chars
    .map((c, i) => (i > 0 && /[a-z]/i.test(c) ? i : -1))
    .filter((i) => i >= 0);
  if (slots.length === 0) return word;
  const hide = Math.min(
    slots.length - (slots.length > 1 ? 1 : 0),
    Math.max(1, Math.round(slots.length * 0.4)),
  );
  for (const i of shuffle(slots, rng).slice(0, hide)) chars[i] = '_';
  return chars.join('');
}

/**
 * Seconds between blocks shrink from 3.2 to 1.5; falls speed up by 40 %.
 * Owner 2026-11-08: 5 to 2.8 s left a fast typist waiting at an empty field.
 */
export function blasterTiming(index: number, count: number) {
  const p = count > 1 ? index / (count - 1) : 0;
  return { gapMs: Math.round(3200 - 1700 * p), speed: 1 + 0.4 * p };
}

/** A block that comes with the one before it is this far behind it. */
export const PAIR_GAP_MS = 300;

/** In the last third, every third block comes with the one before it: two fall together. */
export function pairsWithPrevious(index: number, count: number): boolean {
  const start = Math.ceil((count * 2) / 3);
  return index > start && (index - start) % 3 === 1;
}

/** How soon the next block comes once the field is empty. */
export const EMPTY_LEAD_MS = 800;

/**
 * Owner 2026-11-08: nobody should wait at an empty field. When no block is
 * on screen (every one that appeared is broken or has landed), the blocks
 * still to come move earlier, all by the same amount, so the next appears
 * `leadMs` from now and the spacing between them stays. Changes `blocks` in
 * place and returns how far they moved (0 when there was nothing to do).
 * Past events are untouched: only blocks not yet shown move.
 */
export function pullForward(
  blocks: BlasterBlock[],
  hits: Record<number, number>,
  nowMs: number,
  leadMs = EMPTY_LEAD_MS,
): number {
  const onScreen = blocks.some(
    (b) =>
      hits[b.id] === undefined &&
      b.spawnAtMs <= nowMs &&
      nowMs <= landsAt(b) + LANDING_GRACE_MS,
  );
  if (onScreen) return 0;
  const upcoming = blocks.filter((b) => b.spawnAtMs > nowMs);
  if (upcoming.length === 0) return 0;
  const shift =
    Math.min(...upcoming.map((b) => b.spawnAtMs)) - (nowMs + leadMs);
  if (shift <= 0) return 0;
  for (const b of upcoming) b.spawnAtMs -= shift;
  return shift;
}

/**
 * Builds a game: distinct words, levels by stage (A2-B1 first, B2 last),
 * every kind five times. Returns fewer blocks only when the pool is too small.
 */
export function buildBlasterRound(
  pool: readonly ArenaWord[],
  rng: () => number,
  mode: BlasterMode,
  count = BLASTER_BLOCKS,
): BlasterBlock[] {
  const all = pool.filter(isDuelWord);
  // Words that suit the mode: a gap needs a few letters, a hint a short meaning.
  const words = all.filter((w) =>
    mode === 'missing'
      ? w.displayWord.trim().length >= 4
      : mode === 'en_to_vi'
        ? mainSense(w.meaningVi).length <= MAX_HINT_LENGTH
        : true,
  );
  const used = new Set<string>();
  const blocks: BlasterBlock[] = [];
  let at = FIRST_SPAWN_MS;
  let lastLane = -1;
  for (let i = 0; i < count; i += 1) {
    const levels = stageLevels(i, count);
    const lo = Math.min(...levels);
    const hi = Math.max(...levels);
    const fresh = words.filter((w) => !used.has(w.headword.toLowerCase()));
    const tiers = [
      fresh.filter((w) => w.level !== null && w.level >= lo && w.level <= hi),
      fresh.filter(
        (w) => w.level === null || (w.level >= lo - 1 && w.level <= hi + 1),
      ),
      fresh,
    ];
    const candidates = tiers.find((t) => t.length > 0);
    if (!candidates) break;
    const word = candidates[Math.floor(rng() * candidates.length)];
    used.add(word.headword.toLowerCase());

    const kind = mode;
    const display = word.displayWord.trim();
    const english = normalizeAnswer(display);
    let prompt = display;
    let answers = [english];
    if (kind === 'missing') prompt = missingLetters(display, rng);
    if (kind === 'vi_to_en') {
      prompt = word.meaningVi.trim();
      // A synonym in the decks is right too ("bảo mật": security, confidential).
      answers = [
        ...new Set(
          all
            .filter(
              (w) => w === word || meaningsClash(w.meaningVi, word.meaningVi),
            )
            .map((w) => normalizeAnswer(w.displayWord)),
        ),
      ];
    }
    let hint: string | null = null;
    // Owner 2026-11-08: both meaning modes hint the letters of the answer.
    if (kind === 'vi_to_en') hint = letterHint(display);
    if (kind === 'en_to_vi') {
      answers = acceptedMeanings(word.meaningVi);
      hint = letterHint(mainSense(word.meaningVi));
    }

    const { gapMs, speed } = blasterTiming(i, count);
    const paired = i > 0 && pairsWithPrevious(i, count);
    if (i > 0) at += paired ? PAIR_GAP_MS : gapMs;
    // Two blocks falling together keep a lane between them, so they never overlap.
    const lanes = LANES.map((_, k) => k).filter((k) =>
      paired ? Math.abs(k - lastLane) >= 2 : k !== lastLane,
    );
    const lane = lanes[Math.floor(rng() * lanes.length)];
    lastLane = lane;
    blocks.push({
      id: i + 1,
      kind,
      prompt,
      answers,
      spawnAtMs: at,
      fallMs: Math.round(BASE_FALL_MS[kind] / speed),
      lane: LANES[lane],
      hint,
      word: { id: word.id, displayWord: display, meaningVi: word.meaningVi },
    });
  }
  return blocks;
}

/** When a block touches the cannon line. */
export const landsAt = (b: Pick<BlasterBlock, 'spawnAtMs' | 'fallMs'>) =>
  b.spawnAtMs + b.fallMs;

export type BlasterState = {
  destroyed: number;
  landed: number;
  livesLeft: number;
  over: boolean;
  outcome: 'win' | 'lose' | null;
  /** When the game ended (the third landing, or the last block gone). */
  endedAtMs: number | null;
};

/** The game at `nowMs`, from the blocks and the server times of the hits. */
export function resolve(
  blocks: BlasterBlock[],
  hits: Record<number, number>,
  nowMs: number,
): BlasterState {
  const events = blocks
    .map((b) =>
      hits[b.id] !== undefined
        ? { at: hits[b.id], hit: true }
        : nowMs > landsAt(b) + LANDING_GRACE_MS
          ? { at: landsAt(b), hit: false }
          : null,
    )
    .filter((e): e is { at: number; hit: boolean } => e !== null)
    .sort((a, b) => a.at - b.at);
  let destroyed = 0;
  let landed = 0;
  for (const e of events) {
    if (e.hit) destroyed += 1;
    else landed += 1;
    if (landed >= BLASTER_LIVES) {
      return {
        destroyed,
        landed,
        livesLeft: 0,
        over: true,
        outcome: 'lose',
        endedAtMs: e.at,
      };
    }
  }
  const done = destroyed + landed === blocks.length;
  return {
    destroyed,
    landed,
    livesLeft: BLASTER_LIVES - landed,
    over: done,
    outcome: done ? 'win' : null,
    endedAtMs: done && events.length ? events[events.length - 1].at : null,
  };
}

/**
 * The block a typed answer breaks at `nowMs`: one on screen (spawned, not
 * landed beyond the grace, not hit) whose answers hold the text; the one
 * closest to landing when several do. Null when the game is over.
 */
export function matchShot(
  blocks: BlasterBlock[],
  hits: Record<number, number>,
  text: string,
  nowMs: number,
): number | null {
  if (resolve(blocks, hits, nowMs).over) return null;
  const typed = normalizeAnswer(text);
  if (!typed) return null;
  const target = blocks
    .filter(
      (b) =>
        hits[b.id] === undefined &&
        b.spawnAtMs <= nowMs &&
        nowMs <= landsAt(b) + LANDING_GRACE_MS &&
        b.answers.includes(typed),
    )
    .sort((a, b) => landsAt(a) - landsAt(b))[0];
  return target ? target.id : null;
}

/** When every block has landed for sure: the server settles an abandoned game then. */
export function blasterDeadline(blocks: BlasterBlock[]): number {
  return Math.max(0, ...blocks.map(landsAt)) + LANDING_GRACE_MS + 2000;
}

/** Bánh Mì back on a win: the stake (outside the daily cap) and half of it as a bonus (inside). */
export function blasterPayout(stake: number, outcome: 'win' | 'lose') {
  return outcome === 'win'
    ? { returned: stake, bonus: Math.floor(stake / 2) }
    : { returned: 0, bonus: 0 };
}

/** XP: 2 per block broken, inside the Arena's 150 XP a day. */
export function blasterXp(destroyed: number, earnedToday: number): number {
  return Math.max(
    0,
    Math.min(
      destroyed * BLASTER_XP_PER_BLOCK,
      ARENA_XP_DAILY_CAP - earnedToday,
    ),
  );
}
