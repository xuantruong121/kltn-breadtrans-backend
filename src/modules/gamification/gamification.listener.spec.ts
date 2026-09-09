import { GamificationListener } from './gamification.listener';
import { GamificationService } from './gamification.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('GamificationListener', () => {
  it('caps vocabulary quest progress and completes a target-10 quest for 20 words', async () => {
    const txMock = {
      userQuestProgress: {
        upsert: jest.fn().mockResolvedValue({
          id: 7,
          currentValue: 0,
          isCompleted: false,
        }),
        findUnique: jest.fn().mockResolvedValue({
          id: 7,
          currentValue: 0,
          isCompleted: false,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };

    const prismaMock = {
      dailyQuest: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 3,
            type: 'LEARN_VOCAB',
            targetValue: 10,
            rewardXP: 15,
            rewardBanh: 5,
            title: 'Học 10 từ vựng',
          },
        ]),
      },
      userStats: {
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      $transaction: jest.fn(
        async (
          callback: (tx: typeof txMock) => Promise<unknown>,
        ): Promise<unknown> => callback(txMock),
      ),
    };

    const gamificationServiceMock = {
      addPoints: jest.fn().mockResolvedValue({}),
    } as unknown as GamificationService;
    const listener = new GamificationListener(
      prismaMock as unknown as PrismaService,
      gamificationServiceMock,
    );

    await listener.handleVocabLearnedEvent({
      userId: 11,
      count: 20,
      source: 'vocabulary_review',
    });

    expect(txMock.userQuestProgress.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: {
        currentValue: 10,
        isCompleted: true,
        completedAt: expect.any(Date),
      },
    });
    expect(gamificationServiceMock.addPoints).toHaveBeenCalledWith(
      11,
      15,
      'Hoàn thành nhiệm vụ: Học 10 từ vựng',
    );
  });
});
