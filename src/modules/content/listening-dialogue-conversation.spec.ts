import {
  dialogueQuizIssues,
  hasDraftTranscript,
  withoutDraftTranscript,
} from './listening-dialogue-conversation';

const turns = [
  { speaker: 'A', text: 'Hi.' },
  { speaker: 'B', text: 'Hello.' },
];
const mcq = (content: Record<string, unknown> = {}) => ({
  type: 'MULTIPLE_CHOICE',
  content: { options: ['a', 'b', 'c', 'd'], correctIndex: 0, ...content },
});

describe('the draft conversation on a quiz', () => {
  it('is removed without touching the rest of the metadata', () => {
    const meta = { mode: 'DIALOGUE', levels: ['B1'], draftTranscript: turns };
    expect(hasDraftTranscript(meta)).toBe(true);
    expect(withoutDraftTranscript(meta)).toEqual({
      mode: 'DIALOGUE',
      levels: ['B1'],
    });
    // The stored object is not changed.
    expect(meta.draftTranscript).toBe(turns);
  });

  it('leaves metadata without one as it is', () => {
    const meta = { mode: 'DIALOGUE' };
    expect(withoutDraftTranscript(meta)).toBe(meta);
    expect(withoutDraftTranscript(undefined)).toBeUndefined();
    expect(withoutDraftTranscript(['paragraph'])).toEqual(['paragraph']);
    expect(hasDraftTranscript(null)).toBe(false);
  });
});

describe('dialogueQuizIssues', () => {
  it('passes a conversation of 2 speakers carried by the questions', () => {
    expect(
      dialogueQuizIssues('DIALOGUE', [
        mcq({ transcriptSegments: turns }),
        mcq({ transcriptSegments: turns }),
      ]),
    ).toEqual([]);
  });

  it('asks for the conversation when no question carries 2 speakers', () => {
    const issue = 'Lời thoại: cần ít nhất 2 lượt lời của 2 người nói';
    expect(dialogueQuizIssues('DIALOGUE', [mcq()])).toEqual([issue]);
    expect(dialogueQuizIssues('DIALOGUE', [])).toEqual([issue]);
    expect(
      dialogueQuizIssues('DIALOGUE', [
        mcq({ transcriptSegments: [turns[0], { speaker: 'A', text: 'Bye.' }] }),
      ]),
    ).toEqual([issue]);
    // Speaker ids count as speakers, as the recording reads them.
    expect(
      dialogueQuizIssues('DIALOGUE', [
        mcq({
          transcriptSegments: [
            { speakerId: 'customer', text: 'Hi.' },
            { speakerId: 'barista', text: 'Hello.' },
          ],
        }),
      ]),
    ).toEqual([]);
  });

  it('asks for a choice question', () => {
    expect(
      dialogueQuizIssues('DIALOGUE', [
        { type: 'DICTATION', content: { transcriptSegments: turns } },
      ]),
    ).toEqual(['Cần ít nhất một câu trắc nghiệm']);
  });

  it('leaves a legacy holder to its own row check', () => {
    expect(
      dialogueQuizIssues('DIALOGUE', [
        { type: 'DIALOGUE', content: { transcriptSegments: [turns[0]] } },
        mcq(),
      ]),
    ).toEqual([]);
  });

  it('checks nothing in the other listening forms', () => {
    expect(dialogueQuizIssues('COMPREHENSION', [mcq()])).toEqual([]);
    expect(dialogueQuizIssues(undefined, [])).toEqual([]);
  });
});
