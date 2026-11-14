import { BadRequestException } from '@nestjs/common';

import {
  reviewQuestion,
  writingObservations,
  type MistakeDetail,
} from './mistake-extract.logic';
import { MistakesService } from './mistakes.service';

const at = new Date('2026-11-14T02:00:00Z');

const submission = (verdict: string, extra: Record<string, unknown> = {}) => ({
  id: 70,
  submittedAt: at,
  quiz: { id: 91, type: 'WRITING_PICTURE', title: 'Dịch câu: Gia đình (A1)' },
  questions: [
    { id: 501, content: { prompt: 'Mẹ tôi là giáo viên.' } },
    { id: 502, content: { prompt: 'Tôi có một người anh trai.' } },
  ],
  results: [{ questionId: 501 }],
  aiFeedback: JSON.stringify({
    rubricVersion: 'SENTENCE_TRANSLATION_V1',
    translation: {
      verdict,
      answer: 'My mother is teacher',
      closest: 'My mother is a teacher.',
      explanation: 'Thiếu mạo từ "a" trước "teacher".',
      grammarTip: 'Nghề nghiệp cần "a/an".',
      ...extra,
    },
  }),
});

describe('Dịch câu in the mistake notebook', () => {
  it('opens a sentence that was not translated right, with its Vietnamese sentence and the answer', () => {
    for (const verdict of ['MINOR', 'WRONG', 'UNMATCHED']) {
      const obs = writingObservations(submission(verdict));
      expect(obs).toEqual([
        {
          sourceType: 'TRANSLATION_SENTENCE',
          itemKey: 'q:501',
          skill: 'WRITING',
          tag: 'Dịch câu: Gia đình (A1)',
          outcome: 'WRONG',
          at,
          detail: {
            kind: 'TRANSLATION',
            title: 'Dịch câu: Gia đình (A1)',
            question: 'Mẹ tôi là giáo viên.',
            yourAnswer: 'My mother is teacher',
            correctAnswer: 'My mother is a teacher.',
            explanation: 'Thiếu mạo từ "a" trước "teacher".',
            answerable: true,
            ref: { quizId: 91, submissionId: 70, questionId: 501 },
          },
        },
      ]);
    }
  });

  it('counts a right translation toward closing the same sentence', () => {
    expect(writingObservations(submission('CORRECT'))).toEqual([
      expect.objectContaining({
        sourceType: 'TRANSLATION_SENTENCE',
        itemKey: 'q:501',
        outcome: 'CORRECT',
      }),
    ]);
  });

  it('falls back to the grammar tip when there is no explanation, and skips a check without a sentence', () => {
    const obs = writingObservations(submission('WRONG', { explanation: null }));
    expect(obs[0].detail?.explanation).toBe('Nghề nghiệp cần "a/an".');
    expect(
      writingObservations({ ...submission('WRONG'), results: [] }),
    ).toEqual([]);
  });

  it('shows a translation review item with its sentence only', () => {
    const detail = writingObservations(submission('WRONG'))[0]
      .detail as MistakeDetail;
    expect(reviewQuestion(9, 'WRITING', detail)).toEqual({
      id: 9,
      skill: 'WRITING',
      title: 'Dịch câu: Gia đình (A1)',
      quizId: 91,
      topicId: null,
      question: 'Mẹ tôi là giáo viên.',
      passage: null,
      options: [],
      kind: 'TRANSLATION',
    });
  });

  describe('MistakesService translation review', () => {
    const detail = writingObservations(submission('WRONG'))[0]
      .detail as MistakeDetail;
    const row = {
      id: 9,
      userId: 10,
      sourceType: 'TRANSLATION_SENTENCE',
      wrongCount: 1,
      correctStreak: 0,
      resolvedAt: null,
      detail,
    };
    const setup = (r: Record<string, unknown>) => {
      const prisma = {
        learnerMistake: {
          findFirst: jest.fn().mockResolvedValue(r),
          update: jest.fn(),
        },
      };
      return { prisma, service: new MistakesService(prisma as any) };
    };

    it('names the sentence behind the mistake', async () => {
      expect(await setup(row).service.translationReviewTarget(10, 9)).toEqual({
        id: 9,
        questionId: 501,
        quizId: 91,
      });
    });

    it('refuses a mistake that is not a translation', async () => {
      await expect(
        setup({
          ...row,
          sourceType: 'QUIZ_QUESTION',
          detail: { ...detail, kind: 'CHOICE' },
        }).service.translationReviewTarget(10, 9),
      ).rejects.toThrow(BadRequestException);
    });

    it('two right reviews in a row close it; a wrong one starts again', async () => {
      expect(
        await setup(row).service.recordTranslationReview(10, 9, true),
      ).toMatchObject({ correct: true, correctStreak: 1, resolved: false });
      expect(
        await setup({
          ...row,
          correctStreak: 1,
        }).service.recordTranslationReview(10, 9, true),
      ).toMatchObject({ correctStreak: 2, resolved: true });
      const wrong = setup({ ...row, correctStreak: 1 });
      expect(
        await wrong.service.recordTranslationReview(10, 9, false),
      ).toMatchObject({ correct: false, correctStreak: 0, resolved: false });
      expect(wrong.prisma.learnerMistake.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ wrongCount: 2, correctStreak: 0 }),
        }),
      );
    });

    it('the choice answer still refuses a translation item', async () => {
      await expect(setup(row).service.answer(10, 9, 0)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
