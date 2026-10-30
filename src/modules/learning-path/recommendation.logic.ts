/**
 * Ranks practice items for one learner (F6). Deterministic and explainable:
 * every point of the score has a reason the learner can read. Pure: the
 * catalog and the learner state are loaded elsewhere.
 *
 *   fit       2 x how close the predicted success is to 70 % (ability model)
 *   level     own level 1, one above 0.5, one below 0.3, two or more
 *             below -1 ("Ôn nền tảng"): kept so a learner whose own level
 *             is all plan-locked still has open practice
 *   track     0.6 when the item is tagged with the learner's career track
 *   weakness  0.6 for the skill with the lowest ability
 *   novelty   0.5 when never attempted
 *   review    0.6 when the best score is under 60 % and two days have passed
 *   mastered  -1.5 when the best score is 80 % or more
 *   saved     0.3 when the learner saved it
 *
 * Items above the learner's unlocked level are LOCKED_LEVEL and items needing
 * a plan the learner lacks are LOCKED_PLAN. They are returned with the
 * reason, after every open item, and never silently opened.
 */
import type {
  LearningContentType,
  LearningTrack,
  PracticeLevel,
  PracticeSkill,
} from '@prisma/client';

import { fitScore, successProbability } from './ability.logic';
import {
  ABILITY_SEED,
  levelIndex,
  PRACTICE_LEVEL_LABEL,
  PRACTICE_SKILLS,
} from './placement.logic';

export const TRACK_LABEL: Record<LearningTrack, string> = {
  GENERAL: 'Chung',
  IT_SOFTWARE: 'Công nghệ thông tin',
  OFFICE_BUSINESS: 'Văn phòng – Kinh doanh',
  SALES_CUSTOMER_SERVICE: 'Bán hàng – CSKH',
  HOSPITALITY_TOURISM: 'Nhà hàng – Khách sạn – Du lịch',
  STUDENT_ACADEMIC: 'Sinh viên – Học thuật',
};

export const SKILL_LABEL: Record<PracticeSkill, string> = {
  LISTENING: 'Nghe',
  READING: 'Đọc',
  SPEAKING: 'Nói',
  WRITING: 'Viết',
};

export type Candidate = {
  type: LearningContentType;
  id: number;
  skill: PracticeSkill;
  level: PracticeLevel;
  title: string;
  route: string;
  difficulty: number;
  tracks: LearningTrack[];
  /** True when the item needs a plan the learner does not have. */
  planLocked: boolean;
  /** Minutes one attempt usually takes. */
  minutes: number;
};

export type SkillState = {
  level: PracticeLevel;
  unlockedLevel: PracticeLevel;
  ability: number;
};

export type HistoryEntry = {
  bestScore: number | null;
  lastAt: Date;
  attempts: number;
};

export type LearnerState = {
  track: LearningTrack;
  /** Missing skill = not placed yet: practised as BASIC, no level lock. */
  skills: Partial<Record<PracticeSkill, SkillState>>;
  history: Map<string, HistoryEntry>;
  saved: Set<string>;
  now: Date;
};

export type RecommendationStatus = 'OPEN' | 'LOCKED_LEVEL' | 'LOCKED_PLAN';

export type Recommendation = {
  candidate: Candidate;
  status: RecommendationStatus;
  score: number;
  predictedSuccess: number;
  reasons: string[];
};

export const contentKey = (c: { type: LearningContentType; id: number }) =>
  `${c.type}:${c.id}`;

const DAY = 24 * 60 * 60 * 1000;
const UNPLACED: SkillState = {
  level: 'BASIC',
  unlockedLevel: 'ADVANCED',
  ability: ABILITY_SEED.BASIC,
};
/** A skill is "weakest" only when clearly below the others. */
const WEAKNESS_MARGIN = 0.2;

/**
 * The placed skill whose ability is at least WEAKNESS_MARGIN below every
 * other placed skill; null when skills are level (e.g. a self-chosen level)
 * or fewer than two are placed.
 */
export function weakestSkill(learner: LearnerState): PracticeSkill | null {
  const placed = PRACTICE_SKILLS.filter((s) => learner.skills[s]).sort(
    (a, b) => learner.skills[a]!.ability - learner.skills[b]!.ability,
  );
  if (placed.length < 2) return null;
  const [low, next] = placed;
  return learner.skills[next]!.ability - learner.skills[low]!.ability >=
    WEAKNESS_MARGIN
    ? low
    : null;
}

export function scoreCandidate(
  c: Candidate,
  learner: LearnerState,
  weakest: PracticeSkill | null,
): Recommendation | null {
  const skill = learner.skills[c.skill] ?? UNPLACED;
  const gap = levelIndex(c.level) - levelIndex(skill.level);
  const history = learner.history.get(contentKey(c));
  const best = history?.bestScore ?? null;
  const due =
    history !== undefined &&
    best !== null &&
    best < 60 &&
    learner.now.getTime() - history.lastAt.getTime() >= 2 * DAY;

  const reasons: string[] = [];
  const p = successProbability(skill.ability, c.difficulty);
  let score = 2 * fitScore(p);
  if (gap === 0) {
    score += 1;
    reasons.push(`Vừa sức mức ${PRACTICE_LEVEL_LABEL[skill.level]} của bạn`);
  } else if (gap === 1) {
    score += 0.5;
    reasons.push(`Thử thách mức ${PRACTICE_LEVEL_LABEL[c.level]}`);
  } else if (gap === -1) score += 0.3;
  else if (gap < -1) {
    score -= 1;
    reasons.push('Ôn nền tảng');
  }
  if (learner.track !== 'GENERAL' && c.tracks.includes(learner.track)) {
    score += 0.6;
    reasons.push(`Chủ đề ${TRACK_LABEL[learner.track]}`);
  }
  if (weakest === c.skill) {
    score += 0.6;
    reasons.push(`Kỹ năng cần cải thiện: ${SKILL_LABEL[c.skill]}`);
  }
  if (!history) score += 0.5;
  if (due) {
    score += 0.6;
    reasons.push('Ôn lại bài chưa đạt');
  }
  if (best !== null && best >= 80) score -= 1.5;
  if (learner.saved.has(contentKey(c))) score += 0.3;

  const status: RecommendationStatus =
    levelIndex(c.level) > levelIndex(skill.unlockedLevel)
      ? 'LOCKED_LEVEL'
      : c.planLocked
        ? 'LOCKED_PLAN'
        : 'OPEN';
  if (status === 'LOCKED_LEVEL')
    reasons.push(`Cần mở khóa mức ${PRACTICE_LEVEL_LABEL[c.level]}`);
  if (status === 'LOCKED_PLAN') reasons.push('Cần gói PLUS hoặc PRO');
  return {
    candidate: c,
    status,
    score: Math.round(score * 1000) / 1000,
    predictedSuccess: Math.round(p * 100) / 100,
    reasons,
  };
}

/**
 * Ranked recommendations. Open items first; within a status, higher score.
 * Without a skill filter, each further pick from an already-picked skill
 * loses 0.5 points, so the list mixes skills.
 */
export function recommend(
  candidates: Candidate[],
  learner: LearnerState,
  options: { limit: number; skill?: PracticeSkill; includeLocked?: boolean },
): Recommendation[] {
  const weakest = weakestSkill(learner);
  const pool = candidates
    .filter((c) => !options.skill || c.skill === options.skill)
    .map((c) => scoreCandidate(c, learner, weakest))
    .filter((r): r is Recommendation => r !== null)
    .filter((r) => options.includeLocked || r.status === 'OPEN');
  const rank = (r: Recommendation) => (r.status === 'OPEN' ? 0 : 1);
  const picked: Recommendation[] = [];
  const perSkill = new Map<PracticeSkill, number>();
  while (picked.length < options.limit && pool.length) {
    let bestIndex = 0;
    let bestValue = -Infinity;
    pool.forEach((r, i) => {
      const repeat = options.skill ? 0 : (perSkill.get(r.candidate.skill) ?? 0);
      const value = r.score - 0.5 * repeat - 100 * rank(r);
      const tie =
        value === bestValue &&
        contentKey(r.candidate) < contentKey(pool[bestIndex].candidate);
      if (value > bestValue || tie) {
        bestValue = value;
        bestIndex = i;
      }
    });
    const [r] = pool.splice(bestIndex, 1);
    picked.push(r);
    perSkill.set(r.candidate.skill, (perSkill.get(r.candidate.skill) ?? 0) + 1);
  }
  return picked;
}

/** Fills a daily list up to the learner's minutes (at least one item). */
export function dailyPlan(
  ranked: Recommendation[],
  minutesPerDay: number,
): Recommendation[] {
  const plan: Recommendation[] = [];
  let used = 0;
  for (const r of ranked) {
    if (r.status !== 'OPEN') continue;
    if (plan.length && used + r.candidate.minutes > minutesPerDay) continue;
    plan.push(r);
    used += r.candidate.minutes;
    if (used >= minutesPerDay) break;
  }
  return plan;
}
