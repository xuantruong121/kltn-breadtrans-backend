/**
 * "Dịch câu" (owner 2026-11-14): the learner translates one Vietnamese
 * sentence into English. Pure: no Prisma, no I/O.
 *
 * Checking follows the accepted-answer approach (Duolingo-style): the answer
 * is normalised (case, punctuation, curly quotes, contractions, numbers) and
 * compared with the authored accepted translations. Only an answer that
 * matches none of them goes to the AI grader.
 */
import {
  joinThousandsSeparators,
  normalizeNumberTokens,
} from '../quiz/listening-number-words';

export const SENTENCE_TRANSLATION = 'SENTENCE_TRANSLATION';
export const SENTENCE_TRANSLATION_MAX_SCORE = 2;
export const SENTENCE_TRANSLATION_RUBRIC = 'SENTENCE_TRANSLATION_V1';
/** A sentence answer is short; anything longer is not a translation. */
export const SENTENCE_TRANSLATION_MAX_CHARS = 400;

export type TranslationHint = { vi: string; en: string };

export type SentenceTranslationTask = {
  prompt: string;
  acceptedAnswers: string[];
  hints: TranslationHint[];
  grammarTip: string;
};

/** Reads a stored task; null when the content is not a usable translation task. */
export function translationTaskOf(
  content: unknown,
): SentenceTranslationTask | null {
  if (!content || typeof content !== 'object') return null;
  const c = content as Record<string, unknown>;
  if (c.taskType !== SENTENCE_TRANSLATION) return null;
  const prompt = typeof c.prompt === 'string' ? c.prompt.trim() : '';
  const acceptedAnswers = Array.isArray(c.acceptedAnswers)
    ? c.acceptedAnswers
        .filter((a): a is string => typeof a === 'string')
        .map((a) => a.trim())
        .filter(Boolean)
    : [];
  if (!prompt || acceptedAnswers.length === 0) return null;
  const hints = Array.isArray(c.hints)
    ? c.hints.flatMap((h) => {
        const vi = (h as TranslationHint)?.vi;
        const en = (h as TranslationHint)?.en;
        return typeof vi === 'string' && typeof en === 'string'
          ? [{ vi: vi.trim(), en: en.trim() }]
          : [];
      })
    : [];
  return {
    prompt,
    acceptedAnswers,
    hints,
    grammarTip: typeof c.grammarTip === 'string' ? c.grammarTip.trim() : '',
  };
}

// Only unambiguous contractions. "its" is a possessive here, never "it is".
const CONTRACTIONS: Record<string, string[]> = {
  "i'm": ['i', 'am'],
  "you're": ['you', 'are'],
  "we're": ['we', 'are'],
  "they're": ['they', 'are'],
  "i've": ['i', 'have'],
  "you've": ['you', 'have'],
  "we've": ['we', 'have'],
  "they've": ['they', 'have'],
  "i'll": ['i', 'will'],
  "you'll": ['you', 'will'],
  "he'll": ['he', 'will'],
  "she'll": ['she', 'will'],
  "it'll": ['it', 'will'],
  "we'll": ['we', 'will'],
  "they'll": ['they', 'will'],
  "can't": ['can', 'not'],
  cannot: ['can', 'not'],
  "won't": ['will', 'not'],
  "don't": ['do', 'not'],
  "doesn't": ['does', 'not'],
  "didn't": ['did', 'not'],
  "isn't": ['is', 'not'],
  "aren't": ['are', 'not'],
  "wasn't": ['was', 'not'],
  "weren't": ['were', 'not'],
  "hasn't": ['has', 'not'],
  "haven't": ['have', 'not'],
  "hadn't": ['had', 'not'],
  "shouldn't": ['should', 'not'],
  "wouldn't": ['would', 'not'],
  "couldn't": ['could', 'not'],
  "let's": ['let', 'us'],
};

// "he's" is "he is" or "he has"; "he's gone" is clearly "has", "he's tired"
// is "is", and "he's worked" could be either, so matching tries both.
const IS_OR_HAS: Record<string, string> = {
  "he's": 'he',
  "she's": 'she',
  "it's": 'it',
  "that's": 'that',
  "there's": 'there',
  "what's": 'what',
  "where's": 'where',
};

const CLEAR_PARTICIPLES = new Set([
  'been',
  'gone',
  'done',
  'seen',
  'had',
  'made',
  'left',
  'got',
  'taken',
  'eaten',
  'written',
]);

function tokenize(value: unknown): string[] {
  return joinThousandsSeparators(String(value ?? ''))
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[’‘ʼ`]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .replace(/(?<![\p{L}\p{N}])'+|'+(?![\p{L}\p{N}])/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Every reading of the sentence as lower-case tokens, contractions written
 * out and numbers as digits. One reading unless an "'s" contraction could be
 * "is" or "has" (at most 16 readings).
 */
export function englishSentenceReadings(value: unknown): string[][] {
  const raw = tokenize(value);
  let readings: string[][] = [[]];
  let ambiguous = 0;
  raw.forEach((token, i) => {
    const direct = CONTRACTIONS[token];
    const subject = IS_OR_HAS[token];
    if (direct) readings = readings.map((r) => [...r, ...direct]);
    else if (!subject) readings = readings.map((r) => [...r, token]);
    else if (CLEAR_PARTICIPLES.has(raw[i + 1]))
      readings = readings.map((r) => [...r, subject, 'has']);
    else if (ambiguous < 4 && /(?:ed|en)$/.test(raw[i + 1] ?? '')) {
      ambiguous += 1;
      readings = readings.flatMap((r) => [
        [...r, subject, 'is'],
        [...r, subject, 'has'],
      ]);
    } else readings = readings.map((r) => [...r, subject, 'is']);
  });
  return readings.map((r) => normalizeNumberTokens(r));
}

/** The first reading: "'s" as "is" unless a clear past participle follows. */
export function normalizeEnglishSentence(value: unknown): string[] {
  return englishSentenceReadings(value)[0];
}

// Small words whose one-letter change is a grammar error, never a typo.
const NEVER_TYPO = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'am',
  'was',
  'were',
  'be',
  'he',
  'she',
  'his',
  'her',
  'this',
  'that',
  'these',
  'those',
  'than',
  'then',
  'there',
  'their',
  'in',
  'on',
  'at',
  'to',
  'of',
  'for',
  'do',
  'does',
  'did',
  'has',
  'have',
  'had',
]);

/** Optimal string alignment distance (adjacent swaps count as one edit). */
function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) =>
      i === 0 ? j : j === 0 ? i : 0,
    ),
  );
  for (let i = 1; i <= a.length; i += 1)
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

/** A one-letter slip in a longer content word, not a grammar change. */
function isTypo(
  learner: string,
  reference: string,
  referenceWords: Set<string>,
) {
  if (learner.length < 4 || reference.length < 4) return false;
  if (NEVER_TYPO.has(learner) || NEVER_TYPO.has(reference)) return false;
  // Another word of the sentence, or a plural / third-person -s, is grammar.
  if (referenceWords.has(learner)) return false;
  if (learner === `${reference}s` || reference === `${learner}s`) return false;
  if (/\d/.test(learner) || /\d/.test(reference)) return false;
  return editDistance(learner, reference) === 1;
}

export type TranslationMatch =
  | { kind: 'EXACT'; matched: string }
  | { kind: 'TYPO'; matched: string; typed: string; expected: string }
  | { kind: 'NONE' };

/**
 * Compares the answer with every accepted translation: an exact match after
 * normalisation, else exactly one word off by one letter (a typo).
 */
export function matchTranslation(
  answer: string,
  accepted: string[],
): TranslationMatch {
  const readings = englishSentenceReadings(answer);
  if (readings[0].length === 0) return { kind: 'NONE' };
  const pairs = accepted.flatMap((candidate) =>
    englishSentenceReadings(candidate).flatMap((ref) =>
      readings.map((tokens) => ({ candidate, ref, tokens })),
    ),
  );
  for (const { candidate, ref, tokens } of pairs)
    if (ref.length === tokens.length && ref.every((t, i) => t === tokens[i]))
      return { kind: 'EXACT', matched: candidate };
  for (const { candidate, ref, tokens } of pairs) {
    if (ref.length !== tokens.length) continue;
    const diffs = ref.flatMap((t, i) => (t === tokens[i] ? [] : [i]));
    if (diffs.length !== 1) continue;
    const i = diffs[0];
    if (isTypo(tokens[i], ref[i], new Set(ref)))
      return {
        kind: 'TYPO',
        matched: candidate,
        typed: tokens[i],
        expected: ref[i],
      };
  }
  return { kind: 'NONE' };
}

function lcsTable(a: string[], b: string[]): number[][] {
  const t = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1)
    for (let j = b.length - 1; j >= 0; j -= 1)
      t[i][j] =
        a[i] === b[j]
          ? t[i + 1][j + 1] + 1
          : Math.max(t[i + 1][j], t[i][j + 1]);
  return t;
}

/** The accepted translation sharing the most words, in order, with the answer. */
export function closestAnswer(answer: string, accepted: string[]): string {
  const tokens = normalizeEnglishSentence(answer);
  let best = accepted[0] ?? '';
  let bestScore = -1;
  for (const candidate of accepted) {
    const ref = normalizeEnglishSentence(candidate);
    const common = lcsTable(tokens, ref)[0][0];
    const score = common / Math.max(tokens.length, ref.length, 1);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

export type DiffWord = { text: string; ok: boolean };

const wordKey = (w: string) =>
  w
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[’‘ʼ`]/g, "'")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

/**
 * Word-by-word comparison of two sentences as written: each word of either
 * side is marked ok when it is part of their longest common sequence.
 */
export function diffWords(
  answer: string,
  reference: string,
): { answer: DiffWord[]; reference: DiffWord[] } {
  const a = answer.trim().split(/\s+/).filter(Boolean);
  const b = reference.trim().split(/\s+/).filter(Boolean);
  const ka = a.map(wordKey);
  const kb = b.map(wordKey);
  const t = lcsTable(ka, kb);
  const okA = new Array<boolean>(a.length).fill(false);
  const okB = new Array<boolean>(b.length).fill(false);
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (ka[i] === kb[j]) {
      okA[i] = okB[j] = true;
      i += 1;
      j += 1;
    } else if (t[i + 1][j] >= t[i][j + 1]) i += 1;
    else j += 1;
  }
  return {
    answer: a.map((text, k) => ({ text, ok: okA[k] })),
    reference: b.map((text, k) => ({ text, ok: okB[k] })),
  };
}

const VIETNAMESE =
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

/** Authoring checks before a translation exercise is published or seeded. */
export function translationTaskIssues(content: unknown): string[] {
  const task = translationTaskOf(content);
  if (!task) return ['not a translation task with a prompt and answers'];
  const issues: string[] = [];
  if (!VIETNAMESE.test(task.prompt))
    issues.push('prompt is not Vietnamese with diacritics');
  if (task.acceptedAnswers.length < 2)
    issues.push('fewer than 2 accepted answers');
  for (const a of task.acceptedAnswers) {
    if (VIETNAMESE.test(a)) issues.push(`answer has Vietnamese letters: ${a}`);
    if (matchTranslation(a, task.acceptedAnswers).kind !== 'EXACT')
      issues.push(`answer does not match itself: ${a}`);
  }
  if (task.hints.length === 0) issues.push('no hints');
  if (!task.grammarTip) issues.push('no grammar tip');
  return issues;
}
