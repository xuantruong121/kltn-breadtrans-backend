import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { WritingService } from './writing.service';

const content = {
  taskType: 'SENTENCE_TRANSLATION',
  prompt: 'Mẹ tôi là giáo viên.',
  acceptedAnswers: ['My mother is a teacher.', 'My mom is a teacher.'],
  hints: [{ vi: 'giáo viên', en: 'teacher' }],
  grammarTip: 'Nói nghề nghiệp cần "a/an" trước tên nghề.',
};

function setup(opts: { used?: number; question?: unknown } = {}) {
  const counter = { value: opts.used ?? 0 };
  const redis = {
    incr: jest.fn(() => Promise.resolve(++counter.value)),
    decr: jest.fn(() => Promise.resolve(--counter.value)),
    expire: jest.fn().mockResolvedValue(1),
  };
  const prisma = {
    question: {
      findFirst: jest
        .fn()
        .mockResolvedValue('question' in opts ? opts.question : { content }),
    },
    submission: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  const ai = { generateStructuredJson: jest.fn() };
  const mistakes = {
    translationReviewTarget: jest
      .fn()
      .mockResolvedValue({ id: 9, questionId: 501, quizId: 91 }),
    recordTranslationReview: jest.fn(
      (_u: number, id: number, correct: boolean) =>
        Promise.resolve({
          id,
          correct,
          correctStreak: correct ? 1 : 0,
          resolved: false,
          resolveAfterCorrect: 2,
        }),
    ),
  };
  const service = new WritingService(
    prisma as any,
    ai as any,
    undefined,
    undefined,
    undefined,
    { planCodeFor: jest.fn().mockResolvedValue('FREE') } as any,
    redis as any,
    mistakes as any,
  );
  return { service, prisma, ai, mistakes, counter };
}

describe('Dịch câu review from the mistake notebook', () => {
  it('an accepted answer is right without the AI and moves the streak on', async () => {
    const { service, ai, mistakes, counter, prisma } = setup();
    const out = await service.reviewTranslationMistake(
      10,
      9,
      'my mom is a teacher',
    );
    expect(out).toMatchObject({
      correct: true,
      correctStreak: 1,
      check: { verdict: 'CORRECT', source: 'MATCH' },
    });
    expect(mistakes.recordTranslationReview).toHaveBeenCalledWith(10, 9, true);
    expect(ai.generateStructuredJson).not.toHaveBeenCalled();
    expect(counter.value).toBe(0);
    // Nothing is stored as an exercise submission.
    expect(prisma.submission.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('another answer goes to the AI and a MINOR grade counts as wrong', async () => {
    const { service, ai, mistakes, counter } = setup();
    ai.generateStructuredJson.mockResolvedValueOnce({
      model: 'test',
      text: JSON.stringify({
        verdict: 'MINOR',
        correctedSentence: 'My mother is a teacher.',
        explanation: 'Thiếu mạo từ "a" trước "teacher".',
        errorTags: ['ARTICLE'],
      }),
    });
    const out = await service.reviewTranslationMistake(
      10,
      9,
      'My mother is teacher',
    );
    expect(out).toMatchObject({ correct: false, check: { verdict: 'MINOR' } });
    expect(mistakes.recordTranslationReview).toHaveBeenCalledWith(10, 9, false);
    expect(counter.value).toBe(1);
  });

  it('with no grading left compares with the answers only', async () => {
    const { service, ai } = setup({ used: 10 });
    const out = await service.reviewTranslationMistake(
      10,
      9,
      'Mother my teacher',
    );
    expect(out.check).toMatchObject({
      verdict: 'UNMATCHED',
      quotaExhausted: true,
    });
    expect(out.correct).toBe(false);
    expect(ai.generateStructuredJson).not.toHaveBeenCalled();
  });

  it('records nothing and gives the grading back when the AI fails', async () => {
    const { service, ai, mistakes, counter } = setup();
    ai.generateStructuredJson.mockRejectedValue(new Error('timeout'));
    await expect(
      service.reviewTranslationMistake(10, 9, 'Mother my teacher'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(mistakes.recordTranslationReview).not.toHaveBeenCalled();
    expect(counter.value).toBe(0);
  });

  it('refuses an empty answer and a sentence that no longer exists', async () => {
    await expect(
      setup().service.reviewTranslationMistake(10, 9, '  '),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      setup({ question: null }).service.reviewTranslationMistake(10, 9, 'x'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
