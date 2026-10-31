import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  PracticeLevel,
  PracticeSkill,
  Prisma,
  QuizType,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { parseCefrRange } from '../subscription/practice-level';
import { itemLevel } from './ability.logic';
import {
  gateQuestionView,
  gateRetryAt,
  gradeGate,
  isGateSkill,
  selectGateQuestions,
  type GateSkill,
} from './gate.logic';
import { LevelAccessService } from './level-access.service';
import {
  ABILITY_SEED,
  levelsUpTo,
  maxLevel,
  PRACTICE_LEVEL_LABEL,
} from './placement.logic';
import {
  GATE_MIN_QUESTIONS,
  GATE_PASS_PERCENT,
  GATE_QUESTIONS,
  nextLevel,
} from './progression.logic';

const GATE_QUIZ_TYPE: Record<GateSkill, QuizType> = {
  LISTENING: 'LISTENING_PRACTICE',
  READING: 'BILINGUAL_READING',
};

/** Starts, resumes and grades level gates. Free: a pass opens the level. */
@Injectable()
export class GateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly levelAccess: LevelAccessService,
  ) {}

  /** Published multiple-choice questions at a level, usable in a gate. */
  private async pool(skill: GateSkill, level: PracticeLevel) {
    const quizzes = await this.prisma.quiz.findMany({
      where: {
        type: GATE_QUIZ_TYPE[skill],
        publicationStatus: 'PUBLISHED',
        courseId: null,
        toeicWritingSetItems: { none: {} },
        courseActivities: { none: {} },
      },
      select: {
        title: true,
        questions: {
          where: {
            type: 'MULTIPLE_CHOICE',
            ...(skill === 'LISTENING'
              ? { audioAssets: { some: { isActive: true } } }
              : {}),
          },
          select: { id: true, quizId: true, order: true },
        },
      },
    });
    return quizzes
      .filter((quiz) => {
        const range = parseCefrRange(quiz.title);
        return range !== null && itemLevel(range) === level;
      })
      .flatMap((quiz) => quiz.questions);
  }

  /** The gate open to this learner for a skill, and why not if none is. */
  async status(userId: number, skill: PracticeSkill) {
    const unlocked = await this.levelAccess.unlockedLevels(userId);
    const targetLevel = nextLevel(unlocked[skill]);
    const base = {
      skill,
      targetLevel,
      targetLabel: targetLevel ? PRACTICE_LEVEL_LABEL[targetLevel] : null,
      passPercent: GATE_PASS_PERCENT,
    };
    const closed = (
      reason: 'PROGRESS_ONLY' | 'TOP_LEVEL' | 'NO_QUESTIONS',
    ) => ({
      ...base,
      available: false,
      reason,
      questionCount: 0,
      retryAt: null,
      openAttemptId: null,
    });
    if (!isGateSkill(skill)) return closed('PROGRESS_ONLY');
    if (!targetLevel) return closed('TOP_LEVEL');
    const pool = await this.pool(skill, targetLevel);
    if (pool.length < GATE_MIN_QUESTIONS) return closed('NO_QUESTIONS');
    const [open, lastFailed] = await Promise.all([
      this.prisma.gateAttempt.findFirst({
        where: { userId, skill, level: targetLevel, submittedAt: null },
        orderBy: { id: 'desc' },
        select: { id: true },
      }),
      this.prisma.gateAttempt.findFirst({
        where: { userId, skill, level: targetLevel, passed: false },
        orderBy: { submittedAt: 'desc' },
        select: { submittedAt: true },
      }),
    ]);
    return {
      ...base,
      available: true,
      reason: null,
      questionCount: Math.min(GATE_QUESTIONS, pool.length),
      retryAt: gateRetryAt(lastFailed?.submittedAt ?? null),
      openAttemptId: open?.id ?? null,
    };
  }

  /** Opens a gate, or returns the unfinished one with its same questions. */
  async start(userId: number, skill: PracticeSkill) {
    const status = await this.status(userId, skill);
    if (!status.available || !status.targetLevel || !isGateSkill(skill))
      throw new ConflictException({
        message: 'Kỹ năng này chưa có bài mở khoá.',
        error: { code: 'GATE_UNAVAILABLE', reason: status.reason },
      });
    if (status.retryAt && !status.openAttemptId)
      throw new ConflictException({
        message: 'Bạn cần chờ tới lượt làm lại bài mở khoá.',
        error: { code: 'GATE_COOLDOWN', retryAt: status.retryAt },
      });
    const targetLevel = status.targetLevel;
    const attempt = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`gate:${userId}:${skill}`}, 0))`;
      const open = await tx.gateAttempt.findFirst({
        where: { userId, skill, level: targetLevel, submittedAt: null },
        orderBy: { id: 'desc' },
      });
      if (open) return open;
      const picked = selectGateQuestions(
        skill,
        await this.pool(skill, targetLevel),
        GATE_QUESTIONS,
      );
      return tx.gateAttempt.create({
        data: {
          userId,
          skill,
          level: targetLevel,
          questionIds: picked.map((q) => q.id),
        },
      });
    });
    const questions = await this.servedQuestions(attempt.questionIds);
    return {
      attemptId: attempt.id,
      skill,
      level: targetLevel,
      levelLabel: PRACTICE_LEVEL_LABEL[targetLevel],
      passPercent: GATE_PASS_PERCENT,
      questions: questions.map((q) => gateQuestionView(skill, q)),
    };
  }

  /** The attempt's questions in the order they were served. */
  private async servedQuestions(questionIds: Prisma.JsonValue) {
    const ids = questionIds as number[];
    const rows = await this.prisma.question.findMany({
      where: { id: { in: ids } },
      select: { id: true, quizId: true, content: true },
    });
    const byId = new Map(rows.map((q) => [q.id, q]));
    return ids.flatMap((id) => byId.get(id) ?? []);
  }

  /** Grades once; a repeat returns the same result. */
  async submit(
    userId: number,
    attemptId: number,
    answers: Record<string, string>,
  ) {
    const attempt = await this.prisma.gateAttempt.findUnique({
      where: { id: attemptId },
    });
    if (!attempt || attempt.userId !== userId || !isGateSkill(attempt.skill))
      throw new NotFoundException('Không tìm thấy bài mở khoá');
    const { skill, level } = attempt;
    const questions = await this.servedQuestions(attempt.questionIds);
    if (attempt.submittedAt) {
      const stored = (attempt.answers ?? {}) as Record<string, string>;
      return this.result(attempt, gradeGate(skill, questions, stored));
    }
    const graded = gradeGate(skill, questions, answers);
    const submitted = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.gateAttempt.updateMany({
        where: { id: attemptId, submittedAt: null },
        data: {
          answers,
          score: graded.score,
          passed: graded.passed,
          submittedAt: new Date(),
        },
      });
      // Only the request that closed the attempt opens the level.
      if (claim.count && graded.passed)
        await this.openLevel(tx, { userId, skill, level, attemptId });
      return tx.gateAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    });
    return this.result(submitted, graded);
  }

  private result(
    attempt: {
      skill: PracticeSkill;
      level: PracticeLevel;
      submittedAt: Date | null;
    },
    graded: ReturnType<typeof gradeGate>,
  ) {
    return {
      skill: attempt.skill,
      level: attempt.level,
      levelLabel: PRACTICE_LEVEL_LABEL[attempt.level],
      correct: graded.correct,
      total: graded.total,
      score: graded.score,
      passed: graded.passed,
      passPercent: GATE_PASS_PERCENT,
      retryAt: graded.passed
        ? null
        : gateRetryAt(attempt.submittedAt ?? new Date()),
    };
  }

  private async openLevel(
    tx: Prisma.TransactionClient,
    input: {
      userId: number;
      skill: PracticeSkill;
      level: PracticeLevel;
      attemptId: number;
    },
  ) {
    const { userId, skill, level, attemptId } = input;
    const where = { userId_skill: { userId, skill } };
    const row = await tx.learnerSkillLevel.findUnique({ where });
    await tx.learnerSkillLevel.upsert({
      where,
      create: {
        userId,
        skill,
        level,
        unlockedLevel: level,
        ability: ABILITY_SEED[level],
      },
      update: {
        level: maxLevel(row?.level ?? level, level),
        unlockedLevel: maxLevel(row?.unlockedLevel ?? level, level),
        ability: Math.max(
          row?.ability ?? ABILITY_SEED[level],
          ABILITY_SEED[level],
        ),
      },
    });
    await tx.levelUnlock.createMany({
      data: levelsUpTo(level).map((l) => ({
        userId,
        skill,
        level: l,
        method: 'GATE_TEST' as const,
        evidence: { gateAttemptId: attemptId },
      })),
      skipDuplicates: true,
    });
  }
}
