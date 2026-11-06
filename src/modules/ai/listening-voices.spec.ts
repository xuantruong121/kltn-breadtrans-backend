import { assignListeningVoices, speakerGender } from './listening-voices';
import { buildToeicListeningSsml } from './ai.service';

const JENNY = 'en-US-JennyNeural';
const GUY = 'en-US-GuyNeural';
const ARIA = 'en-US-AriaNeural';
const DAVIS = 'en-US-DavisNeural';

describe('TOEIC Listening voices by speaker gender', () => {
  it('reads labels as genders', () => {
    expect(['W', 'Woman', 'W1', 'W2', 'Woman 2'].map(speakerGender)).toEqual(
      Array(5).fill('female'),
    );
    expect(['M', 'Man', 'M1', 'M2', 'Man 1'].map(speakerGender)).toEqual(
      Array(5).fill('male'),
    );
    expect(['Narrator', 'Sarah', 'Speaker'].map(speakerGender)).toEqual([
      null,
      null,
      null,
    ]);
  });

  // The bug: a dialogue opening with "M:" gave the man Jenny and the woman Guy.
  it('gives the man a male voice when he speaks first', () => {
    const voices = assignListeningVoices(['M', 'W', 'M', 'Narrator']);
    expect(voices.get('M')).toBe(GUY);
    expect(voices.get('W')).toBe(JENNY);
    expect(voices.get('Narrator')).toBe(ARIA);
  });

  it('keeps the voices of a dialogue that opens with a woman', () => {
    const voices = assignListeningVoices(['W', 'M', 'Narrator']);
    expect([voices.get('W'), voices.get('M'), voices.get('Narrator')]).toEqual([
      JENNY,
      GUY,
      ARIA,
    ]);
  });

  it('gives three speakers two female voices and one male voice', () => {
    const voices = assignListeningVoices(['W1', 'M', 'W2', 'Narrator']);
    expect([
      voices.get('W1'),
      voices.get('M'),
      voices.get('W2'),
      voices.get('Narrator'),
    ]).toEqual([JENNY, GUY, ARIA, DAVIS]);
    const men = assignListeningVoices(['M1', 'W', 'M2']);
    expect([men.get('M1'), men.get('W'), men.get('M2')]).toEqual([
      GUY,
      JENNY,
      DAVIS,
    ]);
  });

  it('reads an unlabelled talk with the first voice, as before', () => {
    expect(assignListeningVoices(['Narrator']).get('Narrator')).toBe(JENNY);
  });

  it('writes the gendered voices into the SSML', () => {
    const ssml = buildToeicListeningSsml(
      'M: Hello, is this the help desk? W: Yes, how can I help?\n\nWhat is the man calling about?',
    );
    const voices = [...ssml.matchAll(/<voice name="([^"]+)">([^<]*)/g)].map(
      ([, voice, text]) => [voice, text.trim()],
    );
    expect(voices).toEqual([
      [GUY, 'Hello, is this the help desk?'],
      [JENNY, 'Yes, how can I help?'],
      [ARIA, 'What is the man calling about?'],
    ]);
  });
});
