import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, ReferralStatus, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TtlMemo } from '../../common/utils/ttl-memo';
import {
  RANKING_METRICS,
  RANKING_PERIODS,
  RANKING_SIZE,
  activityText,
  leagueStanding,
  DUNGEON_FEED_FLOOR,
  maskName,
  periodStart,
  xpLevel,
  type FeedSource,
  type RankingMetric,
  type RankingPeriod,
} from './ranking.logic';

export type RankingEntry = {
  rank: number;
  userId: number;
  displayName: string;
  avatarUrl: string | null;
  level: number;
  tier: string;
  value: number;
};

export type HallOfFameEntry = {
  userId: number;
  displayName: string;
  avatarUrl: string | null;
  value: number;
} | null;

export type ActivityItem = {
  id: string;
  name: string;
  avatarUrl: string | null;
  text: string;
  kind: 'study' | 'badge' | 'arena' | 'level' | 'streak';
  at: string;
};

const FEED_SIZE = 15;
const STUDY_TYPES = [
  'READING_PRACTICE_COMPLETED',
  'LISTENING_PRACTICE_COMPLETED',
  'WRITING_PRACTICE_COMPLETED',
  'CONTENT',
  'DIAGNOSTIC',
];

/**
 * The ranking page (owner 2026-11-08): XP by day, week, month or all time,
 * the current streak, and referrals; the learner's own place and weekly
 * league standing; a hall of fame; and a feed of recent learning with masked
 * names. Learners only (role STUDENT).
 */
/** How long a computed standing is reused (see standings()). */
export const RANKING_CACHE_MS = 60_000;

@Injectable()
export class RankingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every learner's value for a metric and period, best first, computed once
   * a minute. The day and month XP rankings add up the whole PointHistory,
   * which grows with every XP award: per request, the ranking page took 9 s at
   * p95 once a few thousand submissions had piled up (capacity run
   * 2026-11-09). The top list, the total and anyone's rank now come from
   * here; a learner's own value is still read live.
   */
  private readonly standingsMemo = new TtlMemo<
    string,
    { list: { userId: number; value: number }[]; desc: number[] }
  >(RANKING_CACHE_MS);
  private readonly entriesMemo = new TtlMemo<string, RankingEntry[]>(
    RANKING_CACHE_MS,
  );

  private standings(
    metric: RankingMetric,
    period: RankingPeriod,
    start: Date | null,
  ) {
    return this.standingsMemo.get(
      `${metric}:${period}:${start?.toISOString() ?? 'all'}`,
      async () => {
        const list = await this.load(metric, period, start);
        return { list, desc: list.map((r) => r.value) };
      },
    );
  }

  async getRanking(
    metricRaw: string | undefined,
    periodRaw: string | undefined,
    currentUserId?: number,
  ) {
    const metric = (metricRaw ?? 'xp') as RankingMetric;
    const period = (periodRaw ?? 'week') as RankingPeriod;
    if (!RANKING_METRICS.includes(metric) || !RANKING_PERIODS.includes(period))
      throw new BadRequestException('Tiêu chí hoặc kỳ xếp hạng không hợp lệ.');

    const start = periodStart(period, new Date());
    const entries = await this.entriesMemo.get(
      `${metric}:${period}:${start?.toISOString() ?? 'all'}`,
      async () => {
        const rows = await this.top(metric, period, start);
        const people = await this.people(rows.map((r) => r.userId));
        return rows
          .filter((r) => people.has(r.userId))
          .map((r, i) => ({
            rank: i + 1,
            ...people.get(r.userId)!,
            value: r.value,
          }));
      },
    );

    let me: Record<string, unknown> | null = null;
    if (currentUserId) {
      const value = await this.valueOf(metric, period, start, currentUserId);
      const rank =
        value > 0
          ? (entries.find((e) => e.userId === currentUserId)?.rank ??
            (await this.countAbove(metric, period, start, value)) + 1)
          : null;
      const [mine] = [...(await this.people([currentUserId])).values()];
      me = {
        rank,
        value,
        level: mine?.level ?? 1,
        tier: mine?.tier ?? 'Đồng',
        league: await this.league(currentUserId),
      };
    }
    return {
      metric,
      period,
      entries,
      total: await this.total(metric, period, start),
      me,
    };
  }

  async getHallOfFame() {
    const [xp] = await this.top('xp', 'all', null, 1);
    const [streak] = await this.top('streak', 'all', null, 1);
    const [referral] = await this.top('referral', 'all', null, 1);
    const people = await this.people(
      [xp, streak, referral].filter(Boolean).map((r) => r.userId),
    );
    const pick = (row?: { userId: number; value: number }): HallOfFameEntry => {
      const p = row && people.get(row.userId);
      return p && row
        ? {
            userId: row.userId,
            displayName: p.displayName,
            avatarUrl: p.avatarUrl,
            value: row.value,
          }
        : null;
    };
    return { xp: pick(xp), streak: pick(streak), referral: pick(referral) };
  }

  async getActivity(): Promise<ActivityItem[]> {
    const student = { role: Role.STUDENT };
    const userSelect = {
      select: {
        role: true,
        profile: { select: { fullName: true, avatar: true } },
      },
    };
    const [studies, badges, wins, events] = await Promise.all([
      this.prisma.learningActivity.findMany({
        where: { type: { in: STUDY_TYPES }, user: student },
        orderBy: { occurredAt: 'desc' },
        take: FEED_SIZE,
        select: { id: true, type: true, occurredAt: true, user: userSelect },
      }),
      this.prisma.userBadge.findMany({
        where: { user: student },
        orderBy: { awardedAt: 'desc' },
        take: FEED_SIZE,
        select: {
          id: true,
          awardedAt: true,
          badge: { select: { name: true } },
          user: userSelect,
        },
      }),
      this.prisma.gameBattle.findMany({
        where: {
          status: 'settled',
          gameId: 'vocab-duel',
          winnerUserId: { not: null },
        },
        orderBy: { settledAt: 'desc' },
        take: FEED_SIZE,
        select: { id: true, winnerUserId: true, settledAt: true },
      }),
      this.prisma.learnerEvent.findMany({
        where: {
          user: student,
          // Every Hầm Bánh Mì run is an event; only deep ones belong in the
          // feed, and they are filtered here so shallow runs cannot crowd out
          // level-ups and streaks before the feed is cut to size.
          OR: [
            { type: { notIn: ['DUNGEON_DAILY', 'DUNGEON_FREE'] } },
            { value: { gte: DUNGEON_FEED_FLOOR } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: FEED_SIZE,
        select: {
          id: true,
          type: true,
          value: true,
          createdAt: true,
          user: userSelect,
        },
      }),
    ]);
    const winners = await this.prisma.user.findMany({
      where: { id: { in: wins.map((w) => w.winnerUserId!) }, ...student },
      select: {
        id: true,
        profile: { select: { fullName: true, avatar: true } },
      },
    });
    const winnerById = new Map(winners.map((u) => [u.id, u]));

    type Raw = {
      id: string;
      at: Date;
      source: FeedSource;
      profile: { fullName: string | null; avatar: string | null } | null;
    };
    const feed = (
      id: string,
      at: Date,
      source: FeedSource,
      profile: Raw['profile'],
    ): Raw => ({ id, at, source, profile });
    const raw: Raw[] = [
      ...studies.map((s) =>
        feed(
          `study:${s.id}`,
          s.occurredAt,
          { kind: 'activity', type: s.type },
          s.user.profile,
        ),
      ),
      ...badges.map((b) =>
        feed(
          `badge:${b.id}`,
          b.awardedAt,
          { kind: 'badge', name: b.badge.name },
          b.user.profile,
        ),
      ),
      ...wins.flatMap((w) => {
        const winner = w.winnerUserId ? winnerById.get(w.winnerUserId) : null;
        return winner && w.settledAt
          ? [
              feed(
                `arena:${w.id}`,
                w.settledAt,
                { kind: 'arena_win' },
                winner.profile,
              ),
            ]
          : [];
      }),
      ...events.map((e) =>
        feed(
          `event:${e.id}`,
          e.createdAt,
          { kind: 'event', type: e.type, value: e.value },
          e.user.profile,
        ),
      ),
    ];
    return raw
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .flatMap((r) => {
        const line = activityText(r.source);
        return line
          ? [
              {
                id: r.id,
                name: maskName(r.profile?.fullName),
                avatarUrl: r.profile?.avatar ?? null,
                text: line.text,
                kind: line.kind,
                at: r.at.toISOString(),
              },
            ]
          : [];
      })
      .slice(0, FEED_SIZE);
  }

  /** The best `take` learners for a metric and period, value > 0. */
  private async top(
    metric: RankingMetric,
    period: RankingPeriod,
    start: Date | null,
    take = RANKING_SIZE,
  ): Promise<{ userId: number; value: number }[]> {
    return (await this.standings(metric, period, start)).list.slice(0, take);
  }

  /** Every learner with a value above zero, best first (ties as before). */
  private async load(
    metric: RankingMetric,
    period: RankingPeriod,
    start: Date | null,
  ): Promise<{ userId: number; value: number }[]> {
    const student = { role: Role.STUDENT };
    if (metric === 'xp' && (period === 'week' || period === 'all')) {
      const field = period === 'week' ? 'weeklyExp' : 'totalPoints';
      const rows = await this.prisma.leaderboard.findMany({
        where: { [field]: { gt: 0 }, user: student },
        orderBy: [
          { [field]: 'desc' },
          { totalPoints: 'desc' },
          { userId: 'asc' },
        ],
        select: { userId: true, weeklyExp: true, totalPoints: true },
      });
      return rows.map((r) => ({ userId: r.userId, value: r[field] }));
    }
    if (metric === 'xp') {
      const rows = await this.prisma.$queryRaw<
        { userId: number; value: number }[]
      >`
        SELECT ph."userId" AS "userId", SUM(ph.points)::int AS value
        FROM "PointHistory" ph JOIN "User" u ON u.id = ph."userId"
        WHERE u.role = 'STUDENT' AND ph."createdAt" >= ${start}
        GROUP BY ph."userId" HAVING SUM(ph.points) > 0
        ORDER BY value DESC, ph."userId" ASC`;
      return rows.map((r) => ({ userId: r.userId, value: Number(r.value) }));
    }
    if (metric === 'streak') {
      const rows = await this.prisma.userStats.findMany({
        where: { streakCount: { gt: 0 }, user: student },
        orderBy: [{ streakCount: 'desc' }, { userId: 'asc' }],
        select: { userId: true, streakCount: true },
      });
      return rows.map((r) => ({ userId: r.userId, value: r.streakCount }));
    }
    const rows = await this.prisma.$queryRaw<
      { userId: number; value: number }[]
    >`
      SELECT r."referrerId" AS "userId", COUNT(*)::int AS value
      FROM "Referral" r JOIN "User" u ON u.id = r."referrerId"
      WHERE u.role = 'STUDENT' AND r.status = ${ReferralStatus.REWARDED}::"ReferralStatus"
        ${start ? Prisma.sql`AND r."rewardedAt" >= ${start}` : Prisma.empty}
      GROUP BY r."referrerId"
      ORDER BY value DESC, r."referrerId" ASC`;
    return rows.map((r) => ({ userId: r.userId, value: Number(r.value) }));
  }

  private async valueOf(
    metric: RankingMetric,
    period: RankingPeriod,
    start: Date | null,
    userId: number,
  ) {
    if (metric === 'xp' && (period === 'week' || period === 'all')) {
      const row = await this.prisma.leaderboard.findUnique({
        where: { userId },
        select: { weeklyExp: true, totalPoints: true },
      });
      return (period === 'week' ? row?.weeklyExp : row?.totalPoints) ?? 0;
    }
    if (metric === 'xp') {
      const sum = await this.prisma.pointHistory.aggregate({
        where: { userId, createdAt: { gte: start! } },
        _sum: { points: true },
      });
      return sum._sum.points ?? 0;
    }
    if (metric === 'streak') {
      const row = await this.prisma.userStats.findUnique({
        where: { userId },
        select: { streakCount: true },
      });
      return row?.streakCount ?? 0;
    }
    return this.prisma.referral.count({
      where: {
        referrerId: userId,
        status: ReferralStatus.REWARDED,
        ...(start ? { rewardedAt: { gte: start } } : {}),
      },
    });
  }

  /** Learners strictly ahead of a value, for a rank outside the top 50. */
  private async countAbove(
    metric: RankingMetric,
    period: RankingPeriod,
    start: Date | null,
    value: number,
  ) {
    const { desc } = await this.standings(metric, period, start);
    // `desc` is sorted best first: find the first value not above `value`.
    let lo = 0;
    let hi = desc.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (desc[mid] > value) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** How many learners have a value above zero. */
  private async total(
    metric: RankingMetric,
    period: RankingPeriod,
    start: Date | null,
  ) {
    return this.countAbove(metric, period, start, 0);
  }

  /** Name, picture, level and league tier of each learner (students only). */
  private async people(userIds: number[]) {
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, role: Role.STUDENT },
      select: {
        id: true,
        profile: { select: { fullName: true, avatar: true } },
        leaderboard: { select: { tier: true, totalPoints: true } },
      },
    });
    return new Map(
      users.map((u) => [
        u.id,
        {
          userId: u.id,
          displayName: u.profile?.fullName || `Học viên #${u.id}`,
          avatarUrl: u.profile?.avatar ?? null,
          level: xpLevel(u.leaderboard?.totalPoints ?? 0),
          tier: u.leaderboard?.tier ?? 'Đồng',
        },
      ]),
    );
  }

  /** The learner's weekly league standing, ordered like triggerWeeklyCron. */
  private async league(userId: number) {
    const mine = await this.prisma.leaderboard.findUnique({
      where: { userId },
      select: { tier: true, weeklyExp: true, totalPoints: true },
    });
    if (!mine) return null;
    const tier = mine.tier;
    const order: Prisma.LeaderboardOrderByWithRelationInput[] = [
      { weeklyExp: 'desc' },
      { totalPoints: 'desc' },
      { userId: 'asc' },
    ];
    const [tierSize, ahead] = await Promise.all([
      this.prisma.leaderboard.count({ where: { tier } }),
      this.prisma.leaderboard.count({
        where: {
          tier,
          OR: [
            { weeklyExp: { gt: mine.weeklyExp } },
            {
              weeklyExp: mine.weeklyExp,
              totalPoints: { gt: mine.totalPoints },
            },
            {
              weeklyExp: mine.weeklyExp,
              totalPoints: mine.totalPoints,
              userId: { lt: userId },
            },
          ],
        },
      }),
    ]);
    const rankInTier = ahead + 1;
    const zones = leagueStanding({
      tier,
      tierSize,
      rankInTier,
      myXp: mine.weeklyExp,
      cutoffXp: null,
      safeXp: null,
    });
    const at = async (rank: number | null) => {
      if (!rank || rank < 1) return null;
      const row = await this.prisma.leaderboard.findFirst({
        where: { tier },
        orderBy: order,
        skip: rank - 1,
        select: { weeklyExp: true },
      });
      return row?.weeklyExp ?? null;
    };
    return leagueStanding({
      tier,
      tierSize,
      rankInTier,
      myXp: mine.weeklyExp,
      cutoffXp: await at(zones.promoteCount),
      safeXp: zones.demoteFrom ? await at(zones.demoteFrom - 1) : null,
    });
  }
}
