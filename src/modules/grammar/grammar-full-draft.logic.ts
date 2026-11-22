/**
 * "Soạn bằng AI" for a grammar topic: the model's answer is untrusted and is
 * checked here before it reaches the editor. No Prisma, no I/O.
 *
 * QA 2026-11-22: a full draft came back with its theory as one short line of
 * Vietnamese without diacritics ("Hoc va luyen tap ve cau dieu kien loai 2"),
 * and the explanations the same. The theory is now asked for in parts and
 * composed here in the editor's shape, and Vietnamese text with no
 * diacritics at all is refused.
 */

/** Every Vietnamese letter that carries a mark, lower case. */
const VIETNAMESE_MARKED =
  /[àáảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]/;
/** Combining marks, for text that was not composed. */
const COMBINING_MARK = /[̀-̛̣̃̆̉]/;
/** Below this many words a note is too short to judge ("V-ing", "Sai thì"). */
const MIN_WORDS_TO_JUDGE = 4;

export function hasVietnameseDiacritics(text: string): boolean {
  const value = String(text ?? '');
  return (
    VIETNAMESE_MARKED.test(value.normalize('NFC').toLowerCase()) ||
    COMBINING_MARK.test(value.normalize('NFD'))
  );
}

/**
 * True when a text meant to be Vietnamese has no diacritic at all: four or
 * more words and not one marked letter. Real Vietnamese of that length always
 * has one; text written without marks, or in English, does not.
 */
export function lacksVietnameseDiacritics(text: string | null | undefined) {
  const words = String(text ?? '').match(/\p{L}{2,}/gu) ?? [];
  return (
    words.length >= MIN_WORDS_TO_JUDGE &&
    !hasVietnameseDiacritics(String(text ?? ''))
  );
}

export type GrammarTheoryParts = {
  summary?: unknown;
  usage?: unknown;
  form?: unknown;
  examples?: unknown;
  mistakes?: unknown;
};

const clean = (value: unknown, max = 400) =>
  typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, max)
    : '';

const lines = (value: unknown, max = 6) =>
  (Array.isArray(value) ? value : [])
    .map((item) => clean(item))
    .filter(Boolean)
    .slice(0, max);

const exampleLines = (value: unknown) =>
  (Array.isArray(value) ? value : [])
    .map((item) => {
      const row = (item ?? {}) as { en?: unknown; vi?: unknown };
      const en = clean(row.en);
      const vi = clean(row.vi);
      return en ? (vi ? `${en} (${vi})` : en) : '';
    })
    .filter(Boolean)
    .slice(0, 6);

/** The four sections the editor's "Lý thuyết" field holds. */
export const THEORY_HEADINGS = {
  usage: 'Cách dùng',
  form: 'Cấu trúc',
  examples: 'Ví dụ',
  mistakes: 'Lỗi thường gặp',
} as const;

/**
 * The theory as the topic editor and the learner page show it: plain text,
 * one idea per line (no Markdown). The first line is the summary the topic
 * card shows; each section is a heading and "- " lines. Null when a section
 * is missing.
 */
export function composeGrammarTheory(parts: GrammarTheoryParts): string | null {
  const summary = clean(parts.summary, 300);
  const sections: Array<[string, string[]]> = [
    [THEORY_HEADINGS.usage, lines(parts.usage)],
    [THEORY_HEADINGS.form, lines(parts.form)],
    [THEORY_HEADINGS.examples, exampleLines(parts.examples)],
    [THEORY_HEADINGS.mistakes, lines(parts.mistakes)],
  ];
  if (!summary || sections.some(([, rows]) => !rows.length)) return null;
  return [
    summary,
    ...sections.map(
      ([heading, rows]) =>
        `${heading}\n${rows.map((row) => `- ${row}`).join('\n')}`,
    ),
  ].join('\n\n');
}

/** The Vietnamese a learner reads in the theory (the English examples aside). */
export function theoryVietnamese(parts: GrammarTheoryParts): string {
  const examples = (Array.isArray(parts.examples) ? parts.examples : []).map(
    (item) => clean((item as { vi?: unknown } | null)?.vi),
  );
  return [
    clean(parts.summary, 300),
    ...lines(parts.usage),
    ...lines(parts.mistakes),
    ...examples,
  ].join(' ');
}

/** A question whose Vietnamese notes were written without diacritics. */
export function questionLacksDiacritics(question: {
  explanation?: string | null;
  optionExplanations?: unknown;
}): boolean {
  const notes = Array.isArray(question.optionExplanations)
    ? question.optionExplanations.map((note) => String(note ?? ''))
    : [];
  return [question.explanation, ...notes].some(lacksVietnameseDiacritics);
}

/** Raised when the model answered but its draft cannot be used. */
export class GrammarDraftRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GrammarDraftRejected';
  }
}
