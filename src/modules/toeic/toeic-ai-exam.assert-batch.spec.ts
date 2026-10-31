import { ToeicAiExamService } from './toeic-ai-exam.service';

/**
 * Phase 1 Gate 0 — AI-generated Part 3/4 questions must include the spoken
 * question-prompt text, or the Listening audio script builder can never
 * compose valid audio for them (confirmed live on Exam 69: 6 groups had
 * question.text === null and were permanently blocked).
 */
// Parts 3/4 must be real-test length (toeic-listening-length).
const LONG = ' Then we can talk it over.'.repeat(20);

describe('ToeicAiExamService.assertBatch — Part 3/4 requires spoken question text', () => {
  let service: any;

  beforeEach(() => {
    service = Object.create(ToeicAiExamService.prototype);
  });

  const validQuestion = (text: string | null) => ({
    text,
    options: ['a', 'b', 'c', 'd'],
    correctIndex: 0,
    explanation: 'This is a sufficiently long explanation for the answer.',
  });

  it('rejects a Part 3 question with no spoken prompt text', () => {
    expect(() =>
      service.assertBatch(3, [{ questionCount: 1 }], {
        groups: [
          {
            transcript: `Woman: Shall we move the meeting?${LONG}`,
            questions: [validQuestion(null)],
          },
        ],
      }),
    ).toThrow(/thiếu nội dung câu hỏi/);
  });

  it('rejects a Part 4 question with blank prompt text', () => {
    expect(() =>
      service.assertBatch(4, [{ questionCount: 1 }], {
        groups: [
          {
            transcript: `Please note the office will close early.${LONG}`,
            questions: [validQuestion('   ')],
          },
        ],
      }),
    ).toThrow(/thiếu nội dung câu hỏi/);
  });

  it('accepts a Part 3 question that has real spoken prompt text', () => {
    expect(() =>
      service.assertBatch(3, [{ questionCount: 1 }], {
        groups: [
          {
            transcript: `Woman: Shall we move the meeting?${LONG}`,
            questions: [validQuestion('What do the speakers discuss?')],
          },
        ],
      }),
    ).not.toThrow();
  });

  it('does not require question text for Part 1/2 (no questions.text in their contract)', () => {
    expect(() =>
      service.assertBatch(1, [{ questionCount: 1 }], {
        groups: [
          {
            imageBrief: 'A busy office scene',
            questions: [validQuestion(null)],
          },
        ],
      }),
    ).not.toThrow();
  });
});
