import {
  Injectable,
  BadRequestException,
  Optional,
  Logger,
} from '@nestjs/common';
import { streakShieldUsedNotice } from './streak-shield.logic';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationsService } from '../notifications/notifications.service';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import {
  getBusinessDayKey,
  getBusinessDayStart,
  getPreviousBusinessDayKey,
  getBusinessWeekKey,
  getBusinessWeekStart,
} from '../../common/time/business-time.util';
import { weeklyCatchUpDue } from './weekly-league.logic';
import { arenaStats } from './arena-stats.logic';
import { streakMilestone, xpLevel } from './ranking.logic';
import {
  BADGE_DESCRIPTIONS,
  BADGE_RULES,
  countHighSpeaking,
  countPerfectPractices,
  qualifyingBadges,
  type BadgeFacts,
} from './badge-rules.logic';
import { questsForDay, type DailyQuestDefinition } from './daily-quest-catalog';

// Building an Intl.DateTimeFormat is costly and this runs several times per
// submission; one formatter per time zone is reused (capacity profile 2026-11-09).
const dateKeyFormatters = new Map<string, Intl.DateTimeFormat>();

export function getTodayDateKey(timeZone = 'Asia/Ho_Chi_Minh'): string {
  let formatter = dateKeyFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    dateKeyFormatters.set(timeZone, formatter);
  }
  return formatter.format(new Date());
}

export const SATIETY_DECAY_INTERVAL_HOURS = 4;
export const SATIETY_DECAY_AMOUNT = 8;

export const HAPPINESS_DECAY_INTERVAL_HOURS = 24;
export const HAPPINESS_DECAY_AMOUNT = 5;

export const STARVATION_THRESHOLD = 20;
export const HEALTH_DECAY_INTERVAL_HOURS = 6;
export const HEALTH_DECAY_AMOUNT = 5;

export const FEED_COST_TIERS = [10, 20, 30] as const;

export type PetSatietyState = 'FULL' | 'NORMAL' | 'HUNGRY' | 'VERY_HUNGRY';

export function getPetSatietyState(satiety: number): PetSatietyState {
  const safeSatiety = Math.min(100, Math.max(0, satiety));
  if (safeSatiety >= 80) return 'FULL';
  if (safeSatiety >= 50) return 'NORMAL';
  if (safeSatiety >= 20) return 'HUNGRY';
  return 'VERY_HUNGRY';
}

export interface SpeciesPetState {
  level: number;
  exp: number;
  health: number;
  happiness: number;
  satiety: number;
  lastFedAt: string | null;
  stateUpdatedAt: string;
  dailyFeedDateKey: string | null;
  dailyFeedCount: number;
  dailyRewardedFeedCount: number;
  [key: string]: any;
}

export function normalizeSpeciesPetState(
  raw: any,
  rootSnapshot?: {
    level?: number;
    exp?: number;
    health?: number;
    happiness?: number;
    lastFedAt?: Date | string | null;
    createdAt?: Date | string | null;
  },
  now = new Date(),
): SpeciesPetState {
  const level = Number.isFinite(raw?.level)
    ? Math.max(1, Math.floor(raw.level))
    : (rootSnapshot?.level ?? 1);
  const exp = Number.isFinite(raw?.exp)
    ? Math.max(0, Math.floor(raw.exp))
    : (rootSnapshot?.exp ?? 0);
  const health = Number.isFinite(raw?.health)
    ? Math.min(100, Math.max(0, Math.floor(raw.health)))
    : Math.min(100, Math.max(0, Math.floor(rootSnapshot?.health ?? 100)));
  const happiness = Number.isFinite(raw?.happiness)
    ? Math.min(100, Math.max(0, Math.floor(raw.happiness)))
    : Math.min(100, Math.max(0, Math.floor(rootSnapshot?.happiness ?? 100)));

  const effectiveLastFedAt =
    raw?.lastFedAt !== undefined
      ? raw.lastFedAt
        ? new Date(raw.lastFedAt).toISOString()
        : null
      : rootSnapshot?.lastFedAt
        ? new Date(rootSnapshot.lastFedAt).toISOString()
        : null;

  let satiety: number;
  if (Number.isFinite(raw?.satiety)) {
    satiety = Math.min(100, Math.max(0, Math.floor(raw.satiety)));
  } else if (effectiveLastFedAt) {
    const hoursSinceLastFed = Math.max(
      0,
      Math.floor(
        (now.getTime() - new Date(effectiveLastFedAt).getTime()) /
          (1000 * 60 * 60),
      ),
    );
    satiety = Math.min(
      100,
      Math.max(
        0,
        100 -
          Math.floor(hoursSinceLastFed / SATIETY_DECAY_INTERVAL_HOURS) *
            SATIETY_DECAY_AMOUNT,
      ),
    );
  } else {
    satiety = 25;
  }

  let stateUpdatedAt: string;
  if (raw?.stateUpdatedAt) {
    stateUpdatedAt = new Date(raw.stateUpdatedAt).toISOString();
  } else if (effectiveLastFedAt) {
    stateUpdatedAt = effectiveLastFedAt;
  } else if (rootSnapshot?.createdAt) {
    stateUpdatedAt = new Date(rootSnapshot.createdAt).toISOString();
  } else {
    stateUpdatedAt = now.toISOString();
  }

  const dailyFeedDateKey =
    typeof raw?.dailyFeedDateKey === 'string' ? raw.dailyFeedDateKey : null;
  const dailyFeedCount = Number.isFinite(raw?.dailyFeedCount)
    ? Math.max(0, Math.floor(raw.dailyFeedCount))
    : 0;
  const dailyRewardedFeedCount = Number.isFinite(raw?.dailyRewardedFeedCount)
    ? Math.max(0, Math.floor(raw.dailyRewardedFeedCount))
    : 0;

  return {
    ...raw,
    level,
    exp,
    health,
    happiness,
    satiety,
    lastFedAt: effectiveLastFedAt,
    stateUpdatedAt,
    dailyFeedDateKey,
    dailyFeedCount,
    dailyRewardedFeedCount,
  };
}

export function reconcilePetDecay(
  state: SpeciesPetState,
  now = new Date(),
): { state: SpeciesPetState; changed: boolean } {
  const updated = { ...state };
  const lastUpdate = new Date(updated.stateUpdatedAt || now).getTime();
  const nowMs = now.getTime();
  if (Number.isNaN(lastUpdate) || nowMs <= lastUpdate) {
    return { state: updated, changed: false };
  }

  const elapsedHours = (nowMs - lastUpdate) / (1000 * 60 * 60);
  if (elapsedHours < 0.01) {
    return { state: updated, changed: false };
  }

  let changed = false;

  // 1. Satiety decay: -8 every 4 hours
  const satietySteps = Math.floor(elapsedHours / SATIETY_DECAY_INTERVAL_HOURS);
  const initialSatiety = updated.satiety;
  if (satietySteps > 0) {
    const newSatiety = Math.min(
      100,
      Math.max(0, initialSatiety - satietySteps * SATIETY_DECAY_AMOUNT),
    );
    if (newSatiety !== updated.satiety) {
      updated.satiety = newSatiety;
      changed = true;
    }
  }

  // 2. Happiness decay: -5 every 24 hours (independent of feeding)
  const happinessSteps = Math.floor(
    elapsedHours / HAPPINESS_DECAY_INTERVAL_HOURS,
  );
  if (happinessSteps > 0) {
    const newHappiness = Math.min(
      100,
      Math.max(0, updated.happiness - happinessSteps * HAPPINESS_DECAY_AMOUNT),
    );
    if (newHappiness !== updated.happiness) {
      updated.happiness = newHappiness;
      changed = true;
    }
  }

  // 3. Health decay: -5 every 6 hours ONLY when satiety remains below 20 (starvation)
  let starvationHours = 0;
  if (initialSatiety < STARVATION_THRESHOLD) {
    starvationHours = elapsedHours;
  } else {
    const stepsToStarvation =
      Math.floor(
        (initialSatiety - STARVATION_THRESHOLD) / SATIETY_DECAY_AMOUNT,
      ) + 1;
    const hoursToStarvation = stepsToStarvation * SATIETY_DECAY_INTERVAL_HOURS;
    if (elapsedHours > hoursToStarvation) {
      starvationHours = elapsedHours - hoursToStarvation;
    }
  }

  if (starvationHours > 0) {
    const healthSteps = Math.floor(
      starvationHours / HEALTH_DECAY_INTERVAL_HOURS,
    );
    if (healthSteps > 0) {
      const newHealth = Math.min(
        100,
        Math.max(0, updated.health - healthSteps * HEALTH_DECAY_AMOUNT),
      );
      if (newHealth !== updated.health) {
        updated.health = newHealth;
        changed = true;
      }
    }
  }

  if (changed || elapsedHours >= SATIETY_DECAY_INTERVAL_HOURS) {
    updated.stateUpdatedAt = now.toISOString();
    changed = true;
  }

  return { state: updated, changed };
}

/** A pet gains a level every 1,000 EXP and never loses one. */
export const PET_EXP_PER_LEVEL = 1000;
/** Pet EXP for each rewarded practice, and the most it earns a day that way. */
export const PET_STUDY_EXP_PER_PRACTICE = 10;
export const PET_STUDY_EXP_DAILY_CAP = 50;

export function petLevelAfterExp(
  currentLevel: number | null | undefined,
  exp: number,
): number {
  const fromExp = Math.floor(Math.max(0, exp) / PET_EXP_PER_LEVEL) + 1;
  return Math.max(Math.floor(Number(currentLevel) || 1), fromExp);
}

export function normalizeDailyCounters(
  state: SpeciesPetState,
  today = getTodayDateKey('Asia/Ho_Chi_Minh'),
): { state: SpeciesPetState; reset: boolean } {
  if (state.dailyFeedDateKey === today) {
    return { state, reset: false };
  }
  return {
    state: {
      ...state,
      dailyFeedDateKey: today,
      dailyFeedCount: 0,
      dailyRewardedFeedCount: 0,
    },
    reset: true,
  };
}

function getQuestAction(type: string): {
  actionLabel: string;
  actionUrl: string;
} {
  switch (type) {
    case 'LEARN_VOCAB':
    case 'DO_VOCAB':
      return { actionLabel: 'Học từ vựng', actionUrl: '/flashcard' };
    case 'DO_LISTENING':
      return { actionLabel: 'Luyện nghe', actionUrl: '/listening' };
    case 'DO_READING':
      return { actionLabel: 'Luyện đọc', actionUrl: '/reading' };
    case 'DO_WRITING':
      return { actionLabel: 'Luyện viết', actionUrl: '/writing' };
    case 'PERFECT_QUIZ':
      return { actionLabel: 'Luyện nghe', actionUrl: '/listening' };
    // Advances only on standalone Listening, Reading or Writing practice
    // (reward-eligibility.ts); a TOEIC exam never counts, so never link there.
    case 'COMPLETE_QUIZ':
      return { actionLabel: 'Luyện kỹ năng', actionUrl: '/listening' };
    case 'DO_SPEAKING':
    case 'PRACTICE_SPEAKING':
      return { actionLabel: 'Luyện nói', actionUrl: '/speaking' };
    default:
      return { actionLabel: 'Tiếp tục học', actionUrl: '/dashboard' };
  }
}

@Injectable()
export class GamificationService {
  private readonly logger = new Logger(GamificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    @InjectRedis() private readonly redis: Redis,
    @Optional() private readonly notificationsService?: NotificationsService,
  ) {}

  /**
   * Awards EXP (XP) to a user.
   * Updates Leaderboard.totalPoints + weeklyExp, records PointHistory, triggers streak, emits xp_earned.
   * Does NOT touch UserStats.totalBanhRan.
   */
  async awardXp(
    userId: number,
    points: number,
    reason: string,
    options?: { tx?: Prisma.TransactionClient },
  ) {
    if (points <= 0) return null;
    const client = options?.tx ?? this.prisma;
    let myLeaderboard = await client.leaderboard.findUnique({
      where: { userId },
    });
    if (!myLeaderboard) {
      myLeaderboard = await client.leaderboard.create({
        data: { userId, tier: 'Đồng' },
      });
    }

    // Record EXP history
    await client.pointHistory.create({
      data: { userId, points, reason },
    });

    // Update Leaderboard (EXP only, NOT Bánh Mì)
    const updatedLeaderboard = await client.leaderboard.update({
      where: { userId },
      data: {
        totalPoints: { increment: points },
        weeklyExp: { increment: points },
      },
    });

    // A new XP level is a moment for the ranking's activity feed.
    const levelAfter = xpLevel(updatedLeaderboard.totalPoints);
    if (levelAfter > xpLevel(myLeaderboard.totalPoints)) {
      await client.learnerEvent.create({
        data: { userId, type: 'LEVEL_UP', value: levelAfter },
      });
    }

    // Record streak activity in the same transaction when one is supplied.
    await this.recordStreakActivity(userId, options?.tx);

    // Emit for quest progress only when outside an internal quest transaction
    if (!options?.tx) {
      this.eventEmitter.emit('gamification.xp_earned', { userId, points });
    }

    return updatedLeaderboard;
  }

  /**
   * @deprecated Use awardXp instead. Kept for backward compatibility during migration.
   * No longer writes to UserStats.totalBanhRan.
   */
  async addPoints(userId: number, points: number, reason: string) {
    return this.awardXp(userId, points, reason);
  }

  /** Constants for the daily cap and daily quotas */
  static readonly MAX_DAILY_EARNABLE_BANH = 150;
  static readonly MAX_DAILY_VOCAB_REWARDS = 30;
  static readonly MAX_DAILY_SPEAKING_REWARDS = 3;

  /**
   * One-time, idempotent ledger-only correction for a user whose
   * UserStats.totalBanhRan predates the ledger being complete (confirmed
   * legacy seed behavior — never a runtime bug in awardBanh/deductBanh).
   * Unlike awardBanh/deductBanh, this NEVER touches totalBanhRan — it only
   * appends one BanhTransaction row so SUM(amount) catches up to the
   * balance that is already being shown to the user. `balanceAfter` is a
   * snapshot of the CURRENT (unchanged) balance, not a post-increment value.
   * Safe to call repeatedly: the (userId, source, reference) pre-check makes
   * a second call for the same user a no-op, exactly like awardBanh.
   */
  async appendLegacyReconciliationEntry(
    userId: number,
    delta: number,
    reason: string,
  ): Promise<{
    applied: boolean;
    alreadyApplied: boolean;
    balanceAfter: number;
  }> {
    if (delta === 0) {
      const stats = await this.prisma.userStats.findUnique({
        where: { userId },
      });
      return {
        applied: false,
        alreadyApplied: false,
        balanceAfter: stats?.totalBanhRan ?? 0,
      };
    }

    const source = 'LEGACY_RECONCILIATION';
    const reference = `legacy-reconciliation:${userId}:v1`;
    const today = getTodayDateKey('Asia/Ho_Chi_Minh');

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`legacy_reconciliation:${userId}:${reference}`}))`;

      const existing = await tx.banhTransaction.findUnique({
        where: { userId_source_reference: { userId, source, reference } },
      });
      const stats = await tx.userStats.findUnique({ where: { userId } });
      if (existing) {
        return {
          applied: false,
          alreadyApplied: true,
          balanceAfter: stats?.totalBanhRan ?? 0,
        };
      }

      await tx.banhTransaction.create({
        data: {
          userId,
          amount: delta,
          source,
          reference,
          dateKey: today,
          isCapped: false,
          balanceAfter: stats?.totalBanhRan ?? 0,
          metadata: { reason },
        },
      });

      this.logger.log(
        `[appendLegacyReconciliationEntry] user=${userId} delta=${delta} balanceAfter=${stats?.totalBanhRan ?? 0} (totalBanhRan unchanged)`,
      );

      return {
        applied: true,
        alreadyApplied: false,
        balanceAfter: stats?.totalBanhRan ?? 0,
      };
    });
  }

  /**
   * Awards Bánh Mì to a user.
   * - Checks idempotency: (userId, source, reference) must be unique in BanhTransaction.
   * - Enforces MAX_DAILY_EARNABLE_BANH cap atomically using row lock & advisory lock.
   * - Applies 2x double-bread boost if active.
   * - Does NOT touch Leaderboard or PointHistory (EXP is separate).
   * - Returns idempotent result on duplicate without throwing P2002.
   */
  async awardBanh(
    userId: number,
    requestedAmount: number,
    source: string,
    reference: string | null,
    options: {
      isCapped?: boolean; // false = exempt from daily cap (admin, refund, system)
      metadata?: Record<string, unknown>;
    } = {},
    externalTx?: Prisma.TransactionClient,
  ): Promise<{
    requested: number;
    granted: number;
    rejected: number;
    remainingDaily: number;
    newBalance: number;
    isCapped: boolean;
  }> {
    const isCapped = options.isCapped !== false;
    const today = getTodayDateKey('Asia/Ho_Chi_Minh');

    const run = async (tx: Prisma.TransactionClient) => {
      // 1. Transaction-safe idempotency check with advisory lock
      if (reference !== null) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`award_banh:${userId}:${source}:${reference}`}))`;

        const existing = await tx.banhTransaction.findUnique({
          where: {
            userId_source_reference: { userId, source, reference },
          },
        });
        if (existing) {
          const stats = await tx.userStats.findUnique({ where: { userId } });
          const dailyRow = await tx.dailyBanhEarning.findUnique({
            where: { userId_dateKey: { userId, dateKey: today } },
          });
          return {
            requested: requestedAmount,
            granted: 0,
            rejected: requestedAmount,
            remainingDaily: Math.max(
              0,
              GamificationService.MAX_DAILY_EARNABLE_BANH -
                (dailyRow?.earnedBanh ?? 0),
            ),
            newBalance: stats?.totalBanhRan ?? 0,
            isCapped,
          };
        }
      }

      // 2. Check double-bread boost. It doubles study rewards only (the
      // capped sources): a market refund or an admin adjustment is returned
      // as is, or a boost would mint Bánh Mì out of a rejected order.
      const statsNow = await tx.userStats.findUnique({ where: { userId } });
      const boostActive =
        isCapped &&
        statsNow?.doubleBanhUntil &&
        new Date(statsNow.doubleBanhUntil) > new Date();
      const effectiveAmount = boostActive
        ? requestedAmount * 2
        : requestedAmount;

      let granted = effectiveAmount;
      let remaining = GamificationService.MAX_DAILY_EARNABLE_BANH;

      if (isCapped) {
        // Row-lock the daily earning row
        await tx.$queryRaw`
          INSERT INTO "DailyBanhEarning" ("userId", "dateKey", "earnedBanh", "vocabCount", "speakingCount", "updatedAt")
          VALUES (${userId}, ${today}, 0, 0, 0, NOW())
          ON CONFLICT ("userId", "dateKey") DO NOTHING
        `;

        const [dailyRow] = await tx.$queryRaw<
          { id: number; earnedBanh: number }[]
        >`
          SELECT id, "earnedBanh" FROM "DailyBanhEarning"
          WHERE "userId" = ${userId} AND "dateKey" = ${today}
          FOR UPDATE
        `;

        remaining = Math.max(
          0,
          GamificationService.MAX_DAILY_EARNABLE_BANH -
            (dailyRow?.earnedBanh ?? 0),
        );
        granted = Math.min(effectiveAmount, remaining);

        if (granted > 0) {
          await tx.dailyBanhEarning.update({
            where: { userId_dateKey: { userId, dateKey: today } },
            data: { earnedBanh: { increment: granted } },
          });
        }
      }

      if (granted <= 0) {
        const currentStats = await tx.userStats.findUnique({
          where: { userId },
        });
        return {
          requested: requestedAmount,
          granted: 0,
          rejected: requestedAmount,
          remainingDaily: remaining,
          newBalance: currentStats?.totalBanhRan ?? 0,
          isCapped,
        };
      }

      // 3. Update wallet
      const updatedStats = await tx.userStats.upsert({
        where: { userId },
        update: { totalBanhRan: { increment: granted } },
        create: { userId, totalBanhRan: granted },
      });

      // 4. Immutable ledger entry
      await tx.banhTransaction.create({
        data: {
          userId,
          amount: granted,
          source,
          reference,
          dateKey: today,
          isCapped,
          balanceAfter: updatedStats.totalBanhRan,
          metadata: options.metadata ? (options.metadata as any) : undefined,
        },
      });

      this.logger.log(
        `[awardBanh] user=${userId} source=${source} requested=${requestedAmount} granted=${granted} balance=${updatedStats.totalBanhRan}`,
      );

      return {
        requested: requestedAmount,
        granted,
        rejected: requestedAmount - granted,
        remainingDaily: isCapped
          ? Math.max(0, remaining - granted)
          : GamificationService.MAX_DAILY_EARNABLE_BANH,
        newBalance: updatedStats.totalBanhRan,
        isCapped,
      };
    };

    if (externalTx) {
      return run(externalTx);
    }
    return this.prisma.$transaction(run);
  }

  /**
   * Reusable transactional helper to advance a daily quest progress row and grant rewards atomically.
   * - Uses advisory lock & SELECT FOR UPDATE to prevent concurrency races.
   * - Clamps currentValue to quest.targetValue.
   * - Grants quest XP and Bánh Mì (capped) exactly once on transition from false -> true.
   */
  async advanceDailyQuestAndGrantRewardsTx(
    userId: number,
    quest: {
      id: number;
      title: string;
      rewardXP: number;
      rewardBanh: number;
      targetValue: number;
    },
    incrementCount: number,
    today: string,
    externalTx?: Prisma.TransactionClient,
  ): Promise<{ completedNow: boolean; currentValue: number }> {
    const run = async (tx: Prisma.TransactionClient) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quest_prog:${userId}:${quest.id}:${today}`}))`;

      const progress = await tx.userQuestProgress.upsert({
        where: {
          userId_questId_dateKey: {
            userId,
            questId: quest.id,
            dateKey: today,
          },
        },
        update: {},
        create: {
          userId,
          questId: quest.id,
          dateKey: today,
          currentValue: 0,
        },
      });

      const [locked] = await tx.$queryRaw<
        { id: number; currentValue: number; isCompleted: boolean }[]
      >`
        SELECT id, "currentValue", "isCompleted"
        FROM "UserQuestProgress"
        WHERE id = ${progress.id}
        FOR UPDATE
      `;

      if (!locked || locked.isCompleted) {
        return {
          completedNow: false,
          currentValue: locked?.currentValue ?? quest.targetValue,
        };
      }

      const nextValue = Math.min(
        quest.targetValue,
        locked.currentValue + incrementCount,
      );
      const completedNow = nextValue >= quest.targetValue;

      await tx.userQuestProgress.update({
        where: { id: progress.id },
        data: {
          currentValue: nextValue,
          isCompleted: completedNow,
          completedAt: completedNow ? new Date() : null,
        },
      });

      if (completedNow) {
        if (quest.rewardXP > 0) {
          await this.awardXp(
            userId,
            quest.rewardXP,
            `Hoàn thành nhiệm vụ: ${quest.title}`,
            { tx },
          );
        }

        if (quest.rewardBanh > 0) {
          await this.awardBanh(
            userId,
            quest.rewardBanh,
            'DAILY_QUEST',
            `quest:${quest.id}:${today}`,
            { isCapped: true, metadata: { questTitle: quest.title } },
            tx,
          );
        }

        this.logger.log(
          `User ${userId} completed quest ${quest.id} and received rewards atomically.`,
        );
      }

      return { completedNow, currentValue: nextValue };
    };

    if (externalTx) {
      return run(externalTx);
    }
    return this.prisma.$transaction(run);
  }

  /**
   * Awards vocabulary first-mastery Bánh Mì with lifetime guard & daily quota (max 30/day).
   * - Enforces UserVocabMasteryReward uniqueness (lifetime once per word).
   * - Updates DailyBanhEarning.vocabCount atomically inside the transaction.
   */
  async awardVocabMasteryReward(
    userId: number,
    wordId: number,
  ): Promise<{ granted: number; firstMastery: boolean; reason?: string }> {
    const today = getTodayDateKey('Asia/Ho_Chi_Minh');

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`vocab_mast:${userId}:${wordId}`}))`;

      const existing = await tx.userVocabMasteryReward.findUnique({
        where: { userId_wordId: { userId, wordId } },
      });
      const firstMastery = !existing;
      const alreadyGranted = existing?.banhGranted ?? 0;
      if (alreadyGranted >= 1) {
        return { granted: 0, firstMastery: false, reason: 'ALREADY_MASTERED' };
      }

      if (!existing) {
        await tx.userVocabMasteryReward.create({ data: { userId, wordId } });
      }

      await tx.$queryRaw`
        INSERT INTO "DailyBanhEarning" ("userId", "dateKey", "earnedBanh", "vocabCount", "speakingCount", "updatedAt")
        VALUES (${userId}, ${today}, 0, 0, 0, NOW())
        ON CONFLICT ("userId", "dateKey") DO NOTHING
      `;

      const [dailyRow] = await tx.$queryRaw<
        { id: number; vocabCount: number }[]
      >`
        SELECT id, "vocabCount" FROM "DailyBanhEarning"
        WHERE "userId" = ${userId} AND "dateKey" = ${today}
        FOR UPDATE
      `;

      if (
        (dailyRow?.vocabCount ?? 0) >=
        GamificationService.MAX_DAILY_VOCAB_REWARDS
      ) {
        return { granted: 0, firstMastery, reason: 'DAILY_QUOTA_EXCEEDED' };
      }

      const awardResult = await this.awardBanh(
        userId,
        1,
        'VOCAB_MASTERY',
        `vocab:word:${wordId}`,
        { isCapped: true, metadata: { wordId } },
        tx,
      );

      if (awardResult.granted > 0) {
        await tx.userVocabMasteryReward.update({
          where: { userId_wordId: { userId, wordId } },
          data: { banhGranted: { increment: awardResult.granted } },
        });
        await tx.dailyBanhEarning.update({
          where: { userId_dateKey: { userId, dateKey: today } },
          data: { vocabCount: { increment: 1 } },
        });
      }

      return { granted: awardResult.granted, firstMastery };
    });
  }

  /**
   * Awards speaking practice Bánh Mì atomically with daily quota (max 3/day).
   * - Uses submission-level idempotency reference: speaking:submission:<submissionId>.
   * - Updates DailyBanhEarning.speakingCount atomically inside the transaction.
   */
  async awardSpeakingReward(
    userId: number,
    submissionId: number,
    score: number,
    options?: { tx?: Prisma.TransactionClient },
  ): Promise<{ granted: number; reason?: string }> {
    const today = getTodayDateKey('Asia/Ho_Chi_Minh');

    const runner = async (tx: Prisma.TransactionClient) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`speaking_sub:${submissionId}`}))`;

      const existing = await tx.banhTransaction.findUnique({
        where: {
          userId_source_reference: {
            userId,
            source: 'SPEAKING_SUBMISSION',
            reference: `speaking:submission:${submissionId}`,
          },
        },
      });
      if (existing) {
        return { granted: 0, reason: 'ALREADY_REWARDED' };
      }

      await tx.$queryRaw`
        INSERT INTO "DailyBanhEarning" ("userId", "dateKey", "earnedBanh", "vocabCount", "speakingCount", "updatedAt")
        VALUES (${userId}, ${today}, 0, 0, 0, NOW())
        ON CONFLICT ("userId", "dateKey") DO NOTHING
      `;

      const [dailyRow] = await tx.$queryRaw<
        { id: number; speakingCount: number }[]
      >`
        SELECT id, "speakingCount" FROM "DailyBanhEarning"
        WHERE "userId" = ${userId} AND "dateKey" = ${today}
        FOR UPDATE
      `;

      if (
        (dailyRow?.speakingCount ?? 0) >=
        GamificationService.MAX_DAILY_SPEAKING_REWARDS
      ) {
        return { granted: 0, reason: 'DAILY_QUOTA_EXCEEDED' };
      }

      const awardResult = await this.awardBanh(
        userId,
        5,
        'SPEAKING_SUBMISSION',
        `speaking:submission:${submissionId}`,
        { isCapped: true, metadata: { score, submissionId } },
        tx,
      );

      if (awardResult.granted > 0) {
        await tx.dailyBanhEarning.update({
          where: { userId_dateKey: { userId, dateKey: today } },
          data: { speakingCount: { increment: 1 } },
        });
      }

      return { granted: awardResult.granted };
    };

    if (options?.tx) {
      return runner(options.tx);
    }
    return this.prisma.$transaction(runner);
  }

  /**
   * Awards TOEIC test Bánh Mì: 120 for FULL_TEST, 30 for PRACTICE / part.
   * - Guarded by UserToeicReward unique constraint (userId, examId, mode).
   * - Counts toward the daily 150 cap.
   */
  async awardToeicReward(
    userId: number,
    examId: number,
    mode: string,
    attemptId?: number,
  ): Promise<{ granted: number; reason?: string }> {
    const rewardAmount = mode === 'FULL_TEST' ? 120 : 30;

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`toeic_reward:${userId}:${examId}:${mode}`}))`;

      const existing = await tx.userToeicReward.findUnique({
        where: { userId_examId_mode: { userId, examId, mode } },
      });
      const previouslyGranted = existing?.banhGranted ?? 0;
      const remainingReward = Math.max(0, rewardAmount - previouslyGranted);
      if (remainingReward === 0) {
        return { granted: 0, reason: 'ALREADY_REWARDED' };
      }

      if (!existing) {
        await tx.userToeicReward.create({ data: { userId, examId, mode } });
      }

      const awardResult = await this.awardBanh(
        userId,
        remainingReward,
        'TOEIC_COMPLETION',
        `toeic:${examId}:${mode}:remaining:${previouslyGranted}`,
        { isCapped: true, metadata: { examId, mode, attemptId } },
        tx,
      );

      if (awardResult.granted > 0) {
        await tx.userToeicReward.update({
          where: { userId_examId_mode: { userId, examId, mode } },
          data: { banhGranted: { increment: awardResult.granted } },
        });
      }

      return { granted: awardResult.granted };
    });
  }

  /**
   * Deducts Bánh Mì from a user's wallet atomically.
   * - Idempotency: (userId, source, reference) must be unique in BanhTransaction —
   *   mirrors awardBanh's pre-check-under-advisory-lock pattern, so a retried/
   *   double-clicked deduction with the same reference is a safe no-op instead
   *   of double-spending or throwing a raw P2002.
   * - Uses CAS (compare-and-swap via conditional updateMany) to prevent overdraft.
   * - Pass `externalTx` to join a caller-owned transaction (e.g. market order
   *   checkout) instead of opening a nested one.
   */
  async deductBanh(
    userId: number,
    amount: number,
    reason: string,
    source: string,
    reference: string | null = null,
    options: { metadata?: Record<string, unknown> } = {},
    externalTx?: Prisma.TransactionClient,
  ): Promise<{
    success: boolean;
    newBalance: number;
    message?: string;
    alreadyApplied?: boolean;
  }> {
    const today = getTodayDateKey('Asia/Ho_Chi_Minh');

    const run = async (tx: Prisma.TransactionClient) => {
      if (reference !== null) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`deduct_banh:${userId}:${source}:${reference}`}))`;

        const existing = await tx.banhTransaction.findUnique({
          where: { userId_source_reference: { userId, source, reference } },
        });
        if (existing) {
          const stats = await tx.userStats.findUnique({ where: { userId } });
          return {
            success: true,
            newBalance: stats?.totalBanhRan ?? 0,
            alreadyApplied: true,
          };
        }
      }

      // Atomic CAS: only deduct if balance is sufficient
      const cas = await tx.userStats.updateMany({
        where: { userId, totalBanhRan: { gte: amount } },
        data: { totalBanhRan: { decrement: amount } },
      });

      if (cas.count === 0) {
        const stats = await tx.userStats.findUnique({ where: { userId } });
        return {
          success: false,
          newBalance: stats?.totalBanhRan ?? 0,
          message: `Không đủ Bánh Mì (Cần ${amount}, hiện có ${stats?.totalBanhRan ?? 0})`,
        };
      }

      const updated = await tx.userStats.findUnique({ where: { userId } });

      await tx.banhTransaction.create({
        data: {
          userId,
          amount: -amount,
          source,
          reference,
          dateKey: today,
          isCapped: false,
          balanceAfter: updated?.totalBanhRan ?? 0,
          metadata: options.metadata ? (options.metadata as any) : null,
        },
      });

      return { success: true, newBalance: updated?.totalBanhRan ?? 0 };
    };

    if (externalTx) {
      return run(externalTx);
    }
    return this.prisma.$transaction(run);
  }

  /**
   * Awards a badge to a user if they don't already have it.
   * Returns true if a new badge was awarded.
   */
  async awardBadgeIfEarned(
    userId: number,
    badgeName: string,
    options?: { tx?: Prisma.TransactionClient },
  ): Promise<boolean> {
    const client = options?.tx ?? this.prisma;
    const badge = await client.badge.findFirst({
      where: { name: badgeName },
    });
    if (!badge) return false;

    const exists = await client.userBadge.findUnique({
      where: { userId_badgeId: { userId, badgeId: badge.id } },
    });
    if (exists) return false;

    await client.userBadge.create({
      data: { userId, badgeId: badge.id },
    });

    this.logger.log(`Awarded badge "${badgeName}" to user ${userId}`);

    // Send push notification for new badge
    if (this.notificationsService) {
      void this.notificationsService.sendPushToUser(userId, {
        title: 'Huy hiệu mới!',
        body: `Bạn vừa mở khóa huy hiệu "${badgeName}". Tiếp tục cố gắng nhé!`,
        icon: '/icons/icon-192.png',
        url: '/arena',
      });
    }

    return true;
  }

  async recordStreakActivity(
    userId: number,
    externalTx?: Prisma.TransactionClient,
  ) {
    const run = async (client: Prisma.TransactionClient) => {
      try {
        await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`streak:${userId}`}))`;
        const now = new Date();
        // Use Vietnam timezone consistently for streak day boundaries
        const nowDateStr = getTodayDateKey('Asia/Ho_Chi_Minh');

        const stats = await client.userStats.findUnique({
          where: { userId },
        });

        if (!stats) {
          await client.userStats.create({
            data: {
              userId,
              streakCount: 1,
              lastStreakUpdate: now,
            },
          });
          return;
        }

        const lastUpdate = stats.lastStreakUpdate
          ? new Date(stats.lastStreakUpdate)
          : null;
        if (!lastUpdate) {
          await client.userStats.update({
            where: { userId },
            data: { streakCount: 1, lastStreakUpdate: now },
          });
          return;
        }

        // Use Vietnam timezone for last streak date
        const lastDateStr = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Ho_Chi_Minh',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(lastUpdate);

        // Same Vietnam day - no change unless streak was cleared (count is 0)
        if (nowDateStr === lastDateStr) {
          if (stats.streakCount === 0) {
            await client.userStats.update({
              where: { userId },
              data: {
                streakCount: 1,
                lastStreakUpdate: now,
              },
            });
          }
          return;
        }

        // Parse dates to Vietnam midnight boundaries for diffing
        const toVietnamMidnight = (dateKey: string) =>
          new Date(`${dateKey}T00:00:00+07:00`).getTime();

        const nowMidnight = toVietnamMidnight(nowDateStr);
        const lastMidnight = toVietnamMidnight(lastDateStr);
        const diffDays = Math.round(
          (nowMidnight - lastMidnight) / (1000 * 60 * 60 * 24),
        );

        // A streak reaching 3, 7, 14… days goes to the ranking's activity feed.
        const recordMilestone = async () => {
          const milestone = streakMilestone(
            stats.streakCount,
            stats.streakCount + 1,
          );
          if (milestone)
            await client.learnerEvent.create({
              data: { userId, type: 'STREAK_MILESTONE', value: milestone },
            });
        };

        if (diffDays === 1) {
          // Consecutive day - increment streak
          await client.userStats.update({
            where: { userId },
            data: {
              streakCount: { increment: 1 },
              lastStreakUpdate: now,
            },
          });
          await recordMilestone();
        } else if (diffDays > 1) {
          // Missed day(s) - check streak freeze (only if streak was active)
          if (stats.streakCount > 0 && stats.streakFreezes > 0) {
            await client.userStats.update({
              where: { userId },
              data: {
                streakFreezes: { decrement: 1 },
                streakCount: { increment: 1 },
                lastStreakUpdate: now,
              },
            });
            // The learner is told a shield was used, and how many are left.
            await client.notification.create({
              data: {
                userId,
                ...streakShieldUsedNotice({
                  streak: stats.streakCount,
                  remaining: stats.streakFreezes - 1,
                }),
              },
            });
            await recordMilestone();
          } else {
            // Streak broken or starting from 0 - reset to 1
            await client.userStats.update({
              where: { userId },
              data: {
                streakCount: 1,
                lastStreakUpdate: now,
              },
            });
          }
        }
      } catch (err) {
        this.logger.error(
          '[Streak] Failed to update streak for user:' + userId,
          err,
        );
        // Do not let XP/reward transactions commit while the streak write has
        // failed. The caller's transaction must roll back as one unit.
        throw err;
      }
    };

    if (externalTx) return run(externalTx);
    try {
      return await this.prisma.$transaction(run);
    } catch (err) {
      this.logger.error(
        '[Streak] Failed to start transaction for user:' + userId,
        err,
      );
      throw err;
    }
  }

  async getLeaderboard(
    tier: string = 'Đồng',
    scope: string = 'tier',
    currentUserId?: number,
  ) {
    const whereClause: any = {};
    if (scope === 'tier' && tier) {
      whereClause.tier = tier;
    }

    const allTierEntries = await this.prisma.leaderboard.findMany({
      where: whereClause,
      orderBy: [
        { weeklyExp: 'desc' },
        { totalPoints: 'desc' },
        { userId: 'asc' },
      ],
      take: 20,
      include: {
        user: {
          select: {
            id: true,
            profile: {
              select: {
                fullName: true,
                avatar: true,
              },
            },
          },
        },
      },
    });

    const entries = allTierEntries.map((entry, index) => ({
      rank: index + 1,
      userId: entry.userId,
      displayName: entry.user?.profile?.fullName || `Học viên #${entry.userId}`,
      avatarUrl: entry.user?.profile?.avatar || null,
      tier: entry.tier,
      totalPoints: entry.totalPoints,
      weeklyExp: entry.weeklyExp,
      isCurrentUser: currentUserId ? entry.userId === currentUserId : false,
    }));

    let currentUserRank: {
      rank: number;
      userId: number;
      displayName: string;
      avatarUrl: string | null;
      tier: string;
      totalPoints: number;
      weeklyExp: number;
      isCurrentUser: boolean;
    } | null = null;

    if (currentUserId) {
      const existingInTop = entries.find((e) => e.userId === currentUserId);
      if (existingInTop) {
        currentUserRank = existingInTop;
      } else {
        const myBoard = await this.prisma.leaderboard.findUnique({
          where: { userId: currentUserId },
          include: {
            user: {
              select: {
                id: true,
                profile: {
                  select: {
                    fullName: true,
                    avatar: true,
                  },
                },
              },
            },
          },
        });

        if (myBoard) {
          const higherCount = await this.prisma.leaderboard.count({
            where: {
              ...(scope === 'tier' ? { tier: myBoard.tier } : {}),
              OR: [
                { weeklyExp: { gt: myBoard.weeklyExp } },
                {
                  weeklyExp: myBoard.weeklyExp,
                  totalPoints: { gt: myBoard.totalPoints },
                },
                {
                  weeklyExp: myBoard.weeklyExp,
                  totalPoints: myBoard.totalPoints,
                  userId: { lt: myBoard.userId },
                },
              ],
            },
          });

          currentUserRank = {
            rank: higherCount + 1,
            userId: myBoard.userId,
            displayName:
              myBoard.user?.profile?.fullName || `Học viên #${myBoard.userId}`,
            avatarUrl: myBoard.user?.profile?.avatar || null,
            tier: myBoard.tier,
            totalPoints: myBoard.totalPoints,
            weeklyExp: myBoard.weeklyExp,
            isCurrentUser: true,
          };
        }
      }
    }

    // Learners in the listed tier, so the client can draw the promotion and
    // demotion zones of the weekly cron (top and bottom 20 %); every learner
    // when the scope is all tiers.
    const tierSize = await this.prisma.leaderboard.count({
      where: whereClause,
    });

    return {
      tier,
      scope,
      entries,
      currentUserRank,
      tierSize,
    };
  }

  /** The learner's arena record from their settled matches (read only). */
  async getArenaStats(userId: number) {
    const battles = await this.prisma.gameBattle.findMany({
      where: { status: 'settled', OR: [{ p1Id: userId }, { p2Id: userId }] },
      select: {
        p1Id: true,
        p2Id: true,
        stake: true,
        winnerRole: true,
        winnerUserId: true,
        settledAt: true,
      },
      orderBy: { settledAt: 'asc' },
    });
    return arenaStats(userId, battles);
  }

  /**
   * What the badge rules look at (badge-rules.logic.ts), read from the
   * learner's own records. `client` lets a caller count inside its
   * transaction, so a reward written there is already seen.
   */
  async badgeFacts(
    userId: number,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<BadgeFacts> {
    const [leaderboard, userStats, userPet, top, quizAttempts, speaking] =
      await Promise.all([
        client.leaderboard.findUnique({ where: { userId } }),
        client.userStats.findUnique({ where: { userId } }),
        client.userPet.findUnique({ where: { userId } }),
        client.leaderboard.findFirst({
          orderBy: { weeklyExp: 'desc' },
          select: { userId: true },
        }),
        client.submission.findMany({
          where: {
            userId,
            quiz: { type: { in: ['LISTENING_PRACTICE', 'BILINGUAL_READING'] } },
          },
          select: { quizId: true, results: { select: { isCorrect: true } } },
        }),
        client.speakingSubmission.findMany({
          where: {
            userId,
            status: 'COMPLETED',
            NOT: { exercise: { practiceSet: { scope: 'EXAM_INTERNAL' } } },
          },
          select: { exerciseId: true, overallScore: true },
        }),
      ]);
    const battles = await client.gameBattle.findMany({
      where: { status: 'settled', OR: [{ p1Id: userId }, { p2Id: userId }] },
      select: {
        p1Id: true,
        p2Id: true,
        stake: true,
        winnerRole: true,
        winnerUserId: true,
        settledAt: true,
      },
      orderBy: { settledAt: 'asc' },
    });
    return {
      totalXp: leaderboard?.totalPoints ?? 0,
      weeklyXp: leaderboard?.weeklyExp ?? 0,
      isWeeklyTop: top?.userId === userId,
      streak: userStats?.streakCount ?? 0,
      perfectPractices: countPerfectPractices(quizAttempts),
      highSpeaking: countHighSpeaking(speaking),
      longestArenaWinStreak: arenaStats(userId, battles).longestWinStreak,
      petLevel: userPet?.level ?? 1,
    };
  }

  /**
   * Grants every badge whose rule the learner now meets. It never takes one
   * away: revoking under a changed rule is a reviewed one-off script
   * (scripts/badge-rules-2026-11-08.ts). Returns the badges newly granted.
   */
  async syncBadges(
    userId: number,
    options?: { tx?: Prisma.TransactionClient },
  ): Promise<string[]> {
    const facts = await this.badgeFacts(userId, options?.tx ?? this.prisma);
    const granted: string[] = [];
    for (const name of qualifyingBadges(facts)) {
      if (await this.awardBadgeIfEarned(userId, name, options))
        granted.push(name);
    }
    return granted;
  }

  /** The facts and the marks, for the progress bars on the badge cabinet. */
  async getBadgeProgress(userId: number) {
    return { facts: await this.badgeFacts(userId), rules: BADGE_RULES };
  }

  async getMyBadges(userId: number) {
    // The eight badges exist on a fresh database too (only missing ones are
    // created; existing descriptions are changed by the reviewed script).
    for (const [name, b] of Object.entries(BADGE_DESCRIPTIONS)) {
      const existing = await this.prisma.badge.findFirst({ where: { name } });
      if (!existing) {
        await this.prisma.badge.create({
          data: {
            name,
            description: b.description,
            iconUrl: '',
            criteria: b.criteria as Prisma.InputJsonValue,
          },
        });
      }
    }

    // Catch up on anything earned before an award path existed.
    await this.syncBadges(userId);

    return this.prisma.userBadge.findMany({
      where: { userId },
      include: {
        badge: true,
      },
    });
  }

  // ==========================================
  // PET & DAILY QUESTS (INDEPENDENT PER-SPECIES SYSTEM)
  // ==========================================

  private normalizeSpeciesKey(name?: string): string {
    if (!name) return 'bready';
    const n = name.trim().toLowerCase();
    if (
      n.includes('cú') ||
      n === 'owly' ||
      n.includes('owl') ||
      n.includes('thông thái') ||
      n.includes('cử nhân')
    ) {
      return 'owly';
    }
    if (
      n.includes('mèo') ||
      n.includes('meo') ||
      n.includes('taiyaki') ||
      n === 'mimi' ||
      n.includes('mimi') ||
      n.includes('nơ hồng') ||
      n.includes('thiên thần')
    ) {
      return 'mimi';
    }
    if (
      n.includes('cáo') ||
      n === 'foxy' ||
      n.includes('fox') ||
      n.includes('phim')
    ) {
      return 'foxy';
    }
    return 'bready';
  }

  private getPetFeedCost(feedCount: number): number {
    const safeCount = Number.isFinite(feedCount)
      ? Math.max(0, Math.floor(feedCount))
      : 0;
    return FEED_COST_TIERS[Math.min(safeCount, 2)];
  }

  private withPetFeedStatus<T extends { id: number; name: string }>(
    pet: T,
    activePetData: SpeciesPetState,
  ) {
    const satiety = Math.min(100, Math.max(0, activePetData.satiety));
    const satietyState = getPetSatietyState(satiety);
    const canFeed = satiety < 80;
    const feedCost = this.getPetFeedCost(activePetData.dailyFeedCount);
    const dailyRewardLimit = 3;
    const feedExpReward =
      activePetData.dailyRewardedFeedCount < dailyRewardLimit ? 5 : 0;

    return {
      ...pet,
      health: activePetData.health,
      happiness: activePetData.happiness,
      satiety,
      level: activePetData.level,
      exp: activePetData.exp,
      lastFedAt: activePetData.lastFedAt
        ? new Date(activePetData.lastFedAt).toISOString()
        : null,
      stateUpdatedAt: activePetData.stateUpdatedAt
        ? new Date(activePetData.stateUpdatedAt).toISOString()
        : new Date().toISOString(),
      satietyState,
      canFeed,
      feedCost,
      dailyFeedCount: activePetData.dailyFeedCount,
      dailyRewardedFeedCount: activePetData.dailyRewardedFeedCount,
      dailyRewardLimit,
      feedExpReward,
      nextFeedAt: null,
    };
  }

  async getMyPet(userId: number) {
    const now = new Date();
    const today = getTodayDateKey('Asia/Ho_Chi_Minh');

    let pet = await this.prisma.userPet.findUnique({
      where: { userId },
    });

    if (!pet) {
      const nowIso = now.toISOString();
      const initialRoster: Record<string, SpeciesPetState> = {
        bready: {
          level: 1,
          exp: 0,
          health: 100,
          happiness: 100,
          satiety: 80,
          lastFedAt: null,
          stateUpdatedAt: nowIso,
          dailyFeedDateKey: today,
          dailyFeedCount: 0,
          dailyRewardedFeedCount: 0,
        },
        owly: {
          level: 1,
          exp: 0,
          health: 100,
          happiness: 100,
          satiety: 80,
          lastFedAt: null,
          stateUpdatedAt: nowIso,
          dailyFeedDateKey: today,
          dailyFeedCount: 0,
          dailyRewardedFeedCount: 0,
        },
        mimi: {
          level: 1,
          exp: 0,
          health: 100,
          happiness: 100,
          satiety: 80,
          lastFedAt: null,
          stateUpdatedAt: nowIso,
          dailyFeedDateKey: today,
          dailyFeedCount: 0,
          dailyRewardedFeedCount: 0,
        },
        foxy: {
          level: 1,
          exp: 0,
          health: 100,
          happiness: 100,
          satiety: 80,
          lastFedAt: null,
          stateUpdatedAt: nowIso,
          dailyFeedDateKey: today,
          dailyFeedCount: 0,
          dailyRewardedFeedCount: 0,
        },
      };

      pet = await this.prisma.userPet.create({
        data: {
          userId,
          name: 'Bánh Mì Dũng Cảm',
          health: 100,
          happiness: 100,
          level: 1,
          exp: 0,
          roster: initialRoster as any,
        } as any,
      });

      return this.withPetFeedStatus(pet, initialRoster.bready);
    }

    const currentSpecies = this.normalizeSpeciesKey(pet.name);
    const rawRoster = ((pet as any).roster as Record<string, any>) || {};

    // 1. Normalize active pet state from roster or root snapshot
    const currentEntry =
      rawRoster[currentSpecies] ||
      (currentSpecies === 'mimi' ? rawRoster['meo'] : undefined);
    let activePetData = normalizeSpeciesPetState(currentEntry, pet, now);

    // 2. Normalize daily counters for today
    const dailyNorm = normalizeDailyCounters(activePetData, today);
    activePetData = dailyNorm.state;

    // 3. Reconcile decay using stateUpdatedAt
    const decayResult = reconcilePetDecay(activePetData, now);
    activePetData = decayResult.state;

    // 4. Persist if state changed or if legacy entry lacked stateUpdatedAt
    if (
      decayResult.changed ||
      dailyNorm.reset ||
      !rawRoster[currentSpecies]?.stateUpdatedAt
    ) {
      rawRoster[currentSpecies] = activePetData;
      pet = await this.prisma.userPet.update({
        where: { userId },
        data: {
          health: activePetData.health,
          happiness: activePetData.happiness,
          level: activePetData.level,
          exp: activePetData.exp,
          lastFedAt: activePetData.lastFedAt
            ? new Date(activePetData.lastFedAt)
            : null,
          roster: rawRoster as any,
        } as any,
      });
    }

    return this.withPetFeedStatus(pet, activePetData);
  }

  /**
   * Pet EXP for a rewarded practice (owner decision 2026-11-04): +10 to the
   * active pet, at most 50 a day, so a learner who studies steadily sees a
   * level every two or three weeks. Feeding still gives its own +5. The day's
   * count lives in the species entry of the roster; the level never drops.
   * Returns the EXP granted (0 without a pet or past the daily cap).
   */
  async awardPetStudyExp(
    userId: number,
    options?: { tx?: Prisma.TransactionClient },
  ): Promise<number> {
    const today = getTodayDateKey('Asia/Ho_Chi_Minh');
    const now = new Date();
    const run = async (tx: Prisma.TransactionClient) => {
      // Same lock as feeding: both rewrite the active pet entry.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pet_feed:${userId}`}))`;
      const pet = await tx.userPet.findUnique({ where: { userId } });
      if (!pet) return { granted: 0, level: 0 };
      const species = this.normalizeSpeciesKey(pet.name);
      const roster = ((pet as any).roster as Record<string, any>) || {};
      const entry =
        roster[species] || (species === 'mimi' ? roster['meo'] : undefined);
      const state = normalizeSpeciesPetState(entry, pet, now);
      const used =
        state.dailyStudyExpDateKey === today
          ? Math.max(0, Math.floor(Number(state.dailyStudyExp) || 0))
          : 0;
      const granted = Math.min(
        PET_STUDY_EXP_PER_PRACTICE,
        PET_STUDY_EXP_DAILY_CAP - used,
      );
      if (granted <= 0) return { granted: 0, level: state.level };
      const exp = state.exp + granted;
      const level = petLevelAfterExp(state.level, exp);
      roster[species] = {
        ...state,
        exp,
        level,
        dailyStudyExpDateKey: today,
        dailyStudyExp: used + granted,
      };
      await tx.userPet.update({
        where: { userId },
        data: { level, exp, roster: roster as any } as any,
      });
      return { granted, level };
    };
    const result = options?.tx
      ? await run(options.tx)
      : await this.prisma.$transaction(run);
    if (result.granted && result.level >= BADGE_RULES.petLevel)
      await this.awardBadgeIfEarned(userId, 'Chuyên Gia Nuôi Thú', options);
    return result.granted;
  }

  async feedPet(userId: number) {
    const today = getTodayDateKey('Asia/Ho_Chi_Minh');
    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Advisory lock for user's pet
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pet_feed:${userId}`}))`;

      // 2. Find or create UserPet
      let pet = await tx.userPet.findUnique({ where: { userId } });
      if (!pet) {
        pet = await tx.userPet.create({
          data: {
            userId,
            name: 'Mèo Máy Bánh Mì',
            health: 100,
            happiness: 100,
            level: 1,
            exp: 0,
            roster: {
              meo: {
                level: 1,
                exp: 0,
                health: 100,
                happiness: 100,
                satiety: 50,
                lastFedAt: null,
                stateUpdatedAt: now.toISOString(),
                dailyFeedDateKey: today,
                dailyFeedCount: 0,
                dailyRewardedFeedCount: 0,
              },
            },
          },
        });
      }

      // 3. Load active pet state
      const currentSpecies = this.normalizeSpeciesKey(pet.name);
      const roster = ((pet as any).roster as Record<string, any>) || {};
      const currentEntry =
        roster[currentSpecies] ||
        (currentSpecies === 'mimi' ? roster['meo'] : undefined);
      let activePetData = normalizeSpeciesPetState(currentEntry, pet, now);

      // Reconcile decay using stateUpdatedAt
      const decayResult = reconcilePetDecay(activePetData, now);
      activePetData = decayResult.state;

      // Normalize daily counters
      const dailyNorm = normalizeDailyCounters(activePetData, today);
      activePetData = dailyNorm.state;

      // 4. Reject operation when satiety >= 80
      if (activePetData.satiety >= 80) {
        throw new BadRequestException(
          'Thú ảo đang no, chưa cần ăn thêm. Hãy quay lại khi pet đói hơn.',
        );
      }

      // 5. Calculate feed cost: 10 -> 20 -> 30 -> 30
      const feedCost = this.getPetFeedCost(activePetData.dailyFeedCount);
      const isRewardedFeed = activePetData.dailyRewardedFeedCount < 3;
      const EXP_PER_FEED = isRewardedFeed ? 5 : 0;

      // 6. CAS deduct totalBanhRan atomically
      const cas = await tx.userStats.updateMany({
        where: { userId, totalBanhRan: { gte: feedCost } },
        data: { totalBanhRan: { decrement: feedCost } },
      });

      if (cas.count === 0) {
        const stats = await tx.userStats.findUnique({ where: { userId } });
        throw new BadRequestException(
          `Bạn không đủ ${feedCost} Bánh Mì để cho thú ảo ăn! (Hiện có: ${stats?.totalBanhRan ?? 0})`,
        );
      }

      const updatedStats = await tx.userStats.findUnique({ where: { userId } });

      // 7. Write negative ledger entry
      await tx.banhTransaction.create({
        data: {
          userId,
          amount: -feedCost,
          source: 'PET_FEED',
          reference: `pet:feed:${userId}:${Date.now()}`,
          dateKey: today,
          isCapped: false,
          balanceAfter: updatedStats?.totalBanhRan ?? 0,
        },
      });

      // 8. Apply feeding benefits: Satiety +35, Health +10, Happiness +5, clamped to 100
      const newSatiety = Math.min(100, activePetData.satiety + 35);
      const newHealth = Math.min(100, activePetData.health + 10);
      const newHappiness = Math.min(100, activePetData.happiness + 5);
      const newPetExp = (activePetData.exp || 0) + EXP_PER_FEED;
      // A level is never taken away: data whose level ran ahead of its EXP
      // (old demo pets: Cấp 4 at 60 EXP) used to drop to Cấp 1 when fed.
      const newLevel = petLevelAfterExp(activePetData.level, newPetExp);

      activePetData.satiety = newSatiety;
      activePetData.health = newHealth;
      activePetData.happiness = newHappiness;
      activePetData.exp = newPetExp;
      activePetData.level = newLevel;
      activePetData.lastFedAt = now.toISOString();
      activePetData.stateUpdatedAt = now.toISOString();
      activePetData.dailyFeedDateKey = today;
      activePetData.dailyFeedCount = activePetData.dailyFeedCount + 1;
      activePetData.dailyRewardedFeedCount = isRewardedFeed
        ? activePetData.dailyRewardedFeedCount + 1
        : activePetData.dailyRewardedFeedCount;

      roster[currentSpecies] = activePetData;

      // 9. Update pet with synchronized root snapshot
      const updatedPet = await tx.userPet.update({
        where: { userId },
        data: {
          level: newLevel,
          exp: newPetExp,
          health: newHealth,
          happiness: newHappiness,
          lastFedAt: now,
          roster: roster as any,
        } as any,
      });

      return {
        updatedPet,
        activePetData,
        newLevel,
        feedExpAwarded: EXP_PER_FEED,
      };
    });

    // The pet badge (badge-rules.logic.ts)
    if (result.newLevel >= BADGE_RULES.petLevel) {
      await this.awardBadgeIfEarned(userId, 'Chuyên Gia Nuôi Thú');
    }

    return this.withPetFeedStatus(result.updatedPet, result.activePetData);
  }

  async changePetType(userId: number, targetPetName: string) {
    const today = getTodayDateKey('Asia/Ho_Chi_Minh');
    const now = new Date();
    const pet = await this.getMyPet(userId);
    const currentSpecies = this.normalizeSpeciesKey(pet.name);
    const targetSpecies = this.normalizeSpeciesKey(targetPetName);

    const roster = ((pet as any).roster as Record<string, any>) || {};

    // 1. Save current active pet stats into roster
    const currentData = roster[currentSpecies] || {};
    roster[currentSpecies] = {
      ...currentData,
      level: pet.level || 1,
      exp: pet.exp || 0,
      health: pet.health ?? 100,
      happiness: pet.happiness ?? 100,
      satiety: (pet as any).satiety ?? currentData.satiety ?? 80,
      lastFedAt: pet.lastFedAt,
      stateUpdatedAt:
        (pet as any).stateUpdatedAt ??
        currentData.stateUpdatedAt ??
        now.toISOString(),
      dailyFeedDateKey: currentData.dailyFeedDateKey ?? today,
      dailyFeedCount: currentData.dailyFeedCount ?? 0,
      dailyRewardedFeedCount: currentData.dailyRewardedFeedCount ?? 0,
    };

    // 2. Retrieve or initialize target pet stats
    if (!roster[targetSpecies]) {
      roster[targetSpecies] = {
        level: 1,
        exp: 0,
        health: 100,
        happiness: 100,
        satiety: 80,
        lastFedAt: null,
        stateUpdatedAt: now.toISOString(),
        dailyFeedDateKey: today,
        dailyFeedCount: 0,
        dailyRewardedFeedCount: 0,
      };
    }

    let targetData = normalizeSpeciesPetState(
      roster[targetSpecies],
      undefined,
      now,
    );
    // Normalize daily counters for target pet
    const dailyNorm = normalizeDailyCounters(targetData, today);
    targetData = dailyNorm.state;
    // Reconcile decay for target pet
    const decayResult = reconcilePetDecay(targetData, now);
    targetData = decayResult.state;
    roster[targetSpecies] = targetData;

    // 3. Switch active pet to target pet stats (without arbitrary +15 happiness bump)
    const updatedPet = await this.prisma.userPet.update({
      where: { userId },
      data: {
        name: targetPetName,
        level: targetData.level || 1,
        exp: targetData.exp || 0,
        health: targetData.health ?? 100,
        happiness: targetData.happiness ?? 100,
        lastFedAt: targetData.lastFedAt ? new Date(targetData.lastFedAt) : null,
        roster: roster as any,
      } as any,
    });

    return this.withPetFeedStatus(updatedPet, targetData);
  }

  async getDashboardToday(userId: number) {
    const dateKey = getTodayDateKey('Asia/Ho_Chi_Minh');

    const activeQuests = await this.assignedQuests(userId, dateKey);

    const progressRows = await this.prisma.userQuestProgress.findMany({
      where: {
        userId,
        dateKey,
        questId: { in: activeQuests.map((quest) => quest.id) },
      },
      include: { quest: true },
    });
    const progressByQuestId = new Map(
      progressRows.map((progress) => [progress.questId, progress]),
    );
    const progresses = activeQuests.map((quest) => {
      const progress = progressByQuestId.get(quest.id);
      return {
        id: progress?.id ?? -quest.id,
        questId: quest.id,
        currentValue: progress?.currentValue ?? 0,
        isCompleted: progress?.isCompleted ?? false,
        quest,
      };
    });

    const startOfToday = new Date(`${dateKey}T00:00:00+07:00`);
    const endOfToday = new Date(`${dateKey}T23:59:59.999+07:00`);

    const activities = await this.prisma.learningActivity.findMany({
      where: {
        userId,
        occurredAt: {
          gte: startOfToday,
          lte: endOfToday,
        },
      },
      orderBy: { occurredAt: 'desc' },
      take: 20,
    });

    const completedCount = progresses.filter((p) => p.isCompleted).length;
    const totalCount = progresses.length;
    // The dashboard summary measures completed quests, not weighted item progress.
    // Individual quest cards still expose their own value-based progressPercent.
    const progressPercent =
      totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
    const earnedXp = progresses
      .filter((p) => p.isCompleted)
      .reduce((sum, p) => sum + (p.quest?.rewardXP || 0), 0);
    const earnedBanh = progresses
      .filter((p) => p.isCompleted)
      .reduce((sum, p) => sum + (p.quest?.rewardBanh || 0), 0);

    return {
      dateKey,
      timezone: 'Asia/Ho_Chi_Minh',
      activities,
      quests: progresses.map((p) => ({
        ...getQuestAction(p.quest.type),
        id: p.id,
        questId: p.questId,
        title: p.quest.title,
        description: p.quest.description,
        type: p.quest.type,
        currentValue: Math.min(p.currentValue, p.quest.targetValue),
        targetValue: p.quest.targetValue,
        rewardXP: p.quest.rewardXP,
        rewardBanh: p.quest.rewardBanh,
        isCompleted: p.isCompleted,
        progressPercent:
          p.quest.targetValue > 0
            ? Math.min(
                100,
                Math.round((p.currentValue / p.quest.targetValue) * 100),
              )
            : 0,
        quest: p.quest,
      })),
      summary: {
        completedCount,
        totalCount,
        progressPercent,
        earnedXp,
        earnedBanh,
      },
    };
  }

  /**
   * Today's quests for this learner (daily-quest-catalog.ts), each with the id
   * of the DailyQuest row that anchors its progress. The catalog decides the
   * title, target and reward; a missing anchor row is created.
   */
  async assignedQuests(userId: number, dateKey: string) {
    const definitions = questsForDay(userId, dateKey);
    const rows = await this.prisma.dailyQuest.findMany({
      where: { type: { in: definitions.map((quest) => quest.type) } },
      orderBy: { id: 'asc' },
    });
    const assigned: Array<
      DailyQuestDefinition & { id: number; isActive: boolean }
    > = [];
    for (const definition of definitions) {
      const row =
        rows.find((candidate) => candidate.type === definition.type) ??
        (await this.prisma.dailyQuest.create({
          data: { ...definition, isActive: true },
        }));
      assigned.push({ ...definition, id: row.id, isActive: true });
    }
    return assigned;
  }

  /** Advances the learner's quests of these types that are assigned today. */
  async advanceAssignedQuests(
    userId: number,
    types: readonly string[],
    today: string,
  ) {
    if (!types.length) return;
    for (const quest of await this.assignedQuests(userId, today)) {
      if (!types.includes(quest.type)) continue;
      await this.advanceDailyQuestAndGrantRewardsTx(userId, quest, 1, today);
    }
  }

  async getMyDailyQuests(userId: number) {
    const today = getTodayDateKey('Asia/Ho_Chi_Minh');

    const activeQuests = await this.assignedQuests(userId, today);

    const progressRows = await this.prisma.userQuestProgress.findMany({
      where: {
        userId,
        dateKey: today,
        questId: { in: activeQuests.map((quest) => quest.id) },
      },
      include: { quest: true },
    });
    const progressByQuestId = new Map(
      progressRows.map((progress) => [progress.questId, progress]),
    );

    return activeQuests.map((quest) => {
      const progress = progressByQuestId.get(quest.id);
      return {
        id: progress?.id ?? -quest.id,
        questId: quest.id,
        currentValue: progress?.currentValue ?? 0,
        isCompleted: progress?.isCompleted ?? false,
        quest,
      };
    });
  }

  async getArenaSnippet(userId: number) {
    const myLeaderboard = await this.prisma.leaderboard.findUnique({
      where: { userId },
    });
    const tier = myLeaderboard?.tier || 'Đồng';

    const leaderboardRes = await this.getLeaderboard(tier, 'tier', userId);
    const myRank = leaderboardRes.currentUserRank?.rank;

    if (!myRank) {
      return {
        rank: null,
        tier: 'Đồng',
        message: 'Bạn chưa có mặt trên bảng xếp hạng tuần này.',
      };
    }

    return {
      rank: myRank,
      tier,
      message:
        myRank === 1
          ? `Tuyệt vời! Bạn đang dẫn đầu bảng xếp hạng.`
          : `Bạn đang ở vị trí Top ${myRank} bảng xếp hạng!`,
    };
  }

  // ==========================================
  // ADVANCED GAMIFICATION (LEAGUES, STREAKS)
  // ==========================================

  async triggerDailyCron(dayKey = getBusinessDayKey()) {
    const previousDayStart = getBusinessDayStart(
      getPreviousBusinessDayKey(dayKey),
    );
    const processedAt = new Date();
    const batchSize = 200;
    let processedCount = 0;

    // Each batch has its own short transaction. The predicate is intentionally
    // idempotent, so a retry after a partial failure cannot decrement twice.
    while (true) {
      const batch = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('cron-daily-streak'))`;
        const setting = await tx.gameSettings.findUnique({
          where: { gameId: 'cron-daily-streak' },
        });
        const config =
          (setting?.config as Record<string, unknown> | null) || {};
        if (config.lastProcessedDay === dayKey) {
          return { done: true, count: 0 };
        }

        const stats = await tx.userStats.findMany({
          where: {
            lastStreakUpdate: { lt: previousDayStart },
            streakCount: { gt: 0 },
          },
          orderBy: { id: 'asc' },
          take: batchSize,
        });

        for (const stat of stats) {
          if (stat.streakFreezes > 0) {
            await tx.userStats.update({
              where: { id: stat.id },
              data: {
                streakFreezes: { decrement: 1 },
                lastStreakUpdate: processedAt,
              },
            });
            // Same transaction as the shield it reports, so a retried batch
            // cannot tell the learner twice.
            await tx.notification.create({
              data: {
                userId: stat.userId,
                ...streakShieldUsedNotice({
                  streak: stat.streakCount,
                  remaining: stat.streakFreezes - 1,
                }),
              },
            });
          } else {
            await tx.userStats.update({
              where: { id: stat.id },
              data: { streakCount: 0 },
            });
          }
        }
        return { done: stats.length === 0, count: stats.length };
      });

      processedCount += batch.count;
      if (batch.done) break;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('cron-daily-streak'))`;
      const setting = await tx.gameSettings.findUnique({
        where: { gameId: 'cron-daily-streak' },
      });
      const config = (setting?.config as Record<string, unknown> | null) || {};
      if (config.lastProcessedDay !== dayKey) {
        await tx.gameSettings.upsert({
          where: { gameId: 'cron-daily-streak' },
          update: {
            config: {
              lastProcessedDay: dayKey,
              processedAt: processedAt.toISOString(),
            },
          },
          create: {
            gameId: 'cron-daily-streak',
            config: {
              lastProcessedDay: dayKey,
              processedAt: processedAt.toISOString(),
            },
          },
        });
      }
    });

    return {
      success: true,
      noop: processedCount === 0,
      message:
        processedCount === 0
          ? `Ngày ${dayKey} không có người dùng cần xử lý.`
          : `Processed ${processedCount} inactive users for ${dayKey}.`,
    };
  }

  /**
   * `catchUp`: called at backend startup rather than by the Monday 00:01
   * cron; it resets only when this week has not been reset yet
   * (weeklyCatchUpDue), so a restart never resets the league mid-week.
   */
  async triggerWeeklyCron(
    isManualTrigger = false,
    weekKeyOverride?: string,
    catchUp = false,
  ) {
    const tiers = ['Đồng', 'Bạc', 'Vàng', 'Bạch Kim', 'Kim Cương'];
    const now = new Date();
    const weekKey = weekKeyOverride || getBusinessWeekKey(now);
    const maxAttempts = isManualTrigger ? 3 : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const result = await this.prisma.$transaction(async (tx) => {
        const lockResult: any = await tx.$queryRaw`
          SELECT pg_try_advisory_xact_lock(hashtext('cron-weekly-league')) AS locked
        `;
        if (!lockResult?.[0]?.locked) {
          return { acquired: false, noop: true };
        }

        // Prisma creates this table and column with quoted, case-sensitive
        // identifiers. Keep the row lock query aligned with the actual
        // PostgreSQL names; unquoted `GameSettings` is folded to
        // `gamesettings` and fails with 42P01.
        await tx.$queryRaw`
          SELECT * FROM "GameSettings"
          WHERE "gameId" = 'cron-weekly-league'
          FOR UPDATE
        `;
        const setting = await tx.gameSettings.findUnique({
          where: { gameId: 'cron-weekly-league' },
        });
        const config =
          (setting?.config as Record<string, unknown> | null) || {};
        if (config.lastProcessedWeek === weekKey) {
          return { acquired: true, noop: true };
        }
        if (
          catchUp &&
          !weeklyCatchUpDue(config, weekKey, getBusinessWeekStart(now))
        ) {
          return { acquired: true, noop: true };
        }

        const snapshot = await tx.leaderboard.findMany({
          orderBy: [{ weeklyExp: 'desc' }, { id: 'asc' }],
        });
        const updates: Array<{ id: number; tier: string; weeklyExp: number }> =
          [];
        for (let i = 0; i < tiers.length; i++) {
          const currentTier = tiers[i];
          const users = snapshot.filter((u) => u.tier === currentTier);
          const topCount = Math.max(1, Math.floor(users.length * 0.2));
          const bottomStart = Math.max(
            users.length - Math.floor(users.length * 0.2),
            topCount,
          );
          users.forEach((user, index) => {
            let newTier = currentTier;
            if (index < topCount && i < tiers.length - 1)
              newTier = tiers[i + 1];
            else if (index >= bottomStart && i > 0) newTier = tiers[i - 1];
            updates.push({ id: user.id, tier: newTier, weeklyExp: 0 });
          });
        }

        for (const update of updates) {
          await tx.leaderboard.update({
            where: { id: update.id },
            data: { tier: update.tier, weeklyExp: update.weeklyExp },
          });
        }

        await tx.gameSettings.upsert({
          where: { gameId: 'cron-weekly-league' },
          update: {
            config: {
              lastProcessedWeek: weekKey,
              processedAt: now.toISOString(),
            },
          },
          create: {
            gameId: 'cron-weekly-league',
            config: {
              lastProcessedWeek: weekKey,
              processedAt: now.toISOString(),
            },
          },
        });
        return { acquired: true, noop: false };
      });

      if (result.acquired) {
        await this.redis.set(
          `gamification:cron:weekly:${weekKey}:completed`,
          '1',
          'EX',
          7 * 86400,
        );
        return {
          success: true,
          noop: result.noop,
          message: result.noop
            ? `Tuần ${weekKey} đã được xử lý trước đó.`
            : `Weekly league ${weekKey} processed successfully.`,
        };
      }
      if (attempt < maxAttempts)
        await new Promise((resolve) => setTimeout(resolve, 250));
    }

    return {
      success: true,
      noop: true,
      message: 'Weekly cron đang được xử lý bởi tiến trình khác.',
    };
  }

  async sendAdmiration(
    senderId: number,
    targetUserId: number,
    message?: string,
  ) {
    if (senderId === targetUserId) {
      throw new BadRequestException(
        'Bạn không thể tự gửi ngưỡng mộ cho chính mình!',
      );
    }

    const sender = await this.prisma.user.findUnique({
      where: { id: senderId },
      include: { profile: true },
    });

    const targetUser = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      include: { stats: true },
    });

    if (!targetUser) {
      throw new BadRequestException('Không tìm thấy học viên nhận ngưỡng mộ!');
    }

    const senderName =
      sender?.profile?.fullName || sender?.email || 'Một bạn học';
    const admirationMsg =
      message || 'Rất ngưỡng mộ thành tích học tập của bạn! Cùng cố gắng nhé!';

    // Send Web Push Notification to target user
    if (this.notificationsService) {
      void this.notificationsService.sendPushToUser(targetUserId, {
        title: 'Bạn nhận được lời ngưỡng mộ mới!',
        body: `${senderName}: "${admirationMsg}"`,
        icon: sender?.profile?.avatar || '/icons/icon-192.png',
        url: '/student/profile',
      });
    }

    return {
      success: true,
      message: `Đã gửi lời ngưỡng mộ tới bạn học thành công!`,
    };
  }
}
