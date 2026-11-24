/**
 * Lên cấp (owner 2026-11-24): the learner was told nothing when their XP level
 * or their thú ảo went up a level. Each level-up now leaves one line in
 * Thông báo; the web app shows a toast for it and marks the line read.
 *
 * Pure: no Prisma, no I/O.
 */

/** Notification type prefixes; the level follows the ":" (one line per level). */
export const LEVEL_UP_NOTICE_TYPE = 'level_up';
export const PET_LEVEL_UP_NOTICE_TYPE = 'pet_level_up';

/** 1020 -> "1.020", the way Vietnamese writes thousands. */
function formatCount(value: number): string {
  return String(Math.max(0, Math.floor(value))).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    '.',
  );
}

/** Total XP at which level L starts (ranking.logic.ts xpLevel: 50·L·(L−1)). */
function xpLevelStart(level: number): number {
  return 50 * level * (level - 1);
}

/** What the learner is told when their XP level goes up. */
export function levelUpNotice(input: { level: number; totalPoints: number }) {
  const level = Math.max(1, Math.floor(input.level));
  const totalPoints = Math.max(0, Math.floor(input.totalPoints));
  const remaining = xpLevelStart(level + 1) - totalPoints;
  return {
    type: `${LEVEL_UP_NOTICE_TYPE}:${level}`,
    title: `Bạn đã lên Cấp ${level}`,
    body:
      `Bạn đã có ${formatCount(totalPoints)} XP.` +
      (remaining > 0
        ? ` Còn ${formatCount(remaining)} XP để lên Cấp ${level + 1}.`
        : ''),
    url: '/ranking',
  };
}

/** What the learner is told when their thú ảo goes up a level. */
export function petLevelUpNotice(input: {
  level: number;
  /** EXP still needed for the next level; nothing is said when 0 or less. */
  expToNext: number;
}) {
  const level = Math.max(1, Math.floor(input.level));
  const expToNext = Math.floor(input.expToNext);
  return {
    type: `${PET_LEVEL_UP_NOTICE_TYPE}:${level}`,
    title: `Thú ảo đã lên Cấp ${level}`,
    body:
      'Thú ảo lớn lên nhờ bài luyện tập và bữa ăn mỗi ngày.' +
      (expToNext > 0
        ? ` Còn ${formatCount(expToNext)} EXP để lên Cấp ${level + 1}.`
        : ''),
    url: '/pet',
  };
}
