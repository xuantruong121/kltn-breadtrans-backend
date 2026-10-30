import {
  mergeListeningContent,
  spokenTextChanged,
} from './listening-question-merge';

const published = {
  text: 'What does the customer order?',
  level: 'A2',
  skill: 'LISTENING',
  accent: 'US',
  options: ['A', 'B', 'C', 'D'],
  correctIndex: 1,
  imageUrl: 'https://cdn/x.png',
  audioText: 'Hello. Coffee, please.',
  explanation: { vi: 'Cũ', evidence: 'Coffee, please.' },
  transcriptSegments: [
    { speaker: 'Mark', text: 'Hello.', voiceKey: 'en-us-male-01' },
    { speaker: 'Sarah', text: 'Coffee, please.', voiceKey: 'en-us-female-01' },
  ],
};

describe('mergeListeningContent', () => {
  it('keeps what the CMS form does not show', () => {
    const merged = mergeListeningContent(published, {
      text: 'What does the customer ask for?',
      prompt: 'What does the customer ask for?',
      options: ['A', 'B', 'C', 'E'],
      correctIndex: 2,
      explanation: 'Mới',
    });
    expect(merged).toMatchObject({
      text: 'What does the customer ask for?',
      level: 'A2',
      skill: 'LISTENING',
      accent: 'US',
      imageUrl: 'https://cdn/x.png',
      audioText: 'Hello. Coffee, please.',
      correctIndex: 2,
      explanation: { vi: 'Mới', evidence: 'Coffee, please.' },
    });
    expect(merged.transcriptSegments).toEqual(published.transcriptSegments);
  });

  it('keeps each speaker voice when the transcript is edited', () => {
    const merged = mergeListeningContent(published, {
      transcriptSegments: [
        { speaker: 'Mark', text: 'Hi there.' },
        {
          speaker: 'Sarah',
          text: 'A coffee, please.',
          translation: 'Một cà phê.',
        },
      ],
    });
    expect(merged.transcriptSegments).toEqual([
      { voiceKey: 'en-us-male-01', speaker: 'Mark', text: 'Hi there.' },
      {
        voiceKey: 'en-us-female-01',
        speaker: 'Sarah',
        text: 'A coffee, please.',
        translation: 'Một cà phê.',
      },
    ]);
  });

  it('an undefined field never erases the stored one', () => {
    expect(
      mergeListeningContent(published, { explanation: undefined }).explanation,
    ).toEqual(published.explanation);
  });

  it('a bilingual explanation edit keeps the evidence', () => {
    expect(
      mergeListeningContent(published, {
        explanation: { vi: 'Mới', en: 'New' },
      }).explanation,
    ).toEqual({ vi: 'Mới', en: 'New', evidence: 'Coffee, please.' });
  });
});

describe('spokenTextChanged', () => {
  it('is true when the sentence a clip reads changes', () => {
    expect(
      spokenTextChanged({ audioText: 'Hello.' }, { audioText: 'Hello there.' }),
    ).toBe(true);
    expect(
      spokenTextChanged(
        { correctAnswer: 'At ten.' },
        { correctAnswer: 'At eleven.' },
      ),
    ).toBe(true);
    expect(
      spokenTextChanged(
        { transcriptSegments: [{ speaker: 'A', text: 'Hi.' }] },
        { transcriptSegments: [{ speaker: 'A', text: 'Hi!' }] },
      ),
    ).toBe(true);
  });

  it('is false when only the question, options or explanation change', () => {
    const before = {
      audioText: 'Hello.',
      text: 'Who speaks?',
      options: ['a'],
      explanation: { vi: 'x' },
      transcriptSegments: [{ speaker: 'A', text: 'Hi.', translation: 'Chào.' }],
    };
    expect(
      spokenTextChanged(before, {
        ...before,
        text: 'Who is speaking?',
        options: ['b'],
        explanation: { vi: 'y', en: 'z' },
        transcriptSegments: [
          { speaker: 'A', text: 'Hi.', translation: 'Xin chào.' },
        ],
      }),
    ).toBe(false);
  });
});
