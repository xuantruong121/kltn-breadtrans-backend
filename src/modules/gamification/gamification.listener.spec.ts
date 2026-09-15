import { GamificationListener } from './gamification.listener';
import { GamificationService } from './gamification.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('GamificationListener', () => {
  let prismaMock: {
    dailyQuest: { findMany: jest.Mock };
    badge: { findFirst: jest.Mock };
    userBadge: { findUnique: jest.Mock; create: jest.Mock };
    userStats: { findUnique: jest.Mock; update: jest.Mock; create: jest.Mock };
    dailyBanhEarning: { findUnique: jest.Mock; upsert: jest.Mock };
  };
  let gamificationServiceMock: {
    awardXp: jest.Mock;
    awardBanh: jest.Mock;
    awardVocabMasteryReward: jest.Mock;
    awardSpeakingReward: jest.Mock;
    awardToeicReward: jest.Mock;
    awardBadgeIfEarned: jest.Mock;
    advanceDailyQuestAndGrantRewardsTx: jest.Mock;
  };
  let listener: GamificationListener;

  beforeEach(() => {
    prismaMock = {
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
      badge: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      userBadge: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      userStats: {
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      dailyBanhEarning: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };

    gamificationServiceMock = {
      awardXp: jest.fn().mockResolvedValue({ totalPoints: 100 }),
      awardBanh: jest.fn().mockResolvedValue({ granted: 5, newBalance: 15 }),
      awardVocabMasteryReward: jest.fn().mockResolvedValue({ granted: 1 }),
      awardSpeakingReward: jest.fn().mockResolvedValue({ granted: 5 }),
      awardToeicReward: jest.fn().mockResolvedValue({ granted: 120 }),
      awardBadgeIfEarned: jest.fn().mockResolvedValue(true),
      advanceDailyQuestAndGrantRewardsTx: jest.fn().mockResolvedValue({
        completedNow: true,
        currentValue: 10,
      }),
    };

    listener = new GamificationListener(
      prismaMock as unknown as PrismaService,
      gamificationServiceMock as unknown as GamificationService,
    );
  });

  describe('handleVocabLearnedEvent', () => {
    it('advances quest progress via advanceDailyQuestAndGrantRewardsTx', async () => {
      await listener.handleVocabLearnedEvent({
        userId: 11,
        count: 10,
        wordId: 101,
        source: 'vocabulary_review',
      });

      expect(gamificationServiceMock.awardXp).toHaveBeenCalledWith(
        11,
        50,
        'Học 10 từ vựng mới',
      );
      expect(
        gamificationServiceMock.awardVocabMasteryReward,
      ).toHaveBeenCalledWith(11, 101);
      expect(
        gamificationServiceMock.advanceDailyQuestAndGrantRewardsTx,
      ).toHaveBeenCalledWith(
        11,
        expect.objectContaining({ id: 3, type: 'LEARN_VOCAB' }),
        10,
        expect.any(String),
      );
    });

    it('grants zero Bánh Mì if wordId is missing', async () => {
      await listener.handleVocabLearnedEvent({
        userId: 11,
        count: 5,
        source: 'legacy_call',
      });

      expect(gamificationServiceMock.awardXp).toHaveBeenCalledWith(
        11,
        25,
        'Học 5 từ vựng mới',
      );
      expect(
        gamificationServiceMock.awardVocabMasteryReward,
      ).not.toHaveBeenCalled();
      expect(gamificationServiceMock.awardBanh).not.toHaveBeenCalled();
    });
  });

  describe('handleQuizCompletedEvent', () => {
    it('calculates score 70 as 105 Bánh Mì and delegates quest progression', async () => {
      prismaMock.dailyQuest.findMany.mockResolvedValueOnce([
        {
          id: 5,
          type: 'COMPLETE_QUIZ',
          targetValue: 1,
          rewardXP: 20,
          rewardBanh: 10,
          title: 'Hoàn thành bài kiểm tra',
        },
      ]);

      await listener.handleQuizSubmittedEvent({
        userId: 12,
        quizId: 44,
        score: 70,
        isFirstSubmission: true,
      });

      expect(gamificationServiceMock.awardXp).toHaveBeenCalledWith(
        12,
        700,
        'Hoàn thành bài thi (Quiz)',
      );
      // Math.round(70 * 1.5) = 105 Bánh Mì, capped at 150
      expect(gamificationServiceMock.awardBanh).toHaveBeenCalledWith(
        12,
        105,
        'QUIZ_FIRST_COMPLETION',
        'quiz:44',
        expect.objectContaining({ isCapped: true }),
      );
      expect(
        gamificationServiceMock.advanceDailyQuestAndGrantRewardsTx,
      ).toHaveBeenCalledWith(
        12,
        expect.objectContaining({ id: 5 }),
        1,
        expect.any(String),
      );
    });
  });

  describe('handleSpeakingSubmittedEvent', () => {
    it('awards speaking Bánh Mì with submissionId and advances quest', async () => {
      prismaMock.dailyQuest.findMany.mockResolvedValueOnce([
        {
          id: 9,
          type: 'DO_SPEAKING',
          targetValue: 1,
          rewardXP: 10,
          rewardBanh: 5,
          title: 'Luyện nói AI',
        },
      ]);

      await listener.handleSpeakingSubmittedEvent({
        userId: 15,
        submissionId: 99,
        exerciseId: 1,
        overallScore: 85,
        isSilentOrNoSpeech: false,
      });

      expect(gamificationServiceMock.awardXp).toHaveBeenCalled();
      expect(gamificationServiceMock.awardSpeakingReward).toHaveBeenCalledWith(
        15,
        99,
        85,
      );
      expect(
        gamificationServiceMock.advanceDailyQuestAndGrantRewardsTx,
      ).toHaveBeenCalledWith(
        15,
        expect.objectContaining({ id: 9 }),
        1,
        expect.any(String),
      );
    });
  });

  describe('handleToeicSubmittedEvent', () => {
    it('delegates to awardToeicReward with examId and mode', async () => {
      await listener.handleToeicSubmittedEvent({
        userId: 18,
        examId: 2,
        mode: 'FULL_TEST',
        attemptId: 42,
      });

      expect(gamificationServiceMock.awardToeicReward).toHaveBeenCalledWith(
        18,
        2,
        'FULL_TEST',
        42,
      );
    });
  });
});
