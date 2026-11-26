import { BadRequestException } from '@nestjs/common';
import { periodStart } from '../gamification/ranking.logic';
import {
  getLearnerDayKey,
  getLearnerDayStartOf,
} from '../../common/time/business-time.util';

/**
 * The dashboard's "Kết quả học tập" (owner 2026-11-26: its figures were made
 * up in the browser, e.g. "1m" of study with nothing done, or the month's XP
 * as 40 % of all XP). Everything here comes from the learner's own rows.
 */

/** Where study time is counted: the practice rooms, by what they train. */
export const STUDY_SKILLS = [
  'LISTENING',
  'READING',
  'WRITING',
  'SPEAKING',
  'VOCAB',
  'GRAMMAR',
  'EXAM',
  'DIAGNOSTIC',
] as const;
export type StudySkill = (typeof STUDY_SKILLS)[number];

/** One report from the browser covers at most two minutes. */
export const MAX_SECONDS_PER_REPORT = 120;
/** No learner day holds more than twelve hours of study. */
export const MAX_SECONDS_PER_DAY = 12 * 60 * 60;

/** Seconds to add for one report, given what the day already holds. */
export function creditedSeconds(reported: number, alreadyToday: number) {
  const asked = Math.max(
    0,
    Math.min(MAX_SECONDS_PER_REPORT, Math.floor(reported)),
  );
  return Math.max(0, Math.min(asked, MAX_SECONDS_PER_DAY - alreadyToday));
}

export const SUMMARY_PERIODS = [
  'today',
  'week',
  'month',
  'all',
  'custom',
] as const;
export type SummaryPeriod = (typeof SUMMARY_PERIODS)[number];

const DAY_MS = 86_400_000;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

const nextDayKey = (key: string) =>
  new Date(
    Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10) + 1),
  )
    .toISOString()
    .slice(0, 10);

/**
 * The span of a period on learner days (Vietnam time, turning at 00:01): from
 * `start` (null = since the beginning) to `end`, and the same span as learner
 * day keys for the study-time rows. A custom range runs from the first
 * chosen day to the end of the last one, at most a year, never past today.
 */
export function summaryRange(
  period: SummaryPeriod,
  now: Date,
  from?: string,
  to?: string,
): { start: Date | null; end: Date; startKey: string | null; endKey: string } {
  const todayKey = getLearnerDayKey(now);
  if (period !== 'custom') {
    const start = periodStart(period, now);
    return {
      start,
      end: now,
      startKey: start
        ? getLearnerDayKey(new Date(start.getTime() + 1000))
        : null,
      endKey: todayKey,
    };
  }
  if (!from || !to || !DAY_KEY.test(from) || !DAY_KEY.test(to))
    throw new BadRequestException(
      'Khoảng tùy chỉnh cần ngày bắt đầu và ngày kết thúc (YYYY-MM-DD).',
    );
  if (from > to)
    throw new BadRequestException('Ngày bắt đầu phải trước ngày kết thúc.');
  const endKey = to > todayKey ? todayKey : to;
  const start = getLearnerDayStartOf(from);
  const end = new Date(
    Math.min(getLearnerDayStartOf(nextDayKey(endKey)).getTime(), now.getTime()),
  );
  if (end.getTime() - start.getTime() > 366 * DAY_MS)
    throw new BadRequestException('Khoảng tùy chỉnh tối đa một năm.');
  return { start, end, startKey: from, endKey };
}

/** How many answers a grammar attempt holds (an array, or an object keyed by question). */
export function answerCount(answers: unknown): number {
  if (Array.isArray(answers)) return answers.length;
  if (answers && typeof answers === 'object')
    return Object.keys(answers).length;
  return 0;
}

export type SkillTile =
  'EXAM' | 'READING' | 'LISTENING' | 'SPEAKING' | 'WRITING' | 'VOCAB';
export const SKILL_TILES: SkillTile[] = [
  'EXAM',
  'READING',
  'LISTENING',
  'SPEAKING',
  'WRITING',
  'VOCAB',
];

/** The tile a quiz submission belongs to, or null for TOEIC quizzes (counted as attempts). */
export function tileOfQuizType(type: string): SkillTile | null {
  if (type === 'LISTENING_PRACTICE') return 'LISTENING';
  if (type === 'BILINGUAL_READING') return 'READING';
  if (type === 'WRITING_PICTURE' || type === 'WRITING_EMAIL') return 'WRITING';
  return null;
}

/**
 * Per tile: how many things were done, the seconds spent in its rooms and the
 * learner days with either. `done` lists [tile, at] for every finished item.
 */
export function skillBreakdown(input: {
  done: Array<[SkillTile, Date]>;
  time: Array<{ dayKey: string; skill: string; seconds: number }>;
}) {
  const out = Object.fromEntries(
    SKILL_TILES.map((t) => [
      t,
      { count: 0, seconds: 0, days: new Set<string>() },
    ]),
  ) as Record<SkillTile, { count: number; seconds: number; days: Set<string> }>;
  for (const [tile, at] of input.done) {
    out[tile].count += 1;
    out[tile].days.add(getLearnerDayKey(at));
  }
  for (const row of input.time) {
    const tile = (SKILL_TILES as string[]).includes(row.skill)
      ? (row.skill as SkillTile)
      : null;
    if (!tile || row.seconds <= 0) continue;
    out[tile].seconds += row.seconds;
    out[tile].days.add(row.dayKey);
  }
  return Object.fromEntries(
    SKILL_TILES.map((t) => [
      t,
      { count: out[t].count, seconds: out[t].seconds, days: out[t].days.size },
    ]),
  ) as Record<SkillTile, { count: number; seconds: number; days: number }>;
}

/**
 * Over every period the Flashcard tile shows the words mastered now, as the
 * flashcard page does; a shorter period counts the words mastered in it.
 */
export function withVocabCount<T extends Record<SkillTile, { count: number }>>(
  skills: T,
  masteredNow: number | null,
): T {
  if (masteredNow === null) return skills;
  return { ...skills, VOCAB: { ...skills.VOCAB, count: masteredNow } };
}

/** Learner days in a range, inclusive; null when it has no start. */
export function daysInRange(
  startKey: string | null,
  endKey: string,
): number | null {
  if (!startKey) return null;
  const a = Date.UTC(
    +startKey.slice(0, 4),
    +startKey.slice(5, 7) - 1,
    +startKey.slice(8, 10),
  );
  const b = Date.UTC(
    +endKey.slice(0, 4),
    +endKey.slice(5, 7) - 1,
    +endKey.slice(8, 10),
  );
  return Math.max(1, Math.round((b - a) / DAY_MS) + 1);
}
