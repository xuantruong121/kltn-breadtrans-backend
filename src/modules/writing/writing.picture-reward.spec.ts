import { QuizType } from '@prisma/client';

import { WritingService } from './writing.service';

/**
 * Each picture of "Viết câu theo tranh" is its own exercise (owner
 * 2026-11-24): its first grade pays a fifth of a set, a regrade pays
 * nothing, and a set already rewarded under the earlier rule pays its
 * pictures nothing. Email and Dịch câu keep the set rule.
 */
function setup(options: { setRewarded?: boolean } = {}) {
  let nextId = 500;
  const pictureRewards = new Set<string>();
  const activityTitles: string[] = [];
  const tx = {
    submission: {
      create: jest.fn(() => Promise.resolve({ id: nextId++ })),
    },
    learningActivity: {
      create: jest.fn(({ data }: any) => {
        activityTitles.push(data.title);
        return Promise.resolve({});
      }),
    },
  };
  const prisma = {
    $transaction: jest.fn((cb: (t: any) => unknown) => cb(tx)),
    userQuizReward: {
      findUnique: jest
        .fn()
        .mockResolvedValue(options.setRewarded ? { id: 1 } : null),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    userQuestionReward: {
      createMany: jest.fn(({ data }: any) => {
        const key = `${data.userId}:${data.questionId}`;
        const count = pictureRewards.has(key) ? 0 : 1;
        pictureRewards.add(key);
        return Promise.resolve({ count });
      }),
    },
  };
  const events = { emit: jest.fn() };
  const service = new WritingService(
    prisma as any,
    {} as any,
    undefined,
    events as any,
  );
  const grade = (questionId: number, score: number) =>
    (service as any).persistAssessment({
      quizId: 124,
      quizTitle: 'Viết câu theo tranh: mua sắm và đi lại (A2)',
      quizType: QuizType.WRITING_PICTURE,
      questionId,
      userId: 7,
      answer: 'Cyclists ride down the street.',
      clientAttemptId: `attempt-${nextId}`,
      evaluation: { score, feedback: 'Tốt.', suggestions: [] },
      maxScore: 10,
      exercise: { questionIds: [466, 467, 468, 469, 470], position: 5 },
      picture: { keywords: ['ride', 'street'] },
    });
  return { grade, events, prisma, activityTitles };
}

describe('picture task reward', () => {
  it('pays a picture on its first grade, a fifth of a set', async () => {
    const { grade, events, activityTitles } = setup();
    await grade(470, 8);
    expect(events.emit).toHaveBeenCalledWith(
      'quiz.submitted',
      expect.objectContaining({
        quizId: 124,
        questionId: 470,
        score: 80,
        xp: 16,
        banh: 6,
        rewardRef: 'quiz:124:q:470',
        isFirstSubmission: true,
      }),
    );
    expect(activityTitles).toEqual(['Viết câu theo tranh: ride, street']);
  });

  it('a regrade still counts for the quests but pays nothing', async () => {
    const { grade, events } = setup();
    await grade(470, 8);
    await grade(470, 10);
    expect(events.emit).toHaveBeenCalledTimes(2);
    expect(events.emit).toHaveBeenLastCalledWith(
      'quiz.submitted',
      expect.objectContaining({ questionId: 470, isFirstSubmission: false }),
    );
  });

  it('another picture of the same set is paid on its own', async () => {
    const { grade, events } = setup();
    await grade(470, 8);
    await grade(469, 6);
    expect(events.emit).toHaveBeenLastCalledWith(
      'quiz.submitted',
      expect.objectContaining({ questionId: 469, isFirstSubmission: true }),
    );
  });

  it('a set already rewarded under the earlier rule pays its pictures nothing', async () => {
    const { grade, events, prisma } = setup({ setRewarded: true });
    await grade(468, 9);
    expect(prisma.userQuestionReward.createMany).not.toHaveBeenCalled();
    expect(events.emit).toHaveBeenCalledWith(
      'quiz.submitted',
      expect.objectContaining({ isFirstSubmission: false }),
    );
  });

  it('never writes the set reward for a picture', async () => {
    const { grade, prisma } = setup();
    await grade(470, 8);
    expect(prisma.userQuizReward.createMany).not.toHaveBeenCalled();
  });
});
