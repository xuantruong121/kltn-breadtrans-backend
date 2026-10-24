import { createHash } from 'crypto';

export const TOEIC_LISTENING_AUDIO_SCRIPT_VERSION = 'toeic-listening-audio-v1';

export type ToeicListeningAudioQuestion = {
  text?: string | null;
  options: unknown;
  correctIndex: number;
};

export type ToeicListeningAudioGroup = {
  part: number;
  canonicalAccent?: string | null;
  transcriptText?: string | null;
  passageText?: string | null;
  questions: ToeicListeningAudioQuestion[];
};

export class ToeicListeningAudioScriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToeicListeningAudioScriptError';
  }
}

const optionLabel = (index: number) => String.fromCharCode(65 + index);

const cleanOptions = (question: ToeicListeningAudioQuestion) =>
  Array.isArray(question.options)
    ? question.options.map((option) =>
        typeof option === 'string' ? option.trim() : '',
      )
    : [];

const assertSingleQuestion = (
  group: ToeicListeningAudioGroup,
  part: number,
) => {
  if (group.questions.length !== 1)
    throw new ToeicListeningAudioScriptError(
      `Part ${part} requires exactly one question per audio group`,
    );
  return group.questions[0];
};

const assertOptions = (
  question: ToeicListeningAudioQuestion,
  expected: number,
  part: number,
) => {
  const options = cleanOptions(question);
  if (options.length !== expected || options.some((option) => !option))
    throw new ToeicListeningAudioScriptError(
      `Part ${part} requires exactly ${expected} non-empty spoken options`,
    );
  if (
    !Number.isInteger(question.correctIndex) ||
    question.correctIndex < 0 ||
    question.correctIndex >= options.length
  )
    throw new ToeicListeningAudioScriptError(
      `Part ${part} requires a valid correct option`,
    );
  return options;
};

const spokenPrompt = (group: ToeicListeningAudioGroup) =>
  (group.transcriptText?.trim() || group.passageText?.trim() || '')
    .replace(/^\s*AUDIO\s+PROMPT\s*:\s*/i, '')
    .trim();

/**
 * Produces the exact original BreadTrans text passed to TTS. Content editors
 * retain their familiar fields; this layer gives those fields unambiguous
 * TOEIC Listening semantics before any provider is called.
 */
export function buildToeicListeningAudioScript(
  group: ToeicListeningAudioGroup,
) {
  if (group.part === 1) {
    const question = assertSingleQuestion(group, 1);
    const statements = assertOptions(question, 4, 1);
    // Spoken output is just the letter label, e.g. "A. <content>" — never a
    // narrated "Statement A"/"Option A" prefix (not authentic TOEIC audio).
    return statements
      .map((statement, index) => `${optionLabel(index)}. ${statement}`)
      .join('\n\n');
  }

  if (group.part === 2) {
    const question = assertSingleQuestion(group, 2);
    const responses = assertOptions(question, 3, 2);
    const prompt = spokenPrompt(group);
    if (!prompt)
      throw new ToeicListeningAudioScriptError(
        'Part 2 requires a spoken prompt before its responses',
      );
    return [
      prompt,
      ...responses.map(
        (response, index) => `${optionLabel(index)}. ${response}`,
      ),
    ].join('\n\n');
  }

  if (group.part === 3 || group.part === 4) {
    const script = spokenPrompt(group);
    if (!script)
      throw new ToeicListeningAudioScriptError(
        `Part ${group.part} requires its dialogue or talk script`,
      );
    if (!group.questions.length)
      throw new ToeicListeningAudioScriptError(
        `Part ${group.part} requires its question prompts to be spoken after the ${group.part === 3 ? 'conversation' : 'talk'}`,
      );
    const prompts = group.questions.map((question) => {
      const text = question.text?.trim();
      if (!text)
        throw new ToeicListeningAudioScriptError(
          `Part ${group.part} requires every question prompt to be spoken after the ${group.part === 3 ? 'conversation' : 'talk'}`,
        );
      return text;
    });
    // Official TOEIC Part 3/4 audio speaks the conversation/talk, then each
    // question prompt in order — never the A/B/C/D answer choices, which
    // stay visual-only (printed in the test book, not narrated).
    return [script, ...prompts].join('\n\n');
  }

  throw new ToeicListeningAudioScriptError(
    `Part ${group.part} is not a Listening audio group`,
  );
}

export function toeicListeningAudioFingerprint(
  group: ToeicListeningAudioGroup,
) {
  const script = buildToeicListeningAudioScript(group);
  const accent =
    group.canonicalAccent?.trim().toUpperCase() === 'UK' ? 'UK' : 'US';
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: TOEIC_LISTENING_AUDIO_SCRIPT_VERSION,
        part: group.part,
        accent,
        script,
      }),
    )
    .digest('hex');
}
