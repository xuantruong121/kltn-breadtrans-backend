import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { QuizType, TopicCategory } from '@prisma/client';

import { summarizeWritingExercise } from './practice-writing-grading';
import { WritingService } from './writing.service';

const rubric = { grammar: 4, naturalness: 2, taskCompletion: 4 };
const quiz = {
  id: 3,
  title: 'Sentence Builder',
  description: null,
  type: QuizType.WRITING_PICTURE,
  isPremiumContent: false,
  courseId: null,
  publicationStatus: 'PUBLISHED',
  practiceTopic: { category: TopicCategory.WRITING_PART1, name: 'Câu' },
  toeicWritingSetItems: [],
  questions: [
    {
      id: 12,
      content: {
        taskType: 'SENTENCE',
        prompt: 'meeting / tomorrow',
        rubric,
        requiredKeywords: ['meeting', 'tomorrow'],
      },
    },
    {
      id: 13,
      content: {
        taskType: 'SENTENCE',
        prompt: 'because / delayed',
        rubric,
        requiredKeywords: ['because', 'delayed'],
      },
    },
  ],
};

/** Grader reply giving `points` out of 10 split over the three criteria. */
function reply(points: number) {
  const grammar = Math.min(4, points);
  const naturalness = Math.min(2, points - grammar);
  const taskCompletion = points - grammar - naturalness;
  return JSON.stringify({
    criteria: [
      { key: 'grammar', score: grammar, comment: 'Ngữ pháp đúng.' },
      { key: 'naturalness', score: naturalness, comment: 'Câu tự nhiên.' },
      {
        key: 'taskCompletion',
        score: taskCompletion,
        comment: 'Đủ từ yêu cầu.',
      },
    ],
    strengths: ['Dùng đúng từ khóa.'],
    corrections: [],
    feedback: 'Câu viết rõ ràng và đúng yêu cầu của đề.',
    suggestions: ['Thử dùng thêm một mệnh đề phụ.'],
  });
}

function setup() {
  let nextId = 900;
  const submissions: Array<{
    id: number;
    userId: number;
    quizId: number;
    clientAttemptId: string;
    score: number;
    aiFeedback: string;
    submittedAt: Date;
    results: Array<{ id: number; questionId: number; score: number }>;
  }> = [];
  const rewards = new Set<string>();
  const create = jest.fn(({ data }: any) => {
    const id = nextId++;
    const row = {
      id,
      userId: data.userId,
      quizId: data.quizId,
      clientAttemptId: data.clientAttemptId,
      score: data.score,
      aiFeedback: data.aiFeedback,
      submittedAt: new Date(Date.now() + id),
      results: data.results.create.map((r: any) => ({ id, ...r })),
    };
    submissions.push(row);
    return Promise.resolve(row);
  });
  const prisma = {
    quiz: { findUnique: jest.fn().mockResolvedValue(quiz) },
    toeicWritingSetItem: { findMany: jest.fn().mockResolvedValue([]) },
    submission: {
      findUnique: jest.fn(({ where }: any) => {
        const key = where.userId_quizId_clientAttemptId;
        return Promise.resolve(
          submissions.find(
            (s) =>
              s.userId === key.userId &&
              s.quizId === key.quizId &&
              s.clientAttemptId === key.clientAttemptId,
          ) ?? null,
        );
      }),
      create,
    },
    result: {
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(
          submissions
            .filter(
              (s) =>
                s.userId === where.submission.userId &&
                s.quizId === where.submission.quizId,
            )
            .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime())
            .flatMap((s) =>
              s.results
                .filter((r) => where.questionId.in.includes(r.questionId))
                .map((r) => ({
                  questionId: r.questionId,
                  score: r.score,
                  submission: {
                    id: s.id,
                    submittedAt: s.submittedAt,
                    aiFeedback: s.aiFeedback,
                  },
                })),
            ),
        ),
      ),
    },
    userQuizReward: {
      createMany: jest.fn(({ data }: any) => {
        const key = `${data.userId}:${data.quizId}`;
        const count = rewards.has(key) ? 0 : 1;
        rewards.add(key);
        return Promise.resolve({ count });
      }),
    },
    learningActivity: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn((cb: (tx: any) => unknown) =>
      cb({
        submission: { create },
        learningActivity: { create: jest.fn().mockResolvedValue({}) },
      }),
    ),
  };
  const ai = { generateStructuredJson: jest.fn() };
  const events = { emit: jest.fn() };
  const service = new WritingService(
    prisma as any,
    ai as any,
    undefined,
    events as any,
  );
  const submit = (questionId: number, points: number, attempt: string) => {
    ai.generateStructuredJson.mockResolvedValueOnce({
      text: reply(points),
      model: 'test',
    });
    return service.submitWriting(
      quiz.id,
      7,
      'The meeting is tomorrow because the train was delayed.',
      undefined,
      attempt,
      undefined,
      questionId,
    );
  };
  return { service, submit, events, prisma, ai, submissions };
}

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('multi-task Writing exercise', () => {
  it('summarizes only when every task is graded, as the mean percentage', () => {
    const grades = new Map([[12, { score: 8, maxScore: 10 }]]);
    expect(summarizeWritingExercise([12, 13], grades)).toEqual({
      total: 2,
      answered: 1,
      complete: false,
      percent: null,
      nextQuestionId: 13,
    });
    grades.set(13, { score: 5, maxScore: 10 });
    expect(summarizeWritingExercise([12, 13], grades).percent).toBe(65);
  });

  it('grades each task with its own prompt and rewards the exercise once, at the last task', async () => {
    const { submit, events, ai, prisma } = setup();

    const first = await submit(12, 8, id(1));
    expect(first.exercise).toMatchObject({
      answered: 1,
      total: 2,
      complete: false,
      nextQuestionId: 13,
    });
    expect(events.emit).not.toHaveBeenCalled();
    expect(prisma.userQuizReward.createMany).not.toHaveBeenCalled();
    expect(
      JSON.parse(ai.generateStructuredJson.mock.calls[0][0].prompt).task.prompt,
    ).toBe('meeting / tomorrow');

    const second = await submit(13, 5, id(2));
    expect(
      JSON.parse(ai.generateStructuredJson.mock.calls[1][0].prompt).task.prompt,
    ).toBe('because / delayed');
    expect(second.exercise).toMatchObject({
      answered: 2,
      complete: true,
      percent: 65,
    });
    expect(events.emit).toHaveBeenCalledTimes(1);
    expect(events.emit).toHaveBeenCalledWith(
      'quiz.submitted',
      expect.objectContaining({ score: 65, isFirstSubmission: true }),
    );

    // A retake after completion uses the latest grade and grants no new reward.
    const retake = await submit(13, 10, id(3));
    expect(retake.exercise).toMatchObject({ complete: true, percent: 90 });
    expect(events.emit).toHaveBeenLastCalledWith(
      'quiz.submitted',
      expect.objectContaining({ isFirstSubmission: false }),
    );
  });

  it('the same clientAttemptId returns the stored grade without grading again', async () => {
    const { submit, ai } = setup();
    await submit(12, 8, id(4));
    ai.generateStructuredJson.mockClear();
    const again = await submit(12, 8, id(4));
    expect(ai.generateStructuredJson).not.toHaveBeenCalled();
    expect(again.exercise).toMatchObject({ answered: 1 });
  });

  it('refuses a task from another exercise', async () => {
    const { submit } = setup();
    await expect(submit(999, 8, id(5))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('a failed grade stores nothing and the exercise stays incomplete', async () => {
    const { service, ai, submissions, events } = setup();
    ai.generateStructuredJson.mockResolvedValue({
      text: 'not json',
      model: 'test',
    });
    await expect(
      service.submitWriting(
        quiz.id,
        7,
        'Text.',
        undefined,
        id(6),
        undefined,
        12,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(submissions).toHaveLength(0);
    expect(events.emit).not.toHaveBeenCalled();
  });
});
