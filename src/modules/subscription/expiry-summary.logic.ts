import {
  LEVEL_GROUP_LABEL,
  levelGroup,
  parseCefrRange,
  requiredPracticePlan,
  type LevelGroup,
  type PracticePlan,
  type PracticeSkill,
} from './practice-level';

/**
 * What a learner used in the current paid plan that FREE does not open: the
 * "bạn sẽ mất gì" list shown before the plan ends. Counted per skill and
 * practice level (labels only, no CEFR code is shown to learners).
 */
export type PracticedItem = {
  skill: PracticeSkill;
  /** Title or set level that carries the CEFR tag ("Writing B1 — …", "B1-B2"). */
  levelSource: string | null;
  dictation?: boolean;
};

export type LockedGroup = {
  skill: PracticeSkill;
  levelGroup: LevelGroup;
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
    const range = parseCefrRange(item.levelSource ?? '');
    if (!range) continue;
    const required = requiredPracticePlan(item.skill, range, {
      dictation: item.dictation,
    });
    const group = levelGroup(range);
    if (required === 'FREE' || !group) continue;
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
      label: `${name} ${LEVEL_GROUP_LABEL[group]}`,
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
