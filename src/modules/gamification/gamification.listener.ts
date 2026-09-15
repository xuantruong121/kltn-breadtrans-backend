import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { GamificationService, getTodayDateKey } from './gamification.service';

@Injectable()
export class GamificationListener {
  private readonly logger = new Logger(GamificationListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gamificationService: GamificationService,
  ) {}

  @OnEvent('quiz.submitted')
  async handleQuizSubmittedEvent(payload: {
    userId: number;
    quizId?: number;
    score: number;
    isFirstSubmission?: boolean;
  }) {
    this.logger.log(
      `Handling quiz.submitted event for user ${payload.userId} with score ${payload.score} (firstSubmission: ${payload.isFirstSubmission})`,
    );

    try {
      // XP only for first submission
      const xpEarned =
        payload.isFirstSubmission === false ? 0 : payload.score * 10;

      if (xpEarned > 0) {
        const leaderboard = await this.gamificationService.awardXp(
          payload.userId,
          xpEarned,
          'Hoàn thành bài thi (Quiz)',
        );

        // Banh only for first submission (idempotent via quizId)
        if (payload.quizId && payload.isFirstSubmission !== false) {
          const banhReward = Math.min(
            40,
            Math.max(10, Math.round(payload.score * 0.4)),
          );
          if (banhReward > 0) {
            await this.gamificationService.awardBanh(
              payload.userId,
              banhReward,
              'QUIZ_FIRST_COMPLETION',
              `quiz:${payload.quizId}`,
              { isCapped: true, metadata: { score: payload.score } },
            );
          }
        }

        // Badge: 100 points total
        const firstBadge = await this.prisma.badge.findFirst({
          where: { name: 'Thợ săn điểm số' },
        });
        if (firstBadge && leaderboard && leaderboard.totalPoints >= 100) {
          const userBadgeExists = await this.prisma.userBadge.findUnique({
            where: {
              userId_badgeId: {
                userId: payload.userId,
                badgeId: firstBadge.id,
              },
            },
          });
          if (!userBadgeExists) {
            await this.prisma.userBadge.create({
              data: {
                userId: payload.userId,
                badgeId: firstBadge.id,
              },
            });
            this.logger.log(
              `Awarded badge ${firstBadge.name} to user ${payload.userId}`,
            );
          }
        }

        // Badge: perfect score
        if (payload.score === 100) {
          await this.gamificationService.awardBadgeIfEarned(
            payload.userId,
            'Học Bá',
          );
        }
      }

      // Daily quest progress (atomic & capped)
      const today = getTodayDateKey('Asia/Ho_Chi_Minh');
      const activeQuests = await this.prisma.dailyQuest.findMany({
        where: {
          isActive: true,
          type: {
            in: ['COMPLETE_QUIZ', 'DO_LISTENING', 'PERFECT_QUIZ'],
          },
        },
      });

      for (const quest of activeQuests) {
        if (quest.type === 'PERFECT_QUIZ' && payload.score < 100) {
          continue;
        }

        await this.gamificationService.advanceDailyQuestAndGrantRewardsTx(
          payload.userId,
          quest,
          1,
          today,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to handle gamification for user ${payload.userId}`,
        error,
      );
    }
  }

  @OnEvent('speaking.submitted')
  async handleSpeakingSubmittedEvent(payload: {
    userId: number;
    submissionId?: number;
    exerciseId?: number;
    overallScore: number;
    isSilentOrNoSpeech?: boolean;
  }) {
    this.logger.log(
      `Handling speaking.submitted event for user ${payload.userId} with score ${payload.overallScore} (submissionId: ${payload.submissionId})`,
    );

    try {
      if (payload.isSilentOrNoSpeech) return;

      // XP for speaking practice (min 10, max 50)
      const xpEarned = Math.max(10, Math.round(payload.overallScore * 5));
      if (xpEarned > 0) {
        await this.gamificationService.awardXp(
          payload.userId,
          xpEarned,
          'Hoàn thành bài luyện nói',
        );
      }

      // Bánh Mì for speaking (atomic 3/day quota, idempotent per submissionId)
      if (payload.submissionId) {
        await this.gamificationService.awardSpeakingReward(
          payload.userId,
          payload.submissionId,
          payload.overallScore,
        );
      }

      // Badge: high speaking score
      if (payload.overallScore >= 80) {
        await this.gamificationService.awardBadgeIfEarned(
          payload.userId,
          'Giọng Đọc Vàng',
        );
      }

      // Daily quest progress for DO_SPEAKING (atomic & capped)
      const today = getTodayDateKey('Asia/Ho_Chi_Minh');
      const activeQuests = await this.prisma.dailyQuest.findMany({
        where: {
          isActive: true,
          type: { in: ['DO_SPEAKING', 'PRACTICE_SPEAKING'] },
        },
      });

      for (const quest of activeQuests) {
        await this.gamificationService.advanceDailyQuestAndGrantRewardsTx(
          payload.userId,
          quest,
          1,
          today,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to handle speaking gamification for user ${payload.userId}`,
        error,
      );
    }
  }

  @OnEvent('vocab.learned')
  async handleVocabLearnedEvent(payload: {
    userId: number;
    count: number;
    wordId?: number;
    wordIds?: number[];
    source?: string;
  }) {
    this.logger.log(`Handling vocab.learned event for user ${payload.userId}`);
    try {
      const count = Number.isFinite(payload.count)
        ? Math.max(0, Math.trunc(payload.count))
        : 0;
      if (count === 0) return;

      // Collect wordIds for lifetime first-mastery guard
      const wordIds: number[] = [];
      if (typeof payload.wordId === 'number') {
        wordIds.push(payload.wordId);
      }
      if (Array.isArray(payload.wordIds)) {
        for (const id of payload.wordIds) {
          if (typeof id === 'number' && !wordIds.includes(id)) {
            wordIds.push(id);
          }
        }
      }

      // Safe guard: Never reward unidentified vocabulary events.
      if (wordIds.length === 0) {
        this.logger.warn(
          `[vocab.learned] Missing wordId for user ${payload.userId}. No Bánh Mì awarded.`,
        );
        return;
      } else {
        let firstMasteryCount = 0;
        for (const wordId of wordIds) {
          const reward = await this.gamificationService.awardVocabMasteryReward(
            payload.userId,
            wordId,
          );
          if (reward.firstMastery) firstMasteryCount += 1;
        }

        // A word contributes EXP and a daily quest only once in its lifetime.
        if (firstMasteryCount === 0) return;

        await this.gamificationService.awardXp(
          payload.userId,
          firstMasteryCount * 5,
          `Học ${firstMasteryCount} từ vựng mới`,
        );

        // Advance daily quests with the exact number of first masteries.
        const today = getTodayDateKey('Asia/Ho_Chi_Minh');
        const activeQuests = await this.prisma.dailyQuest.findMany({
          where: { isActive: true, type: { in: ['LEARN_VOCAB', 'DO_VOCAB'] } },
        });

        for (const quest of activeQuests) {
          await this.gamificationService.advanceDailyQuestAndGrantRewardsTx(
            payload.userId,
            quest,
            firstMasteryCount,
            today,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to handle vocab.learned for user ${payload.userId}`,
        error,
      );
    }
  }

  @OnEvent('gamification.xp_earned')
  async handleXpEarnedEvent(payload: { userId: number; points: number }) {
    if (payload.points <= 0) return;
    this.logger.log(
      `Handling gamification.xp_earned event for user ${payload.userId}`,
    );
    try {
      const today = getTodayDateKey('Asia/Ho_Chi_Minh');
      const activeQuests = await this.prisma.dailyQuest.findMany({
        where: { isActive: true, type: 'EARN_XP' },
      });

      for (const quest of activeQuests) {
        await this.gamificationService.advanceDailyQuestAndGrantRewardsTx(
          payload.userId,
          quest,
          payload.points,
          today,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to handle gamification.xp_earned for user ${payload.userId}`,
        error,
      );
    }
  }

  @OnEvent('toeic.submitted')
  async handleToeicSubmittedEvent(payload: {
    userId: number;
    examId: number;
    mode: string;
    attemptId?: number;
  }) {
    this.logger.log(
      `Handling toeic.submitted event for user ${payload.userId} (examId: ${payload.examId}, mode: ${payload.mode})`,
    );
    try {
      await this.gamificationService.awardToeicReward(
        payload.userId,
        payload.examId,
        payload.mode,
        payload.attemptId,
      );
    } catch (error) {
      this.logger.error(
        `Failed to handle toeic.submitted for user ${payload.userId}`,
        error,
      );
    }
  }
}
