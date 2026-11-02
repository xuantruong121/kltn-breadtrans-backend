import {
  isListeningGraphic,
  learnerPassage,
  plannedGroupIssue,
  readingGroupIssue,
} from './toeic-ai-batch.logic';

describe('what the plan promised for a group', () => {
  it('needs three speakers in a three-speaker conversation', () => {
    const planned = { threeSpeakers: true };
    expect(
      plannedGroupIssue(planned, { transcript: 'M: Hi.\nW: Hello.' }),
    ).toContain('3 người nói');
    expect(
      plannedGroupIssue(planned, {
        transcript: 'M: Hi.\nW1: Hello.\nW2: Good morning.',
      }),
    ).toBeNull();
  });

  it('needs a graphic and a last question that uses it', () => {
    const planned = { graphic: true };
    const passageText = 'GRAPHIC: Prices\nA | $1\nB | $2\nC | $3';
    expect(plannedGroupIssue(planned, { passageText: 'x' })).toContain(
      'GRAPHIC',
    );
    expect(
      plannedGroupIssue(planned, {
        passageText,
        questions: [{ text: 'What is the price?' }],
      }),
    ).toContain('Look at the graphic');
    expect(
      plannedGroupIssue(planned, {
        passageText,
        questions: [{ text: 'Look at the graphic. Which item?' }],
      }),
    ).toBeNull();
  });

  it('counts the documents of a multiple passage', () => {
    const twoDocuments = 'DOCUMENT 1\nAn e-mail.\n\nDOCUMENT 2\nA form.';
    expect(
      plannedGroupIssue({ documents: 3 }, { passageText: twoDocuments }),
    ).toContain('3 văn bản');
    expect(
      plannedGroupIssue({ documents: 2 }, { passageText: twoDocuments }),
    ).toBeNull();
  });

  it('needs exactly one full sentence choice in each Part 6 passage', () => {
    const word = { options: ['a', 'b', 'c', 'd'] };
    const sentence = {
      options: [
        'We look forward to it.',
        'Please call us today.',
        'The office is closed now.',
        'Thank you very much indeed.',
      ],
    };
    const passageText = '_____ _____ _____ _____';
    expect(
      readingGroupIssue(6, {
        passageText,
        questions: [word, word, word, word],
      }),
    ).toContain('1 câu chèn');
    expect(
      readingGroupIssue(6, {
        passageText,
        questions: [word, word, sentence, word],
      }),
    ).toBeNull();
  });
});

describe('a listening passage for learners', () => {
  it('shows a graphic and nothing else', () => {
    expect(isListeningGraphic('GRAPHIC: Prices')).toBe(true);
    expect(learnerPassage(3, 'GRAPHIC: Prices\nA | $1')).toContain('Prices');
    expect(learnerPassage(3, 'M: This is the script.')).toBeNull();
    expect(learnerPassage(7, 'An article.')).toBe('An article.');
  });
});
