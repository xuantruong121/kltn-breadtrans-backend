/**
 * The Monday report: what the learner practised last week, how their
 * practice scores moved, which skill to put first this week and how many
 * days remain to their exam date. Pure: no Prisma, no I/O.
 *
 * Scores are BreadTrans practice percentages. The message says so in plain
 * words: they are internal practice indicators, not an official exam score.
 */
import type { PracticeSkill } from '@prisma/client';

import { PRACTICE_SKILLS } from '../learning-path/placement.logic';
import { SKILL_LABEL } from '../learning-path/recommendation.logic';

const DAY_MS = 24 * 60 * 60 * 1000;
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

export const PRACTICE_SCORE_NOTE =
  'Điểm ở đây là chỉ số luyện tập nội bộ của BreadTrans, không phải điểm thi chính thức.';

/** Notification type, one per learner and week, so a rerun sends nothing new. */
export const weeklyReportType = (weekKey: string) => `weekly_report:${weekKey}`;

export type ProgressEvent = {
  skill: PracticeSkill;
  scorePercent: number;
  createdAt: Date;
};

export type SkillWeek = {
  skill: PracticeSkill;
  /** Items done last week. */
  count: number;
  /** Average practice score last week, or null with no items. */
  average: number | null;
  /** Average the week before, or null with no items. */
  previousAverage: number | null;
  /** Items planned per week for this skill (learning-path weeklyTargets). */
  target: number;
};

const mean = (values: number[]) =>
  values.length
    ? Math.round(values.reduce((sum, v) => sum + v, 0) / values.length)
    : null;

/**
 * Splits the events into last week [weekStart - 7d, weekStart) and the week
 * before it, per skill. `weekStart` is this Monday 00:00 in Vietnam.
 */
export function summarizeWeeks(input: {
  events: ProgressEvent[];
  weekStart: Date;
  targets: Record<PracticeSkill, number>;
}): SkillWeek[] {
  const lastStart = input.weekStart.getTime() - 7 * DAY_MS;
  const previousStart = lastStart - 7 * DAY_MS;
  const end = input.weekStart.getTime();
  return PRACTICE_SKILLS.map((skill) => {
    const own = input.events.filter((e) => e.skill === skill);
    const last = own.filter(
      (e) => e.createdAt.getTime() >= lastStart && e.createdAt.getTime() < end,
    );
    const previous = own.filter(
      (e) =>
        e.createdAt.getTime() >= previousStart &&
        e.createdAt.getTime() < lastStart,
    );
    return {
      skill,
      count: last.length,
      average: mean(last.map((e) => e.scorePercent)),
      previousAverage: mean(previous.map((e) => e.scorePercent)),
      target: input.targets[skill],
    };
  });
}

/**
 * The skill furthest behind its weekly target last week. Ties go to the
 * skill with the larger target, then to the fixed skill order.
 */
export function focusSkill(skills: SkillWeek[]): SkillWeek | null {
  const behind = skills.filter((s) => s.count < s.target);
  if (!behind.length) return null;
  return behind.reduce((best, s) => {
    const ratio = s.count / s.target;
    const bestRatio = best.count / best.target;
    if (ratio !== bestRatio) return ratio < bestRatio ? s : best;
    return s.target > best.target ? s : best;
  });
}

/** Whole Vietnam calendar days from `now` to `target`, or null. */
export function daysUntil(target: Date | null, now: Date): number | null {
  if (!target) return null;
  const day = (d: Date) => Math.floor((d.getTime() + VN_OFFSET_MS) / DAY_MS);
  return day(target) - day(now);
}

const two = (n: number) => String(n).padStart(2, '0');
/** "27/10 – 02/11" for the week before `weekStart`. */
export function lastWeekLabel(weekStart: Date): string {
  const dm = (ms: number) => {
    const d = new Date(ms + VN_OFFSET_MS);
    return `${two(d.getUTCDate())}/${two(d.getUTCMonth() + 1)}`;
  };
  const start = weekStart.getTime() - 7 * DAY_MS;
  return `${dm(start)} – ${dm(weekStart.getTime() - DAY_MS)}`;
}

/** The skill whose average rose most against the week before (both weeks practised). */
function bestRise(skills: SkillWeek[]) {
  const moved = skills
    .filter((s) => s.average !== null && s.previousAverage !== null)
    .map((s) => ({ s, delta: s.average! - s.previousAverage! }))
    .sort((a, b) => b.delta - a.delta);
  return moved[0] ?? null;
}

export function weeklyReportMessage(input: {
  weekStart: Date;
  skills: SkillWeek[];
  daysToExam: number | null;
  /** What the learner got wrong most last week (mistake notebook), if known. */
  mistakeTags?: string[];
}) {
  const total = input.skills.reduce((sum, s) => sum + s.count, 0);
  const week = lastWeekLabel(input.weekStart);
  const parts: string[] = [];

  if (total === 0) {
    parts.push(`Tuần ${week} bạn chưa luyện bài nào.`);
  } else {
    const bySkill = input.skills
      .filter((s) => s.count > 0)
      .map((s) => `${SKILL_LABEL[s.skill]} ${s.count}`)
      .join(', ');
    parts.push(`Tuần ${week} bạn đã luyện ${total} bài (${bySkill}).`);
    const rise = bestRise(input.skills);
    if (rise && rise.delta > 0)
      parts.push(
        `${SKILL_LABEL[rise.s.skill]}: điểm luyện tập trung bình ${rise.s.average}%, tăng ${rise.delta} điểm so với tuần trước.`,
      );
    else if (rise)
      parts.push(
        `${SKILL_LABEL[rise.s.skill]}: điểm luyện tập trung bình ${rise.s.average}% (tuần trước ${rise.s.previousAverage}%).`,
      );
  }

  const tags = (input.mistakeTags ?? []).filter(Boolean).slice(0, 3);
  if (tags.length)
    parts.push(
      `Lỗi hay gặp tuần qua: ${tags.join('; ')}. Mở Sổ lỗi để ôn lại.`,
    );

  const focus = focusSkill(input.skills);
  if (focus)
    parts.push(
      `Tuần này nên ưu tiên ${SKILL_LABEL[focus.skill]}: mục tiêu ${focus.target} bài.`,
    );
  else parts.push('Bạn đã đạt mục tiêu tuần của cả bốn kỹ năng.');

  if (input.daysToExam !== null && input.daysToExam > 0)
    parts.push(`Còn ${input.daysToExam} ngày tới ngày thi bạn đặt.`);
  if (total > 0) parts.push(PRACTICE_SCORE_NOTE);

  return {
    title:
      total === 0
        ? 'Tuần mới, bắt đầu lại nhé'
        : `Tuần qua bạn luyện ${total} bài`,
    body: parts.join(' '),
    url: '/dashboard',
  };
}
