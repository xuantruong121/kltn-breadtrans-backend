/**
 * Bảng xếp hạng (owner 2026-11-08): levels from XP, periods in Vietnam time,
 * the weekly league standing, masked names and the activity feed's words.
 * Pure: no Prisma, no I/O.
 */
import { vietnamDayStart } from '../events/arena-questions.logic';

export type RankingMetric = 'xp' | 'streak' | 'referral';
export type RankingPeriod = 'today' | 'week' | 'month' | 'all';
export const RANKING_METRICS: RankingMetric[] = ['xp', 'streak', 'referral'];
export const RANKING_PERIODS: RankingPeriod[] = [
  'today',
  'week',
  'month',
  'all',
];
export const RANKING_SIZE = 50;

/** Level L takes 50·L·(L−1) XP in total: Lv. 2 at 100, Lv. 3 at 300, Lv. 4 at 600. */
export function xpLevel(totalPoints: number): number {
  const xp = Math.max(0, totalPoints);
  let level = Math.floor((1 + Math.sqrt(1 + (8 * xp) / 100)) / 2);
  // Guard the floating point at exact thresholds.
  while (50 * (level + 1) * level <= xp) level += 1;
  while (level > 1 && 50 * level * (level - 1) > xp) level -= 1;
  return Math.max(1, level);
}

/** "Nguyễn Văn An" → "Nguyễn A.": enough to recognise a friend, not to find a stranger. */
export function maskName(fullName: string | null | undefined): string {
  const words = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'Học viên';
  if (words.length === 1) return words[0];
  const last = words[words.length - 1];
  return `${words[0]} ${last.charAt(0).toLocaleUpperCase('vi-VN')}.`;
}

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Where a period begins, in Vietnam time; the week starts on Monday like the league. */
export function periodStart(period: RankingPeriod, now: Date): Date | null {
  if (period === 'all') return null;
  const day = vietnamDayStart(now);
  if (period === 'today') return day;
  const local = new Date(day.getTime() + VN_OFFSET_MS);
  if (period === 'week') {
    const sinceMonday = (local.getUTCDay() + 6) % 7;
    return new Date(day.getTime() - sinceMonday * DAY_MS);
  }
  return new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - VN_OFFSET_MS,
  );
}

export const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100, 200, 365];

/** The milestone a streak just reached, or null. */
export function streakMilestone(before: number, after: number): number | null {
  if (after <= before) return null;
  return STREAK_MILESTONES.find((m) => before < m && after >= m) ?? null;
}

export const LEAGUE_TIERS = ['Đồng', 'Bạc', 'Vàng', 'Bạch Kim', 'Kim Cương'];

/**
 * A learner's place in the weekly league, as triggerWeeklyCron moves people:
 * the top 20 % of a tier go up, the bottom 20 % go down (never below Đồng,
 * never above Kim Cương). `cutoffXp` is the week's XP of the last learner in
 * the promotion zone, `safeXp` that of the last learner above the demotion zone.
 */
export function leagueStanding(input: {
  tier: string;
  tierSize: number;
  rankInTier: number;
  myXp: number;
  cutoffXp: number | null;
  safeXp: number | null;
}) {
  const index = Math.max(0, LEAGUE_TIERS.indexOf(input.tier));
  const n = Math.max(0, Math.floor(input.tierSize));
  const promoteCount =
    n === 0 || index === LEAGUE_TIERS.length - 1
      ? 0
      : Math.max(1, Math.floor(n * 0.2));
  const bottomStart = Math.max(
    n - Math.floor(n * 0.2),
    Math.max(1, Math.floor(n * 0.2)),
  );
  const demoteFrom = index === 0 || bottomStart >= n ? null : bottomStart + 1;
  const xpToPromotion =
    promoteCount <= 0
      ? null
      : input.rankInTier <= promoteCount
        ? 0
        : input.cutoffXp === null
          ? null
          : Math.max(1, input.cutoffXp - input.myXp + 1);
  const inDemotionZone = demoteFrom !== null && input.rankInTier >= demoteFrom;
  return {
    tier: LEAGUE_TIERS[index],
    rankInTier: input.rankInTier,
    tierSize: n,
    promoteCount,
    demoteFrom,
    xpToPromotion,
    inDemotionZone,
    xpToLeaveDemotion:
      inDemotionZone && input.safeXp !== null
        ? Math.max(1, input.safeXp - input.myXp + 1)
        : null,
  };
}

/** A Hầm Bánh Mì run reaches the activity feed from this floor down. */
export const DUNGEON_FEED_FLOOR = 10;

export type FeedSource =
  | { kind: 'activity'; type: string }
  | { kind: 'badge'; name: string }
  | { kind: 'arena_win' }
  | { kind: 'event'; type: string; value: number };

const ACTIVITY_TEXT: Record<string, string> = {
  READING_PRACTICE_COMPLETED: 'vừa hoàn thành 1 bài luyện đọc',
  LISTENING_PRACTICE_COMPLETED: 'vừa hoàn thành 1 bài luyện nghe',
  WRITING_PRACTICE_COMPLETED: 'vừa hoàn thành 1 bài luyện viết',
  CONTENT: 'vừa hoàn thành 1 bài luyện tập',
  DIAGNOSTIC: 'vừa làm bài kiểm tra đầu vào',
};

/**
 * One feed line ("vừa đạt chuỗi 7 ngày") and its kind, or null for events
 * the feed leaves out (each mastered word would drown the rest).
 */
export function activityText(source: FeedSource): {
  text: string;
  kind: 'study' | 'badge' | 'arena' | 'level' | 'streak';
} | null {
  if (source.kind === 'activity') {
    const text = ACTIVITY_TEXT[source.type];
    return text ? { text, kind: 'study' } : null;
  }
  if (source.kind === 'badge')
    return { text: `vừa nhận huy hiệu ${source.name}`, kind: 'badge' };
  if (source.kind === 'arena_win')
    return { text: 'vừa thắng 1 trận Đấu trường', kind: 'arena' };
  if (source.type === 'LEVEL_UP')
    return { text: `vừa lên Cấp ${source.value}`, kind: 'level' };
  if (source.type === 'STREAK_MILESTONE')
    return { text: `vừa đạt chuỗi ${source.value} ngày`, kind: 'streak' };
  // Hầm Bánh Mì runs: only the deep ones make the feed (owner 2026-11-09).
  if (
    (source.type === 'DUNGEON_DAILY' || source.type === 'DUNGEON_FREE') &&
    source.value >= DUNGEON_FEED_FLOOR
  )
    return {
      text: `vừa xuống tới tầng ${source.value} Hầm Bánh Mì`,
      kind: 'arena',
    };
  return null;
}
