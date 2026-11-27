import type { PracticeLevel } from '@prisma/client';

import {
  PRACTICE_LEVEL_LABEL,
  requiredPracticePlan,
  type PracticePlan,
  type PracticeSkill,
} from './practice-level';

/**
 * What a learner used in the current paid plan that FREE does not open: the
 * "bạn sẽ mất gì" list shown before the plan ends. Counted per skill and
 * practice level (labels only).
 */
export type PracticedItem = {
  skill: PracticeSkill;
  /** The quiz's or the speaking set's practice level. */
  level: PracticeLevel | null;
  dictation?: boolean;
};

export type LockedGroup = {
  skill: PracticeSkill;
  levelGroup: PracticeLevel;
  requiredPlan: Exclude<PracticePlan, 'FREE'>;
  label: string;
  count: number;
};

const SKILL_LABEL: Record<PracticeSkill, string> = {
  LISTENING: 'Nghe',
  READING: 'Đọc',
  SPEAKING: 'Nói',
  WRITING: 'Viết',
};

export function lockedAfterExpiry(items: PracticedItem[]): LockedGroup[] {
  const groups = new Map<string, LockedGroup>();
  for (const item of items) {
    const group = item.level;
    if (!group) continue;
    const required = requiredPracticePlan(item.skill, group, {
      dictation: item.dictation,
    });
    if (required === 'FREE') continue;
    const name =
      item.skill === 'LISTENING' && item.dictation
        ? 'Nghe chép'
        : SKILL_LABEL[item.skill];
    const key = `${name}|${group}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    groups.set(key, {
      skill: item.skill,
      levelGroup: group,
      requiredPlan: required,
      label: `${name} ${PRACTICE_LEVEL_LABEL[group]}`,
      count: 1,
    });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days left, rounded up: 1 until the last minute, 0 once ended. */
export function daysLeft(endsAt: Date, now: Date): number {
  return Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / DAY_MS));
}
