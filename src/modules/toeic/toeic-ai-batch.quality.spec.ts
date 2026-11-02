import {
  isVietnameseExplanation,
  prepareGeneratedBatch,
  questionsToAvoid,
  readingGroupIssue,
  shuffleOptions,
  stripOptionLabels,
} from './toeic-ai-batch.logic';

const question = (over: Record<string, unknown> = {}) => ({
  text: 'The office is closed _____ Monday.',
  options: ['on', 'in', 'at', 'by'],
  correctIndex: 0,
  explanation: 'Dùng trước thứ trong tuần là giới từ on.',
  ...over,
});

// Reverses four options: Fisher-Yates swaps 3<->0 then 2<->1, and leaves 1<->1.
const reversing = () => {
  const picks = [0, 1 / 3, 0.5];
  return () => picks.shift() ?? 0;
};

describe('shuffleOptions', () => {
  it('keeps the correct answer when the order changes', () => {
    const shuffled = shuffleOptions(question(), reversing());
    expect(shuffled.options).toEqual(['by', 'at', 'in', 'on']);
    expect(shuffled.options[shuffled.correctIndex]).toBe('on');
  });

  it('rewrites letters in the explanation to follow the moved options', () => {
    const shuffled = shuffleOptions(
      question({
        explanation:
          'Đáp án A đúng vì chỉ ngày. Đáp án C sai. Phương án (B) và D không hợp.',
      }),
      reversing(),
    );
    expect(shuffled.explanation).toBe(
      'Đáp án D đúng vì chỉ ngày. Đáp án B sai. Phương án (C) và A không hợp.',
    );
  });

  it('leaves other capital letters alone', () => {
    const explanation =
      'A person is typing, nên đáp án thể hiện đúng hành động.';
    expect(
      shuffleOptions(question({ explanation }), reversing()).explanation,
    ).toBe(explanation);
  });

  it('spreads the answer key evenly over the positions', () => {
    const seen = [0, 0, 0, 0];
    for (let round = 0; round < 4000; round += 1)
      seen[shuffleOptions(question()).correctIndex] += 1;
    seen.forEach((count) => expect(count).toBeGreaterThan(800));
  });
});

describe('stripOptionLabels', () => {
  it('drops the labels the model added', () => {
    expect(stripOptionLabels(['A) Monday', 'B) Friday'])).toEqual([
      'Monday',
      'Friday',
    ]);
  });

  it('keeps wording that only looks like a label', () => {
    expect(stripOptionLabels(['A. Smith called', 'Nobody called'])).toEqual([
      'A. Smith called',
      'Nobody called',
    ]);
  });
});

describe('prepareGeneratedBatch', () => {
  const group = {
    passageText: 'Staff [1] _____ on Monday. Visitors ___ at noon.',
    questions: [
      question({ text: '' }),
      question({
        text: 'Pick one',
        options: [
          'The lobby opens earlier than usual today.',
          'Parking remains free for every visitor here.',
          'Several desks were moved upstairs last year.',
          'Our cafeteria now serves dinner on Fridays.',
        ],
      }),
    ],
  };

  it('numbers Part 6 blanks by exam question and writes their prompts', () => {
    const prepared = prepareGeneratedBatch(6, { groups: [group] }, 131);
    expect(prepared.groups[0].passageText).toBe(
      'Staff [131] _____ on Monday. Visitors [132] _____ at noon.',
    );
    expect(prepared.groups[0].questions.map((item) => item.text)).toEqual([
      'Choose the best option for blank [131].',
      'Choose the sentence that best completes blank [132].',
    ]);
  });

  it('drops a number the model put after the blank', () => {
    const prepared = prepareGeneratedBatch(
      6,
      {
        groups: [
          {
            ...group,
            passageText: 'Staff _____ [1] Monday. Visitors _____ [2].',
          },
        ],
      },
      135,
    );
    expect(prepared.groups[0].passageText).toBe(
      'Staff [135] _____ Monday. Visitors [136] _____.',
    );
  });

  it('continues numbering across the groups of a batch', () => {
    const prepared = prepareGeneratedBatch(6, { groups: [group, group] }, 131);
    expect(prepared.groups[1].passageText).toContain('[133] _____');
  });

  it('leaves a passage alone when blanks and questions disagree', () => {
    const passageText = 'A passage with no blank.';
    const prepared = prepareGeneratedBatch(
      6,
      { groups: [{ ...group, passageText }] },
      131,
    );
    expect(prepared.groups[0].passageText).toBe(passageText);
  });

  it('passes malformed provider output through for validation to reject', () => {
    expect(prepareGeneratedBatch(5, { groups: 'x' }, 1)).toEqual({
      groups: 'x',
    });
  });
});

describe('readingGroupIssue', () => {
  it('rejects a Part 5 item that has no sentence with a blank', () => {
    expect(
      readingGroupIssue(5, { questions: [question({ text: null })] }),
    ).toMatch(/Part 5/);
    expect(
      readingGroupIssue(5, { questions: [question({ text: 'No blank.' })] }),
    ).toMatch(/Part 5/);
    expect(readingGroupIssue(5, { questions: [question()] })).toBeNull();
  });

  it('rejects a Part 6 passage without one blank per question', () => {
    const questions = [question(), question()];
    expect(
      readingGroupIssue(6, { passageText: 'Filled in.', questions }),
    ).toMatch(/0 chỗ trống cho 2/);
    expect(
      readingGroupIssue(6, { passageText: '_____ and _____', questions }),
    ).toBeNull();
  });

  it('rejects a Part 7 item with no question', () => {
    expect(
      readingGroupIssue(7, { questions: [question({ text: ' ' })] }),
    ).toMatch(/Part 7/);
  });
});

describe('isVietnameseExplanation', () => {
  it('accepts marked Vietnamese and refuses English or unmarked text', () => {
    expect(isVietnameseExplanation('Trạng từ bổ nghĩa cho động từ.')).toBe(
      true,
    );
    expect(isVietnameseExplanation('The adverb modifies the verb.')).toBe(
      false,
    );
    expect(isVietnameseExplanation('Thong bao chi ra rang cuoi thang.')).toBe(
      false,
    );
  });
});

describe('questionsToAvoid per Part', () => {
  it('names the tested answer for Part 5', () => {
    const batch = {
      part: 5,
      candidate: { groups: [{ questions: [question()] }] },
    };
    expect(questionsToAvoid([batch], 5)).toEqual([
      'The office is closed _____ Monday. (tests: on)',
    ]);
  });

  it('lists scenes for Part 1, which has no question text', () => {
    const batch = {
      part: 1,
      candidate: { groups: [{ imageBrief: 'A man typing.', questions: [] }] },
    };
    expect(questionsToAvoid([batch], 1)).toEqual(['A man typing.']);
  });
});

describe('questionsToAvoid on Part 6', () => {
  it('lists passages, because its prompts are all the same', () => {
    const batch = {
      part: 6,
      candidate: {
        groups: [
          {
            passageText: 'The branch closes on Friday.',
            questions: [{ text: 'Choose the best option for blank [131].' }],
          },
        ],
      },
    };
    expect(questionsToAvoid([batch], 6)).toEqual([
      'The branch closes on Friday.',
    ]);
  });
});
