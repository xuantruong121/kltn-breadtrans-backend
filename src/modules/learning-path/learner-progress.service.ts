import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type {
  LearningContentType,
  PracticeLevel,
  PracticeSkill,
  Prisma,
} from '@prisma/client';

import {
  isRewardableQuiz,
  isRewardableSpeakingExercise,
} from '../gamification/reward-eligibility';
import { PrismaService } from '../../prisma/prisma.service';
import { parseCefrRange } from '../subscription/practice-level';
import { itemLevel, seedDifficulty, updateAfterAttempt } from './ability.logic';
import { ABILITY_SEED, levelsUpTo, maxLevel } from './placement.logic';
import { progressUnlockTarget, UNPLACED_UNLOCKED } from './progression.logic';

type Attempt = {
  userId: number;
  skill: PracticeSkill;
  level: PracticeLevel;
  contentType: LearningContentType;
  /** The item the attempt counts for. */
  contentId: number;
  /** The item whose difficulty moves (a speaking set's first exercise). */
  difficultyId: number;
  seedDifficulty: number;
  sourceKey: string;
  scorePercent: number;
};

const QUIZ_SKILL: Record<string, PracticeSkill> = {
  LISTENING_PRACTICE: 'LISTENING',
  BILINGUAL_READING: 'READING',
  WRITING_PICTURE: 'WRITING',
  WRITING_EMAIL: 'WRITING',
};

/**
 * Turns graded practice into ability, item difficulty and path-progress
 * unlocks. Only standalone practice with an authored level counts. A failure
 * here is logged and never reaches the grading that called it; replays are
 * ignored through LearnerProgressEvent.
 */
@Injectable()
export class LearnerProgressService {
  private readonly logger = new Logger(LearnerProgressService.name);

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent('quiz.submitted')
  async onQuizSubmitted(payload: {
    userId: number;
    quizId?: number;
    submissionId?: number;
    scorePercent?: number | null;
  }) {
    if (
      !payload.quizId ||
      !payload.submissionId ||
      payload.scorePercent == null
    )
      return;
    await this.recordQuizAttempt({
      userId: payload.userId,
      quizId: payload.quizId,
      submissionId: payload.submissionId,
      scorePercent: payload.scorePercent,
    });
  }

  async recordQuizAttempt(input: {
    userId: number;
    quizId: number;
    submissionId: number;
    scorePercent: number;
  }) {
    try {
      const quiz = await this.prisma.quiz.findUnique({
        where: { id: input.quizId },
        select: {
          id: true,
          type: true,
          title: true,
          practiceTopicId: true,
          courseId: true,
          toeicWritingSetItems: { select: { id: true }, take: 1 },
          courseActivities: { select: { id: true }, take: 1 },
        },
      });
      if (!quiz) return null;
      const skill = QUIZ_SKILL[quiz.type];
      const range = parseCefrRange(quiz.title);
      const standalone = isRewardableQuiz({
        type: quiz.type,
        practiceTopicId: quiz.practiceTopicId,
        courseId: quiz.courseId,
        inToeicWritingSet: quiz.toeicWritingSetItems.length > 0,
        inCourseActivity: quiz.courseActivities.length > 0,
      });
      if (!skill || !range || !standalone) return null;
      return await this.record({
        userId: input.userId,
        skill,
        level: itemLevel(range),
        contentType: 'QUIZ',
        contentId: quiz.id,
        difficultyId: quiz.id,
        seedDifficulty: seedDifficulty(range),
        sourceKey: `quiz:${input.submissionId}`,
        scorePercent: input.scorePercent,
      });
    } catch (error) {
      this.logger.error(
        `Could not record quiz attempt ${input.submissionId}: ${String(error)}`,
      );
      return null;
    }
  }

  /** `overallScore` is 0-10; a silent recording has none and does not count. */
  async recordSpeakingAttempt(input: {
    userId: number;
    exerciseId: number;
    submissionId: number;
    overallScore: number | null;
  }) {
    if (input.overallScore === null) return null;
    try {
      const exercise = await this.prisma.speakingExercise.findUnique({
        where: { id: input.exerciseId },
        select: {
          id: true,
          title: true,
          practiceSetId: true,
          practiceSet: {
            select: {
              level: true,
              scope: true,
              courseActivities: { select: { id: true }, take: 1 },
            },
          },
        },
      });
      if (!exercise) return null;
      const range =
        parseCefrRange(exercise.practiceSet?.level) ??
        parseCefrRange(exercise.title);
      const standalone = isRewardableSpeakingExercise({
        practiceSetScope: exercise.practiceSet?.scope ?? null,
        inCourseActivity:
          (exercise.practiceSet?.courseActivities.length ?? 0) > 0,
      });
      if (!range || !standalone) return null;
      // The catalog keys a set by its first exercise.
      const first = exercise.practiceSetId
        ? await this.prisma.speakingExercise.findFirst({
            where: { practiceSetId: exercise.practiceSetId },
            orderBy: [{ order: 'asc' }, { id: 'asc' }],
            select: { id: true },
          })
        : null;
      return await this.record({
        userId: input.userId,
        skill: 'SPEAKING',
        level: itemLevel(range),
        contentType: 'SPEAKING_SET',
        contentId: exercise.id,
        difficultyId: first?.id ?? exercise.id,
        seedDifficulty: seedDifficulty(range),
        sourceKey: `speaking:${input.submissionId}`,
        scorePercent: Math.max(
          0,
          Math.min(100, Math.round(input.overallScore * 10)),
        ),
      });
    } catch (error) {
      this.logger.error(
        `Could not record speaking attempt ${input.submissionId}: ${String(error)}`,
      );
      return null;
    }
  }

  /** The level this attempt opened, or null. */
  private async record(attempt: Attempt): Promise<PracticeLevel | null> {
    return this.prisma.$transaction(async (tx) => {
      // Ability is read, then written from the read value.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`learner-progress:${attempt.userId}:${attempt.skill}`}, 0))`;
      const { count } = await tx.learnerProgressEvent.createMany({
        data: [
          {
            userId: attempt.userId,
            skill: attempt.skill,
            level: attempt.level,
            contentType: attempt.contentType,
            contentId: attempt.contentId,
            sourceKey: attempt.sourceKey,
            scorePercent: attempt.scorePercent,
          },
        ],
        skipDuplicates: true,
      });
      if (!count) return null;
      return this.applyAttempt(tx, attempt);
    });
  }

  private async applyAttempt(
    tx: Prisma.TransactionClient,
    attempt: Attempt,
  ): Promise<PracticeLevel | null> {
    const { userId, skill } = attempt;
    const row =
      (await tx.learnerSkillLevel.findUnique({
        where: { userId_skill: { userId, skill } },
      })) ??
      (await tx.learnerSkillLevel.create({
        data: {
          userId,
          skill,
          level: UNPLACED_UNLOCKED,
          unlockedLevel: UNPLACED_UNLOCKED,
          ability: ABILITY_SEED[UNPLACED_UNLOCKED],
        },
      }));
    const item = await tx.contentDifficulty.findUnique({
      where: {
        contentType_contentId: {
          contentType: attempt.contentType,
          contentId: attempt.difficultyId,
        },
      },
    });
    const updated = updateAfterAttempt({
      ability: row.ability,
      difficulty: item?.difficulty ?? attempt.seedDifficulty,
      itemAttempts: item?.attempts ?? 0,
      scorePercent: attempt.scorePercent,
    });
    await tx.contentDifficulty.upsert({
      where: {
        contentType_contentId: {
          contentType: attempt.contentType,
          contentId: attempt.difficultyId,
        },
      },
      create: {
        contentType: attempt.contentType,
        contentId: attempt.difficultyId,
        difficulty: updated.difficulty,
        attempts: 1,
      },
      update: { difficulty: updated.difficulty, attempts: { increment: 1 } },
    });
    const events = await tx.learnerProgressEvent.findMany({
      where: { userId, skill, level: row.unlockedLevel },
      select: { contentId: true, scorePercent: true },
    });
    const target = progressUnlockTarget({
      unlockedLevel: row.unlockedLevel,
      ability: updated.ability,
      events,
    });
    await tx.learnerSkillLevel.update({
      where: { userId_skill: { userId, skill } },
      data: {
        ability: updated.ability,
        ...(target && {
          unlockedLevel: target.level,
          level: maxLevel(row.level, target.level),
        }),
      },
    });
    if (!target) return null;
    await tx.levelUnlock.createMany({
      data: levelsUpTo(target.level).map((level) => ({
        userId,
        skill,
        level,
        method: 'PATH_PROGRESS' as const,
        evidence: {
          reason: target.reason,
          sourceKey: attempt.sourceKey,
          scorePercent: attempt.scorePercent,
        },
      })),
      skipDuplicates: true,
    });
    return target.level;
  }
}
