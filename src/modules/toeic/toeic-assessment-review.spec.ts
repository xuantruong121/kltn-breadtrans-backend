import {
  reviewSpeakingTasks,
  reviewWritingTasks,
  speakingTaskStatus,
} from './toeic-assessment-review';

const at = new Date('2026-10-27T08:00:00Z');

describe('TOEIC assessment task review', () => {
  it('maps every stored grading state without inventing a score', () => {
    expect(speakingTaskStatus(null)).toBe('NOT_SUBMITTED');
    expect(speakingTaskStatus({ status: 'PENDING', overallScore: null })).toBe(
      'PENDING',
    );
    expect(
      speakingTaskStatus({ status: 'PROCESSING', overallScore: null }),
    ).toBe('PENDING');
    expect(speakingTaskStatus({ status: 'FAILED', overallScore: null })).toBe(
      'FAILED',
    );
    expect(
      speakingTaskStatus({ status: 'COMPLETED', overallScore: null }),
    ).toBe('NO_SPEECH');
    expect(speakingTaskStatus({ status: 'COMPLETED', overallScore: 7.5 })).toBe(
      'GRADED',
    );
  });

  it('keeps authored task order, uses the latest submission, hides the recording URL', () => {
    const tasks = reviewSpeakingTasks(
      [
        {
          id: 10,
          title: 'Q1',
          taskType: 'READ_ALOUD',
          targetText: 'Read',
          imageUrl: null,
        },
        {
          id: 11,
          title: 'Q2',
          taskType: 'READ_ALOUD',
          targetText: 'Read 2',
          imageUrl: null,
        },
      ],
      [
        {
          id: 1,
          exerciseId: 10,
          status: 'FAILED',
          overallScore: null,
          transcript: null,
          aiFeedback: null,
          audioKey: 'k1',
          audioUrl: null,
          submittedAt: at,
        },
        {
          id: 2,
          exerciseId: 10,
          status: 'COMPLETED',
          overallScore: 8.1,
          transcript: 'hello',
          aiFeedback: {
            accuracyScore: 86,
            fluencyScore: 78,
            feedback: 'ok',
            suggestions: ['s'],
          },
          audioKey: 'secret/key.webm',
          audioUrl: null,
          submittedAt: at,
        },
      ],
    );
    expect(tasks.map((t) => [t.number, t.status])).toEqual([
      [1, 'GRADED'],
      [2, 'NOT_SUBMITTED'],
    ]);
    expect(tasks[0].submission).toMatchObject({
      id: 2,
      overallScore: 8.1,
      hasRecording: true,
      criteria: {
        accuracy: 86,
        fluency: 78,
        completeness: null,
        prosody: null,
      },
      suggestions: ['s'],
    });
    expect(JSON.stringify(tasks)).not.toContain('secret/key.webm');
  });

  it('reads the stored writing rubric; an unscored submission is pending', () => {
    const tasks = reviewWritingTasks(
      [
        {
          writingQuizId: 40,
          taskKind: 'PICTURE_SENTENCE',
          writingQuiz: { title: 'Câu 1' },
        },
        {
          writingQuizId: 41,
          taskKind: 'OPINION_ESSAY',
          writingQuiz: { title: 'Câu 8' },
        },
      ],
      [
        {
          id: 5,
          quizId: 40,
          score: 2,
          submittedAt: at,
          aiFeedback: JSON.stringify({
            maxScore: 3,
            feedback: 'f',
            criteria: [
              {
                key: 'grammar',
                label: 'Ngữ pháp',
                score: 1,
                max: 1,
                comment: 'c',
              },
            ],
          }),
        },
        { id: 6, quizId: 41, score: null, aiFeedback: null, submittedAt: at },
      ],
    );
    expect(tasks[0]).toMatchObject({
      status: 'GRADED',
      submission: {
        score: 2,
        maxScore: 3,
        criteria: [{ label: 'Ngữ pháp', score: 1, max: 1, comment: 'c' }],
      },
    });
    expect(tasks[1].status).toBe('PENDING');
  });
});
