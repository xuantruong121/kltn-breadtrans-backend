import { Injectable, Logger, Optional } from '@nestjs/common';
import { RewardEligibilityService } from './reward-eligibility';
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
    @Optional() private readonly eligibility?: RewardEligibilityService,
  ) {}

  @OnEvent('quiz.submitted')
  async handleQuizSubmittedEvent(payload: {
    userId: number;
    quizId?: number;
    score: number;
    /** XP to award when the score is not a count of correct answers (Writing). */
    xp?: number;
    quizType?: QuizType | (string & {});
    isFirstSubmission?: boolean;
  }) {
    this.logger.log(
      `Handling quiz.submitted event for user ${payload.userId} with score ${payload.score} (firstSubmission: ${payload.isFirstSubmission})`,
    );
    // Only standalone Listening/Reading/Writing practice earns XP, Bánh mì,
    // quest progress or badges (reward-eligibility.ts). Fail closed.
    if (!(await this.eligibility?.quiz(payload.quizId))) {
      this.logger.log(
        `quiz.submitted for quiz ${payload.quizId}: not a rewarded activity, no reward`,
      );
      return;
    }

    try {
      // XP only for first submission
      // An explicit xp (Writing: one point per percent) replaces score × 10.
      // It is computed server-side; still, a present but invalid value pays
      // nothing rather than falling back to score × 10, and it never exceeds
      // one completed exercise (100).
      const baseXp =
        payload.xp === undefined
          ? payload.score * 10
          : Number.isFinite(payload.xp)
            ? Math.min(100, Math.max(0, Math.round(payload.xp)))
            : 0;
      const xpEarned = payload.isFirstSubmission === false ? 0 : baseXp;

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
          createMany: (args: {
            data: {
              submissionId: number;
              userId: number;
              rewardType: string;
              reference: string;
            }[];
            skipDuplicates: boolean;
          }) => Promise<{ count: number }>;
        };
      };
      if (
        txWithLedger.speakingRewardLedger &&
        typeof txWithLedger.speakingRewardLedger.createMany === 'function'
      ) {
        // Reserve the effect before mutating XP/Bánh Mì. `createMany` maps to
        // INSERT ... ON CONFLICT DO NOTHING in PostgreSQL, so a retry becomes a
        // clean NOOP instead of deliberately producing a duplicate-key error.
        const reservation = await txWithLedger.speakingRewardLedger.createMany({
          data: [
            {
              submissionId,
              userId,
              rewardType,
              reference,
            },
          ],
          skipDuplicates: true,
        });
        if (reservation.count === 0) {
          this.logger.log(
            `Reward effect ${rewardType} already processed for submission #${submissionId} (${reference}). Skipping.`,
          );
          return false;
        }
      }
      await effectFn(tx);
      return true;
    };

    try {
      let applied: boolean;
      if (typeof this.prisma.$transaction === 'function') {
        applied = await this.prisma.$transaction(runWithTx);
      } else {
        applied = await runWithTx(this.prisma);
      }
      return applied;
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

    // Exam and course recordings are graded but never rewarded.
    if (!(await this.eligibility?.speakingExercise(payload.exerciseId))) {
      this.logger.log(
        `speaking.submitted for exercise ${payload.exerciseId}: not a rewarded activity, no reward`,
      );
      return;
    }

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

  // Owner policy (reward-eligibility.ts): vocabulary outside the Arena earns
  // no XP, Bánh mì or quest progress. Mastery itself is stored by VocabService.
  @OnEvent('vocab.learned')
  // eslint-disable-next-line @typescript-eslint/require-await
  async handleVocabLearnedEvent(payload: {
    userId: number;
    count: number;
    wordId?: number;
    wordIds?: number[];
    source?: string;
  }): Promise<void> {
    this.logger.log(
      `vocab.learned for user ${payload.userId} (${payload.count}): not a rewarded activity, no reward`,
    );
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

  // Owner policy: TOEIC exams earn no XP or Bánh mì; results and history
  // are stored by ToeicService.
  @OnEvent('toeic.submitted')
  // eslint-disable-next-line @typescript-eslint/require-await
  async handleToeicSubmittedEvent(payload: {
    userId: number;
    examId: number;
    mode?: string;
    attemptId?: number;
  }): Promise<void> {
    this.logger.log(
      `toeic.submitted for user ${payload.userId} (exam ${payload.examId}): not a rewarded activity, no reward`,
    );
  }
}
