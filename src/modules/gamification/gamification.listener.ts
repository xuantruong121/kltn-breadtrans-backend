import { Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Prisma, QuizType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GamificationService, getTodayDateKey } from './gamification.service';

@Injectable()
export class GamificationListener {
  private readonly logger = new Logger(GamificationListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gamificationService: GamificationService,
    @Optional() private readonly eventEmitter?: EventEmitter2,
  ) {}

  @OnEvent('quiz.submitted')
  async handleQuizSubmittedEvent(payload: {
    userId: number;
    quizId?: number;
    score: number;
    quizType?: QuizType | (string & {});
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
        if (
          quest.type === 'DO_LISTENING' &&
          payload.quizType !== QuizType.LISTENING_PRACTICE
        ) {
          continue;
        }
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

  private isUniqueConstraint(err: unknown): boolean {
    const errorObj = err as { code?: string; message?: string } | null;
    return (
      errorObj?.code === 'P2002' ||
      (typeof errorObj?.message === 'string' &&
        errorObj.message.includes('Unique constraint'))
    );
  }

  private async executeRewardEffect(
    submissionId: number | undefined,
    userId: number,
    rewardType: string,
    reference: string,
    effectFn: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<boolean> {
    if (!submissionId) {
      await effectFn(this.prisma);
      return true;
    }

    const runWithTx = async (tx: Prisma.TransactionClient) => {
      const txWithLedger = tx as unknown as {
        speakingRewardLedger?: {
          create: (args: {
            data: {
              submissionId: number;
              userId: number;
              rewardType: string;
              reference: string;
            };
          }) => Promise<unknown>;
        };
      };
      if (
        txWithLedger.speakingRewardLedger &&
        typeof txWithLedger.speakingRewardLedger.create === 'function'
      ) {
        await txWithLedger.speakingRewardLedger.create({
          data: {
            submissionId,
            userId,
            rewardType,
            reference,
          },
        });
      }
      await effectFn(tx);
    };

    try {
      if (typeof this.prisma.$transaction === 'function') {
        await this.prisma.$transaction(runWithTx);
      } else {
        await runWithTx(this.prisma);
      }
      return true;
    } catch (err: unknown) {
      if (this.isUniqueConstraint(err)) {
        this.logger.log(
          `Reward effect ${rewardType} already processed for submission #${submissionId} (${reference}). Skipping.`,
        );
        return false;
      }
      throw err;
    }
  }

  @OnEvent('speaking.submitted')
  async handleSpeakingSubmittedEvent(
    payload: {
      userId: number;
      submissionId?: number;
      exerciseId?: number;
      overallScore: number;
      isSilentOrNoSpeech?: boolean;
    },
    options: { rethrow?: boolean } = {},
  ) {
    this.logger.log(
      `Handling speaking.submitted event for user ${payload.userId} with score ${payload.overallScore} (submissionId: ${payload.submissionId})`,
    );

    try {
      if (payload.isSilentOrNoSpeech) return;

      // 1. XP for speaking practice (min 10, max 50) - atomic per submission
      const xpEarned = Math.max(10, Math.round(payload.overallScore * 5));
      if (xpEarned > 0) {
        const xpReason = payload.submissionId
          ? `Hoàn thành bài luyện nói #${payload.submissionId}`
          : 'Hoàn thành bài luyện nói';
        const xpRef = payload.submissionId
          ? `xp:speaking:${payload.submissionId}`
          : xpReason;

        const awarded = await this.executeRewardEffect(
          payload.submissionId,
          payload.userId,
          'XP',
          xpRef,
          async (tx) => {
            const alreadyAwarded = payload.submissionId
              ? await tx.pointHistory.findFirst({
                  where: { userId: payload.userId, reason: xpReason },
                  select: { id: true },
                })
              : null;
            if (!alreadyAwarded) {
              await this.gamificationService.awardXp(
                payload.userId,
                xpEarned,
                xpReason,
                { tx },
              );
            }
          },
        );
        if (awarded && this.eventEmitter) {
          this.eventEmitter.emit('gamification.xp_earned', {
            userId: payload.userId,
            points: xpEarned,
          });
        }
      }

      // 2. Bánh Mì for speaking (atomic 3/day quota, idempotent per submissionId)
      if (payload.submissionId) {
        const banhRef = `banh:speaking:${payload.submissionId}`;
        await this.executeRewardEffect(
          payload.submissionId,
          payload.userId,
          'BANH',
          banhRef,
          async (tx) => {
            await this.gamificationService.awardSpeakingReward(
              payload.userId,
              payload.submissionId!,
              payload.overallScore,
              { tx },
            );
          },
        );
      }

      // 3. Badge: high speaking score - atomic and conditional on eligibility & unowned
      const isBadgeEligible =
        payload.overallScore >= 80 ||
        (payload.overallScore <= 10 && payload.overallScore >= 8.0);
      if (isBadgeEligible) {
        const badge =
          this.prisma.badge && typeof this.prisma.badge.findFirst === 'function'
            ? await this.prisma.badge.findFirst({
                where: { name: 'Giọng Đọc Vàng' },
              })
            : null;
        if (badge) {
          const alreadyOwned =
            this.prisma.userBadge &&
            typeof this.prisma.userBadge.findUnique === 'function'
              ? await this.prisma.userBadge.findUnique({
                  where: {
                    userId_badgeId: {
                      userId: payload.userId,
                      badgeId: badge.id,
                    },
                  },
                })
              : null;
          if (!alreadyOwned) {
            const badgeRef = payload.submissionId
              ? `badge:${badge.id}:speaking:${payload.submissionId}`
              : `badge:${badge.id}:speaking:${payload.userId}:gold`;

            await this.executeRewardEffect(
              payload.submissionId,
              payload.userId,
              'BADGE',
              badgeRef,
              async (tx) => {
                await this.gamificationService.awardBadgeIfEarned(
                  payload.userId,
                  'Giọng Đọc Vàng',
                  { tx },
                );
              },
            );
          }
        }
      }

      // 4. Daily quest progress for DO_SPEAKING / PRACTICE_SPEAKING (atomic per quest)
      const today = getTodayDateKey('Asia/Ho_Chi_Minh');
      const activeQuests =
        this.prisma.dailyQuest &&
        typeof this.prisma.dailyQuest.findMany === 'function'
          ? await this.prisma.dailyQuest.findMany({
              where: {
                isActive: true,
                type: { in: ['DO_SPEAKING', 'PRACTICE_SPEAKING'] },
              },
            })
          : [];

      for (const quest of activeQuests) {
        if (quest.type === 'PERFECT_QUIZ' && payload.overallScore < 100) {
          continue;
        }

        const existingProgress =
          this.prisma.userQuestProgress &&
          typeof this.prisma.userQuestProgress.findUnique === 'function'
            ? await this.prisma.userQuestProgress.findUnique({
                where: {
                  userId_questId_dateKey: {
                    userId: payload.userId,
                    questId: quest.id,
                    dateKey: today,
                  },
                },
              })
            : null;
        if (existingProgress?.isCompleted) {
          continue;
        }

        const questRef = payload.submissionId
          ? `quest:${quest.id}:speaking:${payload.submissionId}`
          : `quest:${quest.id}:user:${payload.userId}:${today}`;

        await this.executeRewardEffect(
          payload.submissionId,
          payload.userId,
          'QUEST',
          questRef,
          async (tx) => {
            await this.gamificationService.advanceDailyQuestAndGrantRewardsTx(
              payload.userId,
              quest,
              1,
              today,
              tx,
            );
          },
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to handle speaking gamification for user ${payload.userId}`,
        error,
      );
      if (options.rethrow) throw error;
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
