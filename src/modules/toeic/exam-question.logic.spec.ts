import {
  addQuestionRefusal,
  examQuestionProblems,
  optionCountForPart,
} from './exam-question.logic';
import { validateToeicExam } from './toeic.validation';

describe('manual exam question rules', () => {
  it('asks for three responses in Part 2 and four elsewhere', () => {
    expect(optionCountForPart(2)).toBe(3);
    expect(optionCountForPart(1)).toBe(4);
    expect(optionCountForPart(5)).toBe(4);
    expect(
      examQuestionProblems(5, {
        options: ['a', 'b', ' ', 'd'],
        correctIndex: 0,
      }),
    ).toEqual(['Part 5 cần đúng 4 phương án, không để trống.']);
    expect(
      examQuestionProblems(2, { options: ['a', 'b', 'c'], correctIndex: 2 }),
    ).toEqual([]);
  });

  it('names an answer outside the options in plain words', () => {
    const [problem] = examQuestionProblems(1, {
      options: ['a', 'b', 'c', 'd'],
      correctIndex: 4,
    });
    expect(problem).toBe('Đáp án đúng nằm ngoài các phương án đã nhập.');
    expect(problem).not.toMatch(/correctIndex/);
  });

  it('keeps Parts 1 and 2 at one question per group', () => {
    expect(addQuestionRefusal(1, 0)).toBeNull();
    expect(addQuestionRefusal(2, 1)).toMatch(/chỉ có một câu hỏi/);
    expect(addQuestionRefusal(5, 1)).toBeNull();
    expect(addQuestionRefusal(6, 3)).toBeNull();
  });

  it('a question these rules accept passes the readiness option checks', () => {
    const question = { options: ['a', 'b', 'c'], correctIndex: 1 };
    expect(examQuestionProblems(2, question)).toEqual([]);
    const { issues } = validateToeicExam({
      id: 1,
      type: 'PRACTICE_BY_PART',
      durationSeconds: 600,
      groups: [
        {
          id: 1,
          part: 2,
          groupOrder: 1,
          audioUrl: 'audio',
          transcriptText: 'Where is the meeting?',
          questions: [{ id: 1, questionNumber: 7, ...question }],
        },
      ],
    });
    expect(issues.map((issue) => issue.code)).not.toContain('OPTIONS');
    expect(issues.map((issue) => issue.code)).not.toContain('ANSWER_KEY');
  });
});
