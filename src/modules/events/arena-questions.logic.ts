/**
 * Vocabulary duel: match rhythm, scoring and question building. Pure: the
 * words come in as arguments and randomness through `rng`, so every rule here
 * is unit-tested without a database.
 *
 * Owner decisions 2026-11-08 (after comparing QuizUp 7 x 10 s, Duolingo Duels
 * about 10 questions, Quizlet Live 12): 10 questions of 12 seconds, the last
 * one worth double; three kinds of question, harder as the match goes on;
 * words from the vocabulary decks only.
 */

export const ARENA_ROUNDS = 10;
export const ROUND_SECONDS = 12;
export const FINAL_ROUND_MULTIPLIER = 2;
const BASE_POINTS = 100;
const MAX_SPEED_BONUS = 50;

/** Points for an answer: 100 plus up to 50 for speed, doubled on the last round. */
export function roundPoints(
  isCorrect: boolean,
  elapsedMs: number,
  roundIndex: number,
  totalRounds: number,
): number {
  if (!isCorrect) return 0;
  const windowMs = ROUND_SECONDS * 1000;
  const bonus = Math.min(
    MAX_SPEED_BONUS,
    Math.max(
      0,
      Math.floor(((windowMs - elapsedMs) * MAX_SPEED_BONUS) / windowMs),
    ),
  );
  const multiplier =
    roundIndex === totalRounds - 1 ? FINAL_ROUND_MULTIPLIER : 1;
  return (BASE_POINTS + bonus) * multiplier;
}

/**
 * XP (owner decision 2026-11-08): the Arena counts toward the weekly league
 * like any study. 5 XP per correct answer, whoever wins, so two accounts gain
 * nothing by letting one another win; the doubled last question counts once.
 * At most 150 Arena XP a Vietnam day: a match lasts about 2.5 minutes, an
 * exercise of about 10 minutes pays up to 100 XP.
 */
export const ARENA_XP_PER_CORRECT = 5;
export const ARENA_XP_DAILY_CAP = 150;
export const ARENA_XP_REASON = 'Đấu trường từ vựng';

/** XP for one match, given the Arena XP the learner already has today. */
export function arenaXp(correctAnswers: number, earnedToday: number): number {
  const full = Math.max(0, Math.floor(correctAnswers)) * ARENA_XP_PER_CORRECT;
  return Math.max(0, Math.min(full, ARENA_XP_DAILY_CAP - earnedToday));
}

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight of the current day in Vietnam (UTC+7, no daylight saving). */
export function vietnamDayStart(now: Date): Date {
  const local = now.getTime() + VN_OFFSET_MS;
  return new Date(local - (local % DAY_MS) - VN_OFFSET_MS);
}

export type QuestionKind = 'fill_blank' | 'meaning_to_word' | 'word_to_meaning';

export type ArenaWord = {
  id: number;
  headword: string;
  displayWord: string;
  pos: string;
  meaningVi: string;
  exampleEn: string | null;
  ipa: string | null;
  /** CEFR rank of the easiest deck holding the word (A1 = 1 … C2 = 6), null when unknown. */
  level: number | null;
  /** Ids of the published decks holding the word; empty when unknown. */
  topics?: number[];
};

export type ArenaQuestion = {
  id: number;
  kind: QuestionKind;
  prompt: string;
  ipa: string | null;
  options: string[];
  correctAnswer: string;
  explanation: string;
};

const LEVEL_RANK: Record<string, number> = {
  A1: 1,
  A2: 2,
  B1: 3,
  B2: 4,
  C1: 5,
  C2: 6,
};

export function levelRank(level: string | null | undefined): number | null {
  return level ? (LEVEL_RANK[level.trim().toUpperCase()] ?? null) : null;
}

const POS_VI: Record<string, string> = {
  noun: 'danh từ',
  verb: 'động từ',
  adjective: 'tính từ',
  adverb: 'trạng từ',
  preposition: 'giới từ',
  pronoun: 'đại từ',
  conjunction: 'liên từ',
  phrase: 'cụm từ',
};

const BLANK = '_____';

/** A real word for a duel: one word of letters, at least three of them. */
export function isDuelWord(w: ArenaWord): boolean {
  return (
    /^[a-z][a-z'-]{2,}$/i.test(w.headword.trim()) &&
    w.meaningVi.trim().length > 0
  );
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The example with the word blanked out, or null when it does not contain the word itself. */
export function blankedExample(w: ArenaWord): string | null {
  if (!w.exampleEn) return null;
  const pattern = new RegExp(`\\b${escapeRegExp(w.headword.trim())}\\b`, 'gi');
  if (!pattern.test(w.exampleEn)) return null;
  return w.exampleEn.replace(pattern, BLANK);
}

/** The senses of a meaning ("mở; khai mạc" → ["mở", "khai mạc"]). */
export function senses(meaningVi: string): string[] {
  return meaningVi
    .split(/[;,]/)
    .map((s) => s.trim().toLowerCase().replace(/\s+/g, ' '))
    .filter(Boolean);
}

/**
 * Two meanings clash when they share a sense, or one sense holds the other as
 * whole words ("hóa đơn" in "hóa đơn thanh toán"): both options could be right.
 */
export function meaningsClash(a: string, b: string): boolean {
  const left = senses(a);
  return senses(b).some((x) =>
    left.some(
      (y) => ` ${x} `.includes(` ${y} `) || ` ${y} `.includes(` ${x} `),
    ),
  );
}

/** Fisher–Yates; `rng` returns [0, 1). */
export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Allowed CEFR ranks for a round: the first 30 % A2–B1, the middle B1, the
 * last 30 % B2, widened to B1 and C1 when B2 runs out (for 10 rounds: 1–3,
 * 4–7, 8–10). The decks hold about twice as many B1 words as B2, so a B1–B2
 * range made the last rounds mostly B1.
 */
export function stageLevels(roundIndex: number, count: number): number[] {
  const position = roundIndex / count;
  if (position < 0.3) return [2, 3];
  if (position < 0.7) return [3];
  return [4];
}

/** Kinds for a match: each kind at least count/3 times, in random order. */
export function kindsFor(count: number, rng: () => number): QuestionKind[] {
  const cycle: QuestionKind[] = [
    'fill_blank',
    'meaning_to_word',
    'word_to_meaning',
  ];
  return shuffle(
    Array.from({ length: count }, (_, i) => cycle[i % cycle.length]),
    rng,
  );
}

function fitsKind(w: ArenaWord, kind: QuestionKind): boolean {
  return kind !== 'fill_blank' || blankedExample(w) !== null;
}

/** The easiest-first widening of a stage: exact ranks, ±1, ±2, then any word. */
function widen(levels: number[]): ((w: ArenaWord) => boolean)[] {
  const lo = Math.min(...levels);
  const hi = Math.max(...levels);
  return [
    (w) => w.level !== null && w.level >= lo && w.level <= hi,
    (w) => w.level === null || (w.level >= lo - 1 && w.level <= hi + 1),
    (w) => w.level === null || (w.level >= lo - 2 && w.level <= hi + 2),
    () => true,
  ];
}

/**
 * For the two meaning kinds, words from the target's own deck share its
 * subject (profit: revenue, expense, budget), so the meaning has to be known
 * rather than guessed from the topic. A sentence with a blank is left out: a
 * word from the same deck could fit it too.
 */
function sharesDeck(a: ArenaWord, b: ArenaWord): boolean {
  return (a.topics ?? []).some((t) => (b.topics ?? []).includes(t));
}

/**
 * How hard a distractor is to rule out: the prompt names the part of speech,
 * so a different one gives the answer away and counts most; the same deck
 * comes next (meaning kinds only).
 */
function closeness(
  w: ArenaWord,
  target: ArenaWord,
  kind: QuestionKind,
): number {
  const deck = kind !== 'fill_blank' && sharesDeck(w, target) ? 1 : 0;
  return (w.pos === target.pos ? 2 : 0) + deck;
}

/** Distractors from the target's own level are harder to rule out. */
function levelGap(a: ArenaWord, b: ArenaWord): number {
  return a.level === null || b.level === null ? 2 : Math.abs(a.level - b.level);
}

function optionText(w: ArenaWord, kind: QuestionKind): string {
  return kind === 'word_to_meaning' ? w.meaningVi.trim() : w.displayWord.trim();
}

/**
 * Builds up to `count` questions. Each round gets its own three distractors
 * from the whole pool: never a target of this match (so earlier answers
 * cannot be eliminated), from the target's deck for the meaning kinds, the
 * same part of speech when there are enough, and
 * no option sharing a sense with another. Returns fewer questions only when
 * the pool is too small; the caller then falls back.
 */
export function buildArenaQuestions(
  pool: readonly ArenaWord[],
  count: number,
  rng: () => number,
): ArenaQuestion[] {
  const words = pool.filter(isDuelWord);
  const kinds = kindsFor(count, rng);

  // 1. Targets, round by round, distinct headwords.
  const usedHeadwords = new Set<string>();
  const targets: { word: ArenaWord; kind: QuestionKind }[] = [];
  for (let round = 0; round < count; round += 1) {
    let kind = kinds[round];
    let picked: ArenaWord | undefined;
    // No word left for this kind (e.g. no usable example): any other kind.
    const tryKinds = [kind, ...kindsFor(3, rng).filter((k) => k !== kind)];
    search: for (const accepts of widen(stageLevels(round, count))) {
      for (const k of tryKinds) {
        const candidates = words.filter(
          (w) =>
            accepts(w) &&
            fitsKind(w, k) &&
            !usedHeadwords.has(w.headword.toLowerCase()),
        );
        if (candidates.length) {
          picked = candidates[Math.floor(rng() * candidates.length)];
          kind = k;
          break search;
        }
      }
    }
    if (!picked) continue;
    usedHeadwords.add(picked.headword.toLowerCase());
    targets.push({ word: picked, kind });
  }

  // 2. Distractors, preferring words used least so far.
  const usage = new Map<number, number>();
  const questions: ArenaQuestion[] = [];
  for (const { word, kind } of targets) {
    const others = shuffle(
      words.filter((w) => !usedHeadwords.has(w.headword.toLowerCase())),
      rng,
    ).sort(
      (a, b) =>
        closeness(b, word, kind) - closeness(a, word, kind) ||
        levelGap(a, word) - levelGap(b, word) ||
        (usage.get(a.id) ?? 0) - (usage.get(b.id) ?? 0),
    );
    const chosen: ArenaWord[] = [];
    const texts = new Set([optionText(word, kind).toLowerCase()]);
    for (const w of others) {
      if (chosen.length === 3) break;
      const text = optionText(w, kind).toLowerCase();
      if (texts.has(text)) continue;
      if (meaningsClash(w.meaningVi, word.meaningVi)) continue;
      if (chosen.some((c) => meaningsClash(c.meaningVi, w.meaningVi))) continue;
      chosen.push(w);
      texts.add(text);
    }
    if (chosen.length < 3) continue;
    for (const w of chosen) usage.set(w.id, (usage.get(w.id) ?? 0) + 1);

    const correctAnswer = optionText(word, kind);
    const pos = POS_VI[word.pos] ?? word.pos;
    const prompt =
      kind === 'fill_blank'
        ? blankedExample(word)!
        : kind === 'meaning_to_word'
          ? `Từ nào có nghĩa là “${word.meaningVi.trim()}” (${pos})?`
          : `Nghĩa của “${word.displayWord.trim()}” (${pos}) là gì?`;
    questions.push({
      id: word.id,
      kind,
      prompt,
      // The pronunciation would give the answer away when the answer is the word.
      ipa:
        kind === 'word_to_meaning' && word.ipa
          ? word.ipa.replace(/^\/+|\/+$/g, '')
          : null,
      options: shuffle(
        [correctAnswer, ...chosen.map((w) => optionText(w, kind))],
        rng,
      ),
      correctAnswer,
      explanation: [
        `${word.displayWord.trim()}: ${word.meaningVi.trim()}.`,
        word.exampleEn?.trim(),
      ]
        .filter(Boolean)
        .join(' '),
    });
  }
  return questions;
}
