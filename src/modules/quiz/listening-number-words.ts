/**
 * Numbers in a dictation answer (owner 2026-11-13: "nine to eleven" typed as
 * "9 to 11" must count). Every way of writing a number becomes digits, on the
 * expected sentence and on the learner's answer alike, so the two compare equal:
 * "twenty five" and "25" both become "25", "second" and "2nd" both "2nd".
 *
 * Pure: tokens in (lower case, punctuation already removed, hyphens already
 * split), tokens out. Only runs that read as one number are joined:
 * "eight forty five" stays "8 45", which is how "8:45" tokenises.
 *
 * The frontend keeps an identical copy in
 * src/components/listening/dictationNumberWords.ts; change both together.
 */

const UNITS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
};
const TEENS: Record<string, number> = {
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
const SCALES: Record<string, number> = { thousand: 1_000, million: 1_000_000 };

/** Ordinal words and the cardinal they stand for. */
const ORDINALS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  eleventh: 11,
  twelfth: 12,
  thirteenth: 13,
  fourteenth: 14,
  fifteenth: 15,
  sixteenth: 16,
  seventeenth: 17,
  eighteenth: 18,
  nineteenth: 19,
  twentieth: 20,
  thirtieth: 30,
  fortieth: 40,
  fiftieth: 50,
  sixtieth: 60,
  seventieth: 70,
  eightieth: 80,
  ninetieth: 90,
  hundredth: 100,
  thousandth: 1_000,
  millionth: 1_000_000,
};

type Last = 'none' | 'unit' | 'teen' | 'tens' | 'hundred' | 'scale';

const isNumberWord = (w: string | undefined) =>
  w !== undefined && (w in UNITS || w in TEENS || w in TENS || w in ORDINALS);

function ordinalSuffix(n: number): string {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
}

/** The number that starts at `start`, as digits, and the index after it; null when none does. */
function readNumber(
  tokens: string[],
  start: number,
): { text: string; next: number } | null {
  let total = 0;
  let current = 0;
  let last: Last = 'none';
  let lastScale = Infinity;
  let read = 0;
  let j = start;

  // "a hundred", "a thousand": the article stands for one.
  if (
    tokens[j] === 'a' &&
    (tokens[j + 1] === 'hundred' || tokens[j + 1] in SCALES)
  ) {
    current = 1;
    last = 'unit';
    j += 1;
  }

  while (j < tokens.length) {
    const w = tokens[j];
    if (w in UNITS) {
      const v = UNITS[w];
      if (v === 0 && last !== 'none') break;
      if (last === 'unit' || last === 'teen') break;
      current += v;
      last = 'unit';
    } else if (w in TEENS || w in TENS) {
      if (last !== 'none' && last !== 'hundred' && last !== 'scale') break;
      current += w in TEENS ? TEENS[w] : TENS[w];
      last = w in TEENS ? 'teen' : 'tens';
    } else if (w === 'hundred') {
      if ((last !== 'unit' && last !== 'teen') || current % 100 === 0) break;
      current = Math.floor(current / 100) * 100 + (current % 100) * 100;
      last = 'hundred';
    } else if (w in SCALES) {
      const scale = SCALES[w];
      if (last === 'none' || last === 'scale' || current === 0) break;
      if (scale >= lastScale) break;
      total += current * scale;
      current = 0;
      lastScale = scale;
      last = 'scale';
    } else if (w === 'and') {
      if (
        (last !== 'hundred' && last !== 'scale') ||
        !isNumberWord(tokens[j + 1])
      ) {
        break;
      }
      j += 1;
      continue;
    } else if (w in ORDINALS) {
      const v = ORDINALS[w];
      let value: number | null = null;
      if (
        v < 10 &&
        (last === 'none' ||
          last === 'tens' ||
          last === 'hundred' ||
          last === 'scale')
      ) {
        value = total + current + v;
      } else if (
        v >= 10 &&
        v < 100 &&
        (last === 'none' || last === 'hundred' || last === 'scale')
      ) {
        value = total + current + v;
      } else if (
        v === 100 &&
        (last === 'unit' || last === 'teen') &&
        current % 100 !== 0
      ) {
        value = total + current * 100;
      } else if (
        v >= 1_000 &&
        last !== 'none' &&
        last !== 'scale' &&
        current > 0
      ) {
        value = total + current * v;
      }
      if (value === null) break;
      return { text: `${value}${ordinalSuffix(value)}`, next: j + 1 };
    } else {
      break;
    }
    read += 1;
    j += 1;
  }

  if (read === 0) return null;
  return { text: String(total + current), next: j };
}

/** Number words in a token list become digits: ["nine","to","eleven"] → ["9","to","11"]. */
export function normalizeNumberTokens(tokens: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const found = readNumber(tokens, i);
    if (found) {
      out.push(found.text);
      i = found.next;
    } else {
      out.push(tokens[i]);
      i += 1;
    }
  }
  return out;
}

/** "1,000" → "1000" before punctuation is stripped, so a thousands comma does not split a number. */
export function joinThousandsSeparators(text: string): string {
  return text.replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
}

/** A word of the sentence as the learner should read it: "passage?" → "passage". */
export function bareWord(token: string | undefined): string {
  return (token ?? '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/** Whether a normalised token may be part of a number spread over several words. */
export function startsNumberGroup(token: string | undefined): boolean {
  return token !== undefined && (token === 'a' || /^\d/.test(token));
}
