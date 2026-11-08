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

/** Two meanings clash when they share a sense: both options would be right. */
export function meaningsClash(a: string, b: string): boolean {
  const left = new Set(senses(a));
  return senses(b).some((s) => left.has(s));
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
 * last 30 % B1–B2 (for 10 rounds: 1–3, 4–7, 8–10).
 */
export function stageLevels(roundIndex: number, count: number): number[] {
  const position = roundIndex / count;
  if (position < 0.3) return [2, 3];
  if (position < 0.7) return [3];
  return [3, 4];
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

function optionText(w: ArenaWord, kind: QuestionKind): string {
  return kind === 'word_to_meaning' ? w.meaningVi.trim() : w.displayWord.trim();
}

/**
 * Builds up to `count` questions. Each round gets its own three distractors
 * from the whole pool: never a target of this match (so earlier answers
 * cannot be eliminated), the same part of speech when there are enough, and
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
        Number(b.pos === word.pos) - Number(a.pos === word.pos) ||
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
