import { humanizeToeicValidationIssues } from './toeic.validation';

describe('humanizeToeicValidationIssues — Phase C human-readable readiness', () => {
  const exam = {
    id: 1,
    type: 'FULL_TEST',
    durationSeconds: 7200,
    groups: [
      {
        id: 128,
        part: 3,
        groupOrder: 2,
        questions: [
          { id: 501, questionNumber: 24, options: [], correctIndex: -1 },
        ],
      },
      {
        id: 90,
        part: 7,
        groupOrder: 6,
        passageText: null,
        questions: [],
      },
    ],
  };

  it('turns MISSING_AUDIO + an internal groupId into a human Vietnamese message with Part/group coordinates', () => {
    const [issue] = humanizeToeicValidationIssues(exam, [
      {
        code: 'MISSING_AUDIO',
        message: 'Nhóm Listening chưa có audio đã lưu.',
        groupId: 128,
      },
    ]);
    expect(issue.humanMessage).toBe(
      'Listening · Part 3 · Nhóm hội thoại 2 chưa có audio.',
    );
    expect(issue.part).toBe(3);
    expect(issue.groupOrder).toBe(2);
    // The raw code/ID stay on the object for internal navigation — just never
    // as the only user-visible text.
    expect(issue.code).toBe('MISSING_AUDIO');
    expect(issue.groupId).toBe(128);
  });

  it('turns ANSWER_KEY on a specific question into a question-numbered Vietnamese message', () => {
    const [issue] = humanizeToeicValidationIssues(exam, [
      {
        code: 'ANSWER_KEY',
        message: 'Câu hỏi chưa có đáp án đúng hợp lệ.',
        groupId: 128,
        questionId: 501,
      },
    ]);
    expect(issue.humanMessage).toBe(
      'Listening · Part 3 · Câu 24 chưa có đáp án đúng.',
    );
    expect(issue.questionNumber).toBe(24);
  });

  it('turns MISSING_PASSAGE on a Part 7 group into a human message', () => {
    const [issue] = humanizeToeicValidationIssues(exam, [
      {
        code: 'MISSING_PASSAGE',
        message: 'Nhóm Reading chưa có đoạn văn.',
        groupId: 90,
      },
    ]);
    expect(issue.humanMessage).toBe(
      'Reading · Part 7 · Đoạn văn 6 chưa có đoạn văn.',
    );
  });

  it('never leaves the raw technical message as humanMessage for a known code', () => {
    const issues = humanizeToeicValidationIssues(exam, [
      {
        code: 'MISSING_AUDIO',
        message: 'Nhóm Listening chưa có audio đã lưu.',
        groupId: 128,
      },
      {
        code: 'ANSWER_KEY',
        message: 'Câu hỏi chưa có đáp án đúng hợp lệ.',
        groupId: 128,
        questionId: 501,
      },
    ]);
    for (const issue of issues) {
      expect(issue.humanMessage).not.toBe(issue.message);
      expect(issue.humanMessage).not.toMatch(/MISSING_|ANSWER_KEY/);
    }
  });
});
