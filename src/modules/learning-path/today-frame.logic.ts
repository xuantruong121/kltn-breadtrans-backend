import type { LearningContentType, PracticeSkill } from '@prisma/client';
import { PRACTICE_SKILLS } from './placement.logic';
import { contentKey, type Recommendation } from './recommendation.logic';

/**
 * "Bài luyện hôm nay" as a daily frame (thesis supervisor 2026-11-26): one
 * item for each of the four skills, whatever the learner's minutes per day
 * (owner: always four). A skill practised today keeps its slot as done
 * instead of being replaced, and when one skill is clearly over-practised
 * today while another has not been touched, the learner is asked to switch.
 * Pure: the service reads today's rows and the picks.
 */

/** 20 minutes of one skill today, or 3 items, is a lot for one day. */
export const OVER_SECONDS = 20 * 60;
export const OVER_ITEMS = 3;
/** Under 5 minutes and no item: the skill has not been practised today. */
export const UNTOUCHED_SECONDS = 5 * 60;

/** One graded standalone attempt today (LearnerProgressEvent). */
export type TodayEvent = {
  skill: PracticeSkill;
  contentType: LearningContentType;
  /** A quiz id, or a speaking exercise id. */
  contentId: number;
  scorePercent: number;
  createdAt: Date;
};

export type SkillDay = {
  seconds: number;
  /** Distinct items attempted today; a speaking set counts once. */
  items: number;
  /** The item attempted last today and its latest score. */
  last: { key: string; scorePercent: number } | null;
};

/** The catalog key of the item an attempt belongs to. */
export function eventKey(
  e: Pick<TodayEvent, 'contentType' | 'contentId'>,
  setKeyOfExercise: Map<number, number>,
): string {
  if (e.contentType === 'SPEAKING_SET') {
    return contentKey({
      type: 'SPEAKING_SET',
      id: setKeyOfExercise.get(e.contentId) ?? e.contentId,
    });
  }
  return contentKey({ type: e.contentType, id: e.contentId });
}

/** Today's practice per skill, from today's attempts and study time. */
export function skillDays(
  events: TodayEvent[],
  time: { skill: string; seconds: number }[],
  setKeyOfExercise: Map<number, number>,
): Record<PracticeSkill, SkillDay> {
  const out = Object.fromEntries(
    PRACTICE_SKILLS.map((s) => [s, { seconds: 0, items: 0, last: null }]),
  ) as Record<PracticeSkill, SkillDay>;
  for (const row of time) {
    const day = out[row.skill as PracticeSkill];
    if (day && row.seconds > 0) day.seconds += row.seconds;
  }
  const keys = new Map<PracticeSkill, Set<string>>();
  const ordered = [...events].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  for (const e of ordered) {
    const day = out[e.skill];
    if (!day) continue;
    const key = eventKey(e, setKeyOfExercise);
    const seen = keys.get(e.skill) ?? new Set<string>();
    seen.add(key);
    keys.set(e.skill, seen);
    day.items = seen.size;
    day.last = { key, scorePercent: e.scorePercent };
  }
  return out;
}

export type FrameSlot = {
  skill: PracticeSkill;
  /** TODO: still to do today; DONE: practised today; EMPTY: no item at all. */
  state: 'TODO' | 'DONE' | 'EMPTY';
  /** The suggested item (open, or the best locked one); null when EMPTY or DONE. */
  pick: Recommendation | null;
  /** Today's last item of the skill, when DONE. */
  doneKey: string | null;
  done: { items: number; scorePercent: number | null } | null;
  /** Suggested by the balance nudge. */
  nudged: boolean;
};

export type Balance = {
  /** The skill practised a lot today. */
  skill: PracticeSkill;
  minutes: number;
  items: number;
  /** Skills not practised yet today that have an open item. */
  suggest: PracticeSkill[];
};

export function dailyFrame(
  picks: Partial<Record<PracticeSkill, Recommendation>>,
  days: Record<PracticeSkill, SkillDay>,
): { slots: FrameSlot[]; balance: Balance | null } {
  const slots: FrameSlot[] = PRACTICE_SKILLS.map((skill) => {
    const day = days[skill];
    if (day.items > 0) {
      return {
        skill,
        state: 'DONE',
        pick: null,
        doneKey: day.last?.key ?? null,
        done: {
          items: day.items,
          scorePercent: day.last?.scorePercent ?? null,
        },
        nudged: false,
      };
    }
    const pick = picks[skill] ?? null;
    return {
      skill,
      state: pick ? 'TODO' : 'EMPTY',
      pick,
      doneKey: null,
      done: null,
      nudged: false,
    };
  });

  const over = PRACTICE_SKILLS.filter(
    (s) => days[s].seconds >= OVER_SECONDS || days[s].items >= OVER_ITEMS,
  ).sort(
    (a, b) =>
      days[b].seconds - days[a].seconds || days[b].items - days[a].items,
  )[0];
  const untouched = slots.filter(
    (slot) =>
      slot.skill !== over &&
      slot.state === 'TODO' &&
      slot.pick?.status === 'OPEN' &&
      days[slot.skill].seconds < UNTOUCHED_SECONDS,
  );
  if (!over || untouched.length === 0) return { slots, balance: null };

  for (const slot of untouched) slot.nudged = true;
  return {
    slots,
    balance: {
      skill: over,
      minutes: Math.round(days[over].seconds / 60),
      items: days[over].items,
      suggest: untouched.map((slot) => slot.skill),
    },
  };
}
