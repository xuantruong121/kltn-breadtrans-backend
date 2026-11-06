/**
 * Which Azure neural voice reads each speaker of a TOEIC Listening script.
 *
 * Voices used to be handed out by order of appearance (female, male, female,
 * male), so a conversation that opened with "M:" gave the man a female voice
 * and the woman a male one. A label now picks a voice of its own gender:
 * M, Man, M1, Man 2 read male; W, Woman, W1, Woman 2 read female. Any other
 * label (Narrator, a name) takes the first voice not yet used, in the old
 * order, so the question prompts after a two-person dialogue keep the voice
 * they had before and a dialogue opening with "W:" sounds exactly as it did.
 */
export const LISTENING_VOICE_ORDER = [
  'en-US-JennyNeural',
  'en-US-GuyNeural',
  'en-US-AriaNeural',
  'en-US-DavisNeural',
] as const;

const FEMALE = ['en-US-JennyNeural', 'en-US-AriaNeural'];
const MALE = ['en-US-GuyNeural', 'en-US-DavisNeural'];

export function speakerGender(label: string): 'female' | 'male' | null {
  const name = label.trim();
  if (/^(?:W|Woman)(?: ?\d)?$/i.test(name)) return 'female';
  if (/^(?:M|Man)(?: ?\d)?$/i.test(name)) return 'male';
  return null;
}

/** Speaker labels in order of appearance -> voice per label. */
export function assignListeningVoices(speakers: string[]): Map<string, string> {
  const voices = new Map<string, string>();
  const used = () => new Set(voices.values());
  for (const speaker of speakers) {
    if (voices.has(speaker)) continue;
    const gender = speakerGender(speaker);
    const pool =
      gender === 'female'
        ? FEMALE
        : gender === 'male'
          ? MALE
          : [...LISTENING_VOICE_ORDER];
    const taken = used();
    const free = pool.find((voice) => !taken.has(voice));
    // More speakers of one gender than voices: reuse that gender's voices in turn.
    const sameGender = [...voices.keys()].filter(
      (s) => speakerGender(s) === gender,
    ).length;
    voices.set(speaker, free ?? pool[sameGender % pool.length]);
  }
  return voices;
}
