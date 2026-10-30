/**
 * How long a Part 3 conversation or Part 4 talk must be. On the real test a
 * conversation runs about 30–45 s and a talk 40–60 s; at the narration rate
 * (~150 words a minute) that is the word range below. Without it the
 * generator wrote 35-word dialogues and a 33-minute Listening section
 * (owner report 2026-10-30). The script is the spoken dialogue or talk only;
 * the question prompts read after it are not counted.
 */
export const LISTENING_SCRIPT_WORDS = {
  3: { min: 85, max: 160 },
  4: { min: 100, max: 180 },
} as const;

type LengthPart = keyof typeof LISTENING_SCRIPT_WORDS;

const isLengthPart = (part: number): part is LengthPart =>
  part === 3 || part === 4;

/** Words actually spoken: speaker labels such as "M:" or "Woman 2:" are not. */
export function spokenWordCount(script: string): number {
  return script
    .replace(/(^|\s)[A-Z][A-Za-z]*(?: ?\d)?:(?=\s)/g, ' ')
    .split(/\s+/)
    .filter((token) => /[A-Za-z0-9]/.test(token)).length;
}

/** Null when the script fits its Part, otherwise a Vietnamese reason. */
export function listeningScriptLengthIssue(
  part: number,
  script: string | null | undefined,
): string | null {
  if (!isLengthPart(part)) return null;
  const { min, max } = LISTENING_SCRIPT_WORDS[part];
  const words = spokenWordCount(script ?? '');
  const what = part === 3 ? 'Hội thoại' : 'Bài nói';
  if (words < min)
    return `${what} Part ${part} quá ngắn (${words} từ, cần ${min}–${max})`;
  if (words > max)
    return `${what} Part ${part} quá dài (${words} từ, cần ${min}–${max})`;
  return null;
}

/** The length rule as given to the generator. */
export function listeningScriptLengthRule(part: number): string {
  if (!isLengthPart(part)) return '';
  const { min, max } = LISTENING_SCRIPT_WORDS[part];
  return part === 3
    ? `Each conversation is ${min}-${max} spoken words (about 30-45 seconds), 6-10 speaker turns between two or three people, labelled "M:", "W:" or "M2:" / "W2:".`
    : `Each talk is ${min}-${max} spoken words (about 40-60 seconds) by one speaker: an announcement, voicemail, broadcast, tour, meeting excerpt or advertisement.`;
}
