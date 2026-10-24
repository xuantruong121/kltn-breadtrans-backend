import {
  buildToeicListeningAudioScript,
  toeicListeningAudioFingerprint,
} from './toeic-listening-audio';

const question = (options: string[], correctIndex = 0, text?: string) => ({
  text,
  options,
  correctIndex,
});

describe('TOEIC Listening audio script builder', () => {
  it('composes all four Part 1 spoken statements in playback order', () => {
    const script = buildToeicListeningAudioScript({
      part: 1,
      questions: [
        question([
          'The man is filing documents.',
          'A woman is opening a window.',
          'Several chairs are arranged around a table.',
          'The boxes are being moved outside.',
        ]),
      ],
    });

    expect(script).toContain('A. The man is filing documents.');
    expect(script).toContain('D. The boxes are being moved outside.');
    expect(script).not.toContain('Statement A');
    expect(script).not.toContain('Statement');
    expect(script).not.toContain('Option A');
  });

  it('composes the Part 2 prompt and every spoken response', () => {
    const script = buildToeicListeningAudioScript({
      part: 2,
      transcriptText: 'Where should I leave these forms?',
      questions: [
        question([
          'On the reception desk.',
          'It was delivered yesterday.',
          'Yes, I filled them out.',
        ]),
      ],
    });

    expect(script).toContain('Where should I leave these forms?');
    expect(script).toContain('A. On the reception desk.');
    expect(script).toContain('C. Yes, I filled them out.');
    expect(script).not.toContain('Response A');
    expect(script).not.toContain('Response');
    expect(script).not.toContain('Option A');
    expect(script).not.toContain('Question:');
  });

  it('uses Part 3 dialogue/Part 4 talk plus every spoken question prompt, never answer options', () => {
    const part3 = buildToeicListeningAudioScript({
      part: 3,
      transcriptText: 'Woman: Shall we move the meeting?\nMan: Yes, to Friday.',
      questions: [
        question(['a', 'b', 'c', 'd'], 0, 'What do the speakers discuss?'),
        question(['a', 'b', 'c', 'd'], 0, 'What will happen on Friday?'),
        question(['a', 'b', 'c', 'd'], 0, 'Why does the man agree?'),
      ],
    });
    expect(part3).toContain('Woman: Shall we move the meeting?');
    expect(part3).toContain('What do the speakers discuss?');
    expect(part3).toContain('What will happen on Friday?');
    expect(part3).toContain('Why does the man agree?');
    expect(part3).not.toContain('Dialogue:');
    expect(part3).not.toContain('Question:');
    expect(part3).not.toContain('a, b, c, d');

    const part4 = buildToeicListeningAudioScript({
      part: 4,
      transcriptText: 'Please note that the office will close at five.',
      questions: [
        question(['a', 'b', 'c', 'd'], 0, 'What is the announcement about?'),
        question(['a', 'b', 'c', 'd'], 0, 'When will the office close?'),
        question(['a', 'b', 'c', 'd'], 0, 'What should listeners do?'),
      ],
    });
    expect(part4).toBe(
      [
        'Please note that the office will close at five.',
        'What is the announcement about?',
        'When will the office close?',
        'What should listeners do?',
      ].join('\n\n'),
    );
    expect(part4).not.toContain('Talk:');
  });

  it('rejects Part 3/4 groups missing a spoken question prompt', () => {
    expect(() =>
      buildToeicListeningAudioScript({
        part: 3,
        transcriptText: 'Woman: Shall we move the meeting?',
        questions: [question(['a', 'b', 'c', 'd'], 0, '')],
      }),
    ).toThrow('spoken after the conversation');
    expect(() =>
      buildToeicListeningAudioScript({
        part: 4,
        transcriptText: 'Please note the office will close early.',
        questions: [],
      }),
    ).toThrow('spoken after the talk');
  });

  it('preserves A/B/C/D order and never narrates a label word for Part 1', () => {
    const script = buildToeicListeningAudioScript({
      part: 1,
      questions: [question(['first', 'second', 'third', 'fourth'])],
    });
    expect(script.split('\n\n')).toEqual([
      'A. first',
      'B. second',
      'C. third',
      'D. fourth',
    ]);
  });

  it('changes the semantic fingerprint when a spoken option changes', () => {
    const group = {
      part: 2,
      canonicalAccent: 'US',
      transcriptText: 'Who approved the invoice?',
      questions: [
        question([
          'The finance director.',
          'Yesterday morning.',
          'At the bank.',
        ]),
      ],
    };
    const original = toeicListeningAudioFingerprint(group);
    group.questions[0].options[0] = 'The operations director.';
    expect(toeicListeningAudioFingerprint(group)).not.toBe(original);
  });

  it('rejects an incomplete Part 1 or Part 2 spoken structure', () => {
    expect(() =>
      buildToeicListeningAudioScript({
        part: 1,
        questions: [question(['a', 'b', 'c'])],
      }),
    ).toThrow('exactly 4');
    expect(() =>
      buildToeicListeningAudioScript({
        part: 2,
        questions: [question(['a', 'b', 'c'])],
      }),
    ).toThrow('spoken prompt');
  });
});
