import {
  languageIssue,
  plannedGroupIssue,
  questionContentIssue,
  questionsToAvoid,
} from './toeic-ai-batch.logic';

describe('questionContentIssue', () => {
  const group = (fields: Record<string, string>, ...texts: string[]) => ({
    ...fields,
    questions: texts.map((text) => ({ text })),
  });

  // Live run 2026-11-03, q194: the passage says "restricted", never "limited".
  const elevators =
    'DOCUMENT 2\nRepair Schedule: Monday to Wednesday. Access to upper floors via elevators will be restricted.';

  it('refuses a vocabulary question about a word the passage lacks', () => {
    expect(
      questionContentIssue(
        7,
        group(
          { passageText: elevators },
          'The word "limited" in DOCUMENT 2, paragraph 1, line 1, is closest in meaning to?',
        ),
      ),
    ).toBe('Câu 1 hỏi nghĩa của "limited" nhưng từ này không có trong bài');
  });

  it('accepts it when the word is in the passage, in any case or quote style', () => {
    expect(
      questionContentIssue(
        7,
        group(
          { passageText: elevators },
          'What is the purpose of the notice?',
          'The word “Restricted” in DOCUMENT 2, paragraph 1, line 2, is closest in meaning to',
        ),
      ),
    ).toBeNull();
  });

  it('matches whole words only, across a line break', () => {
    const passage = 'The team will cover\nthe costs. Coverage is limitless.';
    expect(
      questionContentIssue(
        7,
        group(
          { passageText: passage },
          'The word "limit" is closest in meaning to',
        ),
      ),
    ).toMatch(/không có trong bài/);
    expect(
      questionContentIssue(
        7,
        group(
          { passageText: passage },
          'The phrase "cover the costs" is closest in meaning to',
        ),
      ),
    ).toBeNull();
  });

  it('refuses a vocabulary question that does not quote its word', () => {
    expect(
      questionContentIssue(
        7,
        group(
          { passageText: elevators },
          'Which word is closest in meaning to restricted?',
        ),
      ),
    ).toMatch(/không ghi từ cần hỏi/);
  });

  // Live run 2026-11-03, q88: a talk asked about a graphic it never had.
  it('refuses a graphic question in a group without a graphic', () => {
    expect(
      questionContentIssue(
        4,
        group(
          { transcript: 'Are you concerned about the safety of your home?' },
          'What is being advertised?',
          'Look at the graphic. How much does the recommended package cost per month?',
        ),
      ),
    ).toBe(
      'Câu 2 hỏi theo hình (Look at the graphic) nhưng nhóm không có hình GRAPHIC',
    );
  });

  it('accepts a graphic question when the group has its graphic', () => {
    expect(
      questionContentIssue(
        3,
        group(
          {
            transcript: 'M: Which room? W: The large one.',
            passageText: 'GRAPHIC: Rooms\nRoom | Seats\nA | 10\nB | 20',
          },
          'Look at the graphic. Which room will they use?',
        ),
      ),
    ).toBeNull();
  });
});

describe('questionsToAvoid', () => {
  const batch = (part: number, ...texts: string[]) => ({
    part,
    candidate: {
      groups: [{ questions: texts.map((text) => ({ text })) }],
    },
  });

  it('lists questions already generated for the same Part', () => {
    expect(
      questionsToAvoid([batch(5, 'A', 'B'), batch(6, 'C'), batch(5, 'D')], 5),
    ).toEqual(['A', 'B', 'D']);
  });

  it('skips questions without text', () => {
    expect(questionsToAvoid([batch(5, ' ', 'A')], 5)).toEqual(['A']);
  });

  it('keeps the most recent questions when there are many', () => {
    expect(questionsToAvoid([batch(5, 'A', 'B', 'C')], 5, 2)).toEqual([
      'B',
      'C',
    ]);
  });
});

describe('languageIssue', () => {
  // Live rerun 2026-11-04: a whole Part 6 batch came back in Vietnamese.
  it('refuses a passage written in Vietnamese', () => {
    expect(
      languageIssue({
        passageText:
          'Kính gửi toàn thể nhân viên, công ty chúng tôi sẽ [131] _____ một khóa đào tạo kỹ năng mềm vào tháng tới.',
        questions: [
          {
            text: 'Choose the best option for blank [131].',
            options: ['tăng cường', 'cung cấp', 'yêu cầu', 'loại bỏ'],
          },
        ],
      }),
    ).toMatch(/passage đang viết bằng tiếng Việt/);
  });

  it('refuses Vietnamese options under an English passage', () => {
    expect(
      languageIssue({
        passageText:
          'Our company will [131] _____ a training course next month.',
        questions: [
          {
            text: 'Choose the best option for blank [131].',
            options: ['tăng cường', 'cung cấp', 'yêu cầu', 'loại bỏ'],
          },
        ],
      }),
    ).toMatch(/phương án câu 1/);
  });

  it('accepts English with a Vietnamese name, loanwords and Vietnamese explanations', () => {
    expect(
      languageIssue({
        transcript:
          'M: Ms. Nguyễn left her résumé at the café near the office.',
        questions: [
          {
            text: 'Where did Ms. Nguyễn leave her résumé?',
            options: ['At the café', 'At home', 'At the bank', 'On the train'],
            explanation: 'Người đàn ông nói cô ấy để quên hồ sơ ở quán cà phê.',
          },
        ],
      }),
    ).toBeNull();
  });
});

describe('plannedGroupIssue for a three-speaker dialogue', () => {
  // Live runs of 2026-11-03/04: every turn on one line, counted as one speaker.
  it('counts speakers written on one line', () => {
    expect(
      plannedGroupIssue(
        { threeSpeakers: true },
        {
          transcript:
            'M: Shall we start the review? W1: Yes, I have the sales figures. W2: And I brought the new slides. M: Great, let us begin.',
        },
      ),
    ).toBeNull();
  });

  it('still refuses two speakers', () => {
    expect(
      plannedGroupIssue(
        { threeSpeakers: true },
        { transcript: 'M: Shall we start? W: Yes. M: Good.' },
      ),
    ).toBe('Hội thoại cần 3 người nói, hiện có 2');
  });
});
