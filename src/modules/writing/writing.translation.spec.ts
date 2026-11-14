import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { QuizType, TopicCategory } from '@prisma/client';

import { WritingService } from './writing.service';

const task = (prompt: string, acceptedAnswers: string[]) => ({
  skill: 'WRITING',
  taskType: 'SENTENCE_TRANSLATION',
  level: 'A1',
  prompt,
  acceptedAnswers,
  hints: [{ vi: 'giáo viên', en: 'teacher' }],
  grammarTip: 'Nói nghề nghiệp cần "a/an" trước tên nghề.',
});

const quiz = {
  id: 40,
  title: 'Dịch câu: Gia đình (A1)',
  description: null,
  type: QuizType.WRITING_PICTURE,
  isPremiumContent: false,
  publicationStatus: 'PUBLISHED',
  practiceTopic: { category: TopicCategory.WRITING_PART1, name: 'Dịch câu' },
  toeicWritingSetItems: [],
  questions: [
    {
      id: 501,
      content: task('Mẹ tôi là giáo viên.', [
        'My mother is a teacher.',
        'My mom is a teacher.',
      ]),
    },
    {
      id: 502,
      content: task('Tôi có một người anh trai.', [
        'I have an older brother.',
        'I have a big brother.',
      ]),
    },
  ],
};

const aiReply = (verdict: string) =>
  JSON.stringify({
    verdict,
    correctedSentence: 'My mother is a teacher.',
    explanation: 'Thiếu mạo từ "a" trước "teacher".',
    errorTags: verdict === 'CORRECT' ? [] : ['ARTICLE'],
  });

function setup(opts: { planLimitUsed?: number; redis?: boolean } = {}) {
  let nextId = 900;
  const submissions: any[] = [];
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
    },
    result: {
      findMany: jest.fn(() =>
        Promise.resolve(
          [...submissions]
            .sort((a, b) => b.submittedAt - a.submittedAt)
            .flatMap((s) =>
              s.results.map((r: any) => ({
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
    userQuizReward: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    $transaction: jest.fn((cb: (tx: any) => unknown) =>
      cb({
        submission: { create },
        learningActivity: { create: jest.fn().mockResolvedValue({}) },
      }),
    ),
  };
  const ai = { generateStructuredJson: jest.fn() };
  const events = { emit: jest.fn() };
  const counter = { value: opts.planLimitUsed ?? 0 };
  const redis = {
    incr: jest.fn(() => Promise.resolve(++counter.value)),
    decr: jest.fn(() => Promise.resolve(--counter.value)),
    expire: jest.fn().mockResolvedValue(1),
  };
  const subscriptions = { planCodeFor: jest.fn().mockResolvedValue('FREE') };
  const service = new WritingService(
    prisma as any,
    ai as any,
    undefined,
    events as any,
    undefined,
    subscriptions as any,
    opts.redis === false ? undefined : (redis as any),
  );
  const check = (questionId: number, answer: string, attempt?: string) =>
    service.checkTranslation(
      quiz.id,
      questionId,
      7,
      answer,
      undefined,
      attempt,
    );
  return { service, check, ai, counter, events, submissions };
}

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('sentence translation check', () => {
  it('accepts a matching answer without the AI and without using a grading', async () => {
    const { check, ai, counter } = setup();
    const out = await check(501, 'my mom is a teacher', id(1));
    expect(out).toMatchObject({
      verdict: 'CORRECT',
      source: 'MATCH',
      score: 2,
      maxScore: 2,
      closest: 'My mom is a teacher.',
      otherAnswers: ['My mother is a teacher.'],
      diff: null,
      typo: null,
    });
    expect(ai.generateStructuredJson).not.toHaveBeenCalled();
    expect(counter.value).toBe(0);
  });

  it('counts a typo as right and says which word', async () => {
    const { check, ai } = setup();
    const out = await check(501, 'My mother is a teachr', id(2));
    expect(out.verdict).toBe('CORRECT');
    expect(out.typo).toEqual({ typed: 'teachr', expected: 'teacher' });
    expect(out.explanation).toContain('teacher');
    expect(ai.generateStructuredJson).not.toHaveBeenCalled();
  });

  it('asks the AI for an answer that matches nothing, using one grading', async () => {
    const { check, ai, counter } = setup();
    ai.generateStructuredJson.mockResolvedValueOnce({
      text: aiReply('MINOR'),
      model: 'test',
    });
    const out = await check(501, 'My mother is teacher', id(3));
    expect(out).toMatchObject({
      verdict: 'MINOR',
      source: 'AI',
      score: 1,
      correctedSentence: 'My mother is a teacher.',
      errorTags: ['ARTICLE'],
      closest: 'My mother is a teacher.',
    });
    expect(out.diff?.reference.filter((w) => !w.ok).map((w) => w.text)).toEqual(
      ['a'],
    );
    expect(counter.value).toBe(1);
  });

  it('with no grading left compares with the answers only and leaves the count as used', async () => {
    const { check, ai, counter } = setup({ planLimitUsed: 10 });
    const out = await check(501, 'Mother my teacher', id(4));
    expect(out).toMatchObject({
      verdict: 'UNMATCHED',
      source: 'NO_AI',
      score: 0,
      quotaExhausted: true,
    });
    expect(out.explanation).toMatch(/hết lượt AI/);
    expect(ai.generateStructuredJson).not.toHaveBeenCalled();
    expect(counter.value).toBe(10);
  });

  it('gives the grading back and stores nothing when the AI fails', async () => {
    const { check, ai, counter, submissions } = setup();
    ai.generateStructuredJson.mockRejectedValue(new Error('timeout'));
    await expect(check(501, 'Mother my teacher', id(5))).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(ai.generateStructuredJson).toHaveBeenCalledTimes(2);
    expect(counter.value).toBe(0);
    expect(submissions).toHaveLength(0);
  });

  it('rejects an AI reply without a Vietnamese explanation', async () => {
    const { check, ai } = setup();
    ai.generateStructuredJson.mockResolvedValue({
      text: JSON.stringify({
        verdict: 'WRONG',
        correctedSentence: 'My mother is a teacher.',
        explanation: 'Missing article.',
        errorTags: [],
      }),
      model: 'test',
    });
    await expect(check(501, 'Mother my teacher', id(6))).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('returns the stored result for a repeated attempt id', async () => {
    const { check, ai } = setup();
    ai.generateStructuredJson.mockResolvedValueOnce({
      text: aiReply('WRONG'),
      model: 'test',
    });
    const first = await check(501, 'Mother my teacher', id(7));
    const again = await check(501, 'Mother my teacher', id(7));
    expect(again.verdict).toBe(first.verdict);
    expect(again.submissionId).toBe(first.submissionId);
    expect(ai.generateStructuredJson).toHaveBeenCalledTimes(1);
  });

  it('rewards the exercise once both sentences are checked', async () => {
    const { check, events } = setup();
    await check(501, 'My mother is a teacher.', id(8));
    expect(events.emit).not.toHaveBeenCalled();
    const out = await check(502, 'I have an older brother', id(9));
    expect(out.exercise).toMatchObject({
      answered: 2,
      total: 2,
      complete: true,
      percent: 100,
    });
    expect(events.emit).toHaveBeenCalledWith(
      'quiz.submitted',
      expect.objectContaining({ quizId: 40, score: 100 }),
    );
  });

  it('refuses a question that is not a translation sentence and an empty answer', async () => {
    const { check } = setup();
    await expect(check(999, 'Hello')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(check(501, '   ')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('never grades a translation sentence through the writing grader', async () => {
    const { service } = setup();
    await expect(
      service.submitWriting(
        40,
        7,
        'My mother is a teacher.',
        undefined,
        id(10),
        undefined,
        501,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sends hints and the tip, never the accepted answers, before a check', async () => {
    const { service } = setup();
    const details: any = await service.getQuizDetails(40, 7);
    expect(details.maxScore).toBe(2);
    expect(details.exercise.questions[0]).toMatchObject({
      taskType: 'SENTENCE_TRANSLATION',
      prompt: 'Mẹ tôi là giáo viên.',
      maxScore: 2,
      hints: [{ vi: 'giáo viên', en: 'teacher' }],
    });
    expect(JSON.stringify(details)).not.toContain('My mom is a teacher');
  });
});
