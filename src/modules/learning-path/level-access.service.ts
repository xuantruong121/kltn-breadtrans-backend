import { Injectable, Optional } from '@nestjs/common';
import type { PracticeLevel, PracticeSkill, Role } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { parseCefrRange } from '../subscription/practice-level';
import { itemLevel } from './ability.logic';
import { PRACTICE_SKILLS } from './placement.logic';
import {
  effectiveUnlockedLevel,
  isLevelLocked,
  UNPLACED_UNLOCKED,
} from './progression.logic';

export type LevelAccess = {
  practiceLevel: PracticeLevel | null;
  unlockedLevel: PracticeLevel;
  isLevelLocked: boolean;
};

export type UnlockedLevels = Record<PracticeSkill, PracticeLevel>;

/**
 * The level half of an access result, for a list row. Takes any access shape:
 * services without the policy service fall back to a plan-only result.
 */
export function levelFields(access: object) {
  const { isLevelLocked, practiceLevel } = access as Partial<LevelAccess>;
  return {
    isLevelLocked: isLevelLocked ?? false,
    practiceLevel: practiceLevel ?? null,
  };
}

const CONTENT_CACHE_MS = 5 * 60 * 1000;
const QUIZ_TYPES: Array<[string, PracticeSkill]> = [
  ['LISTENING_PRACTICE', 'LISTENING'],
  ['BILINGUAL_READING', 'READING'],
  ['WRITING_PICTURE', 'WRITING'],
  ['WRITING_EMAIL', 'WRITING'],
];

/**
 * Which practice levels a learner has open. A practice item needs its plan
 * and its level; this is the level half. Exam and course content is never
 * level-locked: that is read from server data here, so no caller can forget.
 */
@Injectable()
export class LevelAccessService {
  private contentCache: {
    at: number;
    levels: Map<PracticeSkill, Set<PracticeLevel>>;
  } | null = null;

  constructor(@Optional() private readonly prisma?: PrismaService) {}

  /** Open level per skill; guests and unplaced skills get the open default. */
  async unlockedLevels(userId?: number): Promise<UnlockedLevels> {
    const rows =
      userId && this.prisma
        ? await this.prisma.learnerSkillLevel.findMany({
            where: { userId },
            select: { skill: true, unlockedLevel: true },
          })
        : [];
    const content = await this.levelsWithContent();
    return Object.fromEntries(
      PRACTICE_SKILLS.map((skill) => [
        skill,
        effectiveUnlockedLevel(
          rows.find((r) => r.skill === skill)?.unlockedLevel ??
            UNPLACED_UNLOCKED,
          content.get(skill) ?? new Set(),
        ),
      ]),
    ) as UnlockedLevels;
  }

  /** Levels with published standalone practice, per skill (cached briefly). */
  private async levelsWithContent() {
    if (
      this.contentCache &&
      Date.now() - this.contentCache.at < CONTENT_CACHE_MS
    )
      return this.contentCache.levels;
    const levels = new Map<PracticeSkill, Set<PracticeLevel>>(
      PRACTICE_SKILLS.map((skill) => [skill, new Set<PracticeLevel>()]),
    );
    if (!this.prisma) return levels;
    const add = (skill: PracticeSkill, tag: string | null | undefined) => {
      const range = parseCefrRange(tag);
      if (range) levels.get(skill)?.add(itemLevel(range));
    };
    const skillOf = new Map(QUIZ_TYPES);
    const [quizzes, sets] = await Promise.all([
      this.prisma.quiz.findMany({
        where: {
          type: { in: QUIZ_TYPES.map(([type]) => type) as never },
          publicationStatus: 'PUBLISHED',
          courseId: null,
        },
        select: { type: true, title: true },
      }),
      this.prisma.speakingPracticeSet.findMany({
        where: { scope: 'SKILL_PRACTICE', publicationStatus: 'PUBLISHED' },
        select: { level: true },
      }),
    ]);
    for (const quiz of quizzes) add(skillOf.get(quiz.type)!, quiz.title);
    for (const set of sets) add('SPEAKING', set.level);
    this.contentCache = { at: Date.now(), levels };
    return levels;
  }

  /** The lock for one item; `range` null means it has no practice level. */
  check(
    skill: PracticeSkill | null,
    range: Parameters<typeof itemLevel>[0] | null,
    unlocked: UnlockedLevels,
    role?: Role,
  ): LevelAccess {
    const unlockedLevel = skill ? unlocked[skill] : UNPLACED_UNLOCKED;
    if (!skill || !range)
      return { practiceLevel: null, unlockedLevel, isLevelLocked: false };
    const practiceLevel = itemLevel(range);
    return {
      practiceLevel,
      unlockedLevel,
      isLevelLocked:
        role !== 'ADMIN' && isLevelLocked(practiceLevel, unlockedLevel),
    };
  }

  /** Quizzes that also sit in an exam or a course keep their own access. */
  async exemptQuizIds(ids: number[]): Promise<Set<number>> {
    if (!ids.length || !this.prisma) return new Set();
    const rows = await this.prisma.quiz.findMany({
      where: {
        id: { in: ids },
        OR: [
          { toeicWritingSetItems: { some: {} } },
          { courseActivities: { some: {} } },
        ],
      },
      select: { id: true },
    });
    return new Set(rows.map((r) => r.id));
  }

  async exemptExerciseIds(ids: number[]): Promise<Set<number>> {
    if (!ids.length || !this.prisma) return new Set();
    const rows = await this.prisma.speakingExercise.findMany({
      where: {
        id: { in: ids },
        practiceSet: { courseActivities: { some: {} } },
      },
      select: { id: true },
    });
    return new Set(rows.map((r) => r.id));
  }
}
