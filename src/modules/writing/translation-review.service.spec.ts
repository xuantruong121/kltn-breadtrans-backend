import { ConflictException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';

import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { TranslationReviewController } from './translation-review.controller';
import { TranslationReviewService } from './translation-review.service';

const content = (extra: Record<string, unknown> = {}) => ({
  taskType: 'SENTENCE_TRANSLATION',
  prompt: 'Mẹ tôi là giáo viên.',
  acceptedAnswers: ['My mother is a teacher.', 'My mom is a teacher.'],
  hints: [{ vi: 'giáo viên', en: 'teacher' }],
  grammarTip: 'Nghề nghiệp cần "a/an".',
  ...extra,
});

const check = (
  userId: number,
  answer: string,
  opts: {
    source?: string;
    verdict?: string;
    questionId?: number;
    at?: string;
  } = {},
) => ({
  userId,
  quizId: 91,
  submittedAt: new Date(opts.at ?? '2026-11-14T03:00:00Z'),
  results: [{ questionId: opts.questionId ?? 501 }],
  aiFeedback: JSON.stringify({
    rubricVersion: 'SENTENCE_TRANSLATION_V1',
    translation: {
      source: opts.source ?? 'AI',
      verdict: opts.verdict ?? 'CORRECT',
      answer,
      explanation: 'Câu dịch đúng nghĩa.',
    },
  }),
});

function setup(
  submissions: unknown[],
  questionContent: Record<string, unknown> | null = content(),
) {
  const update = jest.fn();
  const findUnique = jest
    .fn()
    .mockResolvedValue(questionContent ? { content: questionContent } : null);
  const prisma = {
    submission: { findMany: jest.fn().mockResolvedValue(submissions) },
    question: {
      findMany: jest.fn().mockResolvedValue(
        questionContent
          ? [
              {
                id: 501,
                content: questionContent,
                quiz: { title: 'Dịch câu: Gia đình (A1)' },
              },
            ]
          : [],
      ),
    },
    $transaction: jest.fn((cb: (tx: unknown) => unknown) =>
      cb({ question: { findUnique, update } }),
    ),
  };
  return { service: new TranslationReviewService(prisma as any), update };
}

describe('translation review queue', () => {
  it('lists AI-accepted answers that are not accepted answers yet, grouped and counted', async () => {
    const { service } = setup([
      check(1, 'My mother works as a teacher.'),
      check(2, 'my mother works as a teacher'),
      check(2, 'My mother works as a teacher.', { at: '2026-11-14T05:00:00Z' }),
      check(3, 'Mom is a teacher.'),
      // Not offered: graded by the answers, judged MINOR, or already accepted.
      check(4, 'Teacher mother', { source: 'MATCH' }),
      check(5, 'My mother is teacher', { verdict: 'MINOR' }),
      check(6, 'MY MOM IS A TEACHER'),
    ]);
    const out = await service.list({});
    expect(out.total).toBe(2);
    expect(out.data[0]).toMatchObject({
      questionId: 501,
      quizTitle: 'Dịch câu: Gia đình (A1)',
      prompt: 'Mẹ tôi là giáo viên.',
      answer: 'My mother works as a teacher.',
      key: 'my mother works as a teacher',
      count: 3,
      learners: 2,
      lastAt: new Date('2026-11-14T05:00:00Z'),
      explanation: 'Câu dịch đúng nghĩa.',
    });
    expect(out.data[1]).toMatchObject({
      answer: 'Mom is a teacher.',
      count: 1,
    });
  });

  it('leaves out an answer that was dismissed', async () => {
    const { service } = setup(
      [check(1, 'Mom is a teacher.')],
      content({ dismissedAnswers: ['mom is a teacher'] }),
    );
    expect((await service.list({})).total).toBe(0);
  });

  it('approving adds the answer and clears a dismissal', async () => {
    const { service, update } = setup(
      [],
      content({ dismissedAnswers: ['mom is a teacher'] }),
    );
    const out = await service.approve(501, ' Mom is a teacher. ');
    expect(out.acceptedAnswers).toEqual([
      'My mother is a teacher.',
      'My mom is a teacher.',
      'Mom is a teacher.',
    ]);
    expect(update.mock.calls[0][0].data.content).toMatchObject({
      dismissedAnswers: [],
      hints: [{ vi: 'giáo viên', en: 'teacher' }],
    });
  });

  it('refuses to approve an answer that already matches, or a missing sentence', async () => {
    await expect(
      setup([]).service.approve(501, 'my mom is a teacher'),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      setup([], null).service.approve(501, 'Mom is a teacher.'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('dismissing stores the normalised answer once', async () => {
    const first = setup([]);
    await first.service.dismiss(501, "Mom's a teacher!");
    expect(first.update.mock.calls[0][0].data.content.dismissedAnswers).toEqual(
      ["mom's a teacher"],
    );
    const again = setup([], content({ dismissedAnswers: ["mom's a teacher"] }));
    await again.service.dismiss(501, "mom's a teacher");
    expect(again.update).not.toHaveBeenCalled();
  });

  it('is for admins only', () => {
    const roles = new Reflector().get<Role[]>(
      ROLES_KEY,
      TranslationReviewController,
    );
    expect(roles).toEqual([Role.ADMIN]);
  });
});
