/**
 * What a Listening master says and in what order. Pure, so the script that
 * built exam 1 and the build that runs on publish share one source.
 */
import { escapeXml } from '../../quiz/listening-audio-authoring.service';

/** Seconds of silence the learner gets to answer, after the clip ends. */
export const RESPONSE_GAP: Record<number, number> = { 1: 5, 2: 5, 3: 8, 4: 8 };
/**
 * Original BreadTrans narration. Written for this product; it follows the
 * usual shape of a standardized listening section (an introduction, then one
 * direction per Part) without reproducing any official test's wording.
 */
export const NARRATION = {
  // Short sentences (owner 2026-10-30): no brand name in the audio; the four
  // parts named as they are; no "A, B, C, or D" here because Part 2 has only
  // three choices (each Part's directions give its own letters). The
  // "not an official TOEIC test" line stays (docs/toeic-product-contract.md).
  intro:
    'Welcome to the TOEIC Listening practice test. This is a practice test, not an official TOEIC test. ' +
    'The Listening section has four parts: photographs, questions and responses, conversations, and talks. ' +
    'There are one hundred questions, and the section takes about forty-five minutes. Choose the best answer to each question. Listen carefully. Part One will begin now.',
  part1:
    'Part One. Photographs. Questions one to six. For each question, look at the photograph on your page. You will hear four short statements about it. The statements are not printed. Choose the statement that best describes what you see.',
  part2:
    'Part Two. Question and response. Questions seven to thirty-one. You will hear a question or a statement, followed by three spoken responses, A, B, and C. Nothing is printed for this part. Choose the response that fits best.',
  part3:
    'Part Three. Conversations. Questions thirty-two to seventy. You will hear short conversations between two or more people. After each conversation, you will hear three questions. The questions and answer choices are printed on your page.',
  part4:
    'Part Four. Talks. Questions seventy-one to one hundred. You will hear short talks by one speaker, such as announcements, messages, or broadcasts. After each talk, you will hear three questions. The questions and answer choices are printed on your page.',
  end: 'This is the end of the Listening section. You may now continue with the Reading section.',
} as const;

/** Pause after a sentence, after a colon, and between answer letters. */
export const NARRATION_BREAKS = { sentence: 200, colon: 350, letter: 300 };

/**
 * Narration text as SSML. The voice spells an all-caps word letter by letter
 * ("T O E I C"), so brand and test names get a pronunciation. The voice's
 * own pauses were about 0.2 s inside lists and "A, B, C, or D", which ran the
 * letters together, so explicit breaks are added.
 */
export function narrationSsml(text: string): string {
  const b = (ms: number) => `<break time="${ms}ms"/>`;
  return (
    escapeXml(text)
      .replace(
        /\bTOEIC\b/g,
        '<phoneme alphabet="ipa" ph="ˈtoʊ.ɪk">TOEIC</phoneme>',
      )
      .replace(/\bBreadTrans\b/g, '<sub alias="Bread Trans">BreadTrans</sub>')
      // "A, B, C, or D" / "A, B, and C": each letter on its own
      .replace(
        /\b([A-D]), (?=(?:and |or )?[A-D]\b)/g,
        `$1,${b(NARRATION_BREAKS.letter)} `,
      )
      .replace(/: /g, `:${b(NARRATION_BREAKS.colon)} `)
      .replace(/([.?!]) (?=\S)/g, `$1${b(NARRATION_BREAKS.sentence)} `)
  );
}

const numberWords = (n: number): string => {
  const ones = [
    'zero',
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
    'eleven',
    'twelve',
    'thirteen',
    'fourteen',
    'fifteen',
    'sixteen',
    'seventeen',
    'eighteen',
    'nineteen',
  ];
  const tens = [
    '',
    '',
    'twenty',
    'thirty',
    'forty',
    'fifty',
    'sixty',
    'seventy',
    'eighty',
    'ninety',
  ];
  if (n === 100) return 'one hundred';
  if (n < 20) return ones[n];
  return tens[Math.floor(n / 10)] + (n % 10 ? `-${ones[n % 10]}` : '');
};

/** The cue read before a group: "Number 7." or "Questions 32 to 34 refer to the following conversation." */
export function cueFor(part: number, numbers: number[]) {
  if (part <= 2) return `Number ${numberWords(numbers[0])}.`;
  const what = part === 3 ? 'conversation' : 'talk';
  return `Questions ${numberWords(numbers[0])} to ${numberWords(numbers[numbers.length - 1])} refer to the following ${what}.`;
}

export type MasterClip = {
  groupId: number;
  part: number;
  questionNumbers: number[];
};

export type MasterTimelineEntry = {
  kind: 'INTRO' | 'DIRECTIONS' | 'GROUP' | 'END';
  part?: number;
  groupId?: number;
  questionNumbers?: number[];
  start: number;
  end: number;
};

export type MasterItem =
  | { kind: 'narration'; id: string }
  | { kind: 'clip'; groupId: number }
  | { kind: 'silence'; seconds: number };

/** Every narrated line, in speaking order, ready for one TTS request. */
export function narrationSegments(clips: MasterClip[]) {
  return [
    { id: 'intro', text: NARRATION.intro },
    ...[1, 2, 3, 4].flatMap((part) => [
      { id: `part${part}`, text: NARRATION[`part${part}` as 'part1'] },
      ...clips
        .filter((clip) => clip.part === part)
        .map((clip) => ({
          id: `cue-${clip.groupId}`,
          text: cueFor(part, clip.questionNumbers),
        })),
    ]),
    { id: 'end', text: NARRATION.end },
  ];
}

/**
 * The order of the recording and where each group lands in it. The lead-in
 * silence is there because a browser starting playback can drop the first
 * 100-300 ms, which once cut the start of "Welcome".
 */
export function planMaster(
  clips: MasterClip[],
  seconds: (
    item: { kind: 'narration'; id: string } | { kind: 'clip'; groupId: number },
  ) => number,
) {
  const items: MasterItem[] = [];
  const timeline: MasterTimelineEntry[] = [];
  let t = 0;
  const round = (value: number) => +value.toFixed(3);
  const silence = (length: number) => {
    items.push({ kind: 'silence', seconds: length });
    t += length;
  };
  const narrate = (
    id: string,
    entry?: Pick<MasterTimelineEntry, 'kind' | 'part'>,
  ) => {
    const length = seconds({ kind: 'narration', id });
    items.push({ kind: 'narration', id });
    if (entry)
      timeline.push({ ...entry, start: round(t), end: round(t + length) });
    t += length;
  };
  silence(1.5);
  narrate('intro', { kind: 'INTRO' });
  timeline[0].start = 0;
  silence(2);
  for (const part of [1, 2, 3, 4]) {
    narrate(`part${part}`, { kind: 'DIRECTIONS', part });
    silence(2);
    for (const clip of clips.filter((item) => item.part === part)) {
      const start = t;
      narrate(`cue-${clip.groupId}`);
      silence(1);
      items.push({ kind: 'clip', groupId: clip.groupId });
      t += seconds({ kind: 'clip', groupId: clip.groupId });
      // Part 3/4 clips read their questions back to back, so the answer time
      // of every question follows the clip.
      silence(
        RESPONSE_GAP[part] * (part >= 3 ? clip.questionNumbers.length : 1),
      );
      timeline.push({
        kind: 'GROUP',
        part,
        groupId: clip.groupId,
        questionNumbers: clip.questionNumbers,
        start: round(start),
        end: round(t),
      });
    }
  }
  narrate('end', { kind: 'END' });
  timeline.sort((a, b) => a.start - b.start);
  return { items, timeline, plannedSeconds: round(t) };
}
