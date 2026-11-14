import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { isRewardableQuiz } from '../gamification/reward-eligibility';
import {
  MISTAKE_SKILLS,
  RESOLVE_AFTER_CORRECT,
  applyObservation,
  grammarObservations,
  quizObservations,
  reviewQuestion,
  speakingObservations,
  topMistakeTags,
  writingObservations,
  type MistakeDetail,
  type MistakeObservation,
  type MistakeSkill,
  type MistakeState,
} from './mistake-extract.logic';

type IngestKind = 'SUBMISSION' | 'GRAMMAR_ATTEMPT' | 'SPEAKING_SUBMISSION';

/** Attempts older than this are not read into the notebook. */
const LOOKBACK_DAYS = 90;
/** At most this many attempts of each kind are read in one pass. */
const BATCH_PER_KIND = 40;
const PAGE_SIZE = 20;
const REVIEW_SIZE = 10;
/**
 * Only the skills the notebook has. TOEIC exam questions were taken out
 * (owner 2026-11-11); rows written before that stay in the table and are
 * never shown, counted or reviewed.
 */
const IN_NOTEBOOK = { skill: { in: [...MISTAKE_SKILLS] as string[] } };

/**
 * The mistake notebook. Rows are derived from graded attempts when the
 * learner opens the notebook (or anything that shows its count): attempts not
 * read yet are turned into observations and applied, oldest first. Nothing
 * runs at submit time, so no submit path depends on it, and attempts graded
 * later (speaking, exam writing) are picked up on the next read.
 */
@Injectable()
export class MistakesService {
  private readonly logger = new Logger(MistakesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Reads attempts that are graded and not in the notebook yet. */
  async sync(userId: number): Promise<void> {
    try {
      const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);
      const [submissions, grammar, speaking, done] = await Promise.all([
        this.prisma.submission.findMany({
          where: { userId, score: { not: null }, submittedAt: { gte: since } },
          select: { id: true },
        }),
        this.prisma.grammarAttempt.findMany({
          where: { userId, createdAt: { gte: since } },
          select: { id: true },
        }),
        this.prisma.speakingSubmission.findMany({
          where: { userId, status: 'COMPLETED', submittedAt: { gte: since } },
          select: { id: true },
        }),
        this.prisma.learnerMistakeIngest.findMany({
          where: { userId },
          select: { kind: true, sourceId: true },
        }),
      ]);
      const seen = new Set(done.map((row) => `${row.kind}:${row.sourceId}`));
      const fresh = (kind: IngestKind, rows: Array<{ id: number }>) =>
        rows
          .map((row) => row.id)
          .filter((id) => !seen.has(`${kind}:${id}`))
          .sort((a, b) => a - b)
          .slice(0, BATCH_PER_KIND);

      for (const id of fresh('SUBMISSION', submissions))
        await this.ingest(userId, 'SUBMISSION', id, () =>
          this.readSubmission(id),
        );
      for (const id of fresh('GRAMMAR_ATTEMPT', grammar))
        await this.ingest(userId, 'GRAMMAR_ATTEMPT', id, () =>
          this.readGrammar(id),
        );
      for (const id of fresh('SPEAKING_SUBMISSION', speaking))
        await this.ingest(userId, 'SPEAKING_SUBMISSION', id, () =>
          this.readSpeaking(id),
        );
    } catch (error) {
      // The notebook still answers with what it has.
      this.logger.warn(`Mistake sync failed for ${userId}: ${String(error)}`);
    }
  }

  private async readSubmission(id: number): Promise<MistakeObservation[]> {
    const row = await this.prisma.submission.findUnique({
      where: { id },
      select: {
        id: true,
        submittedAt: true,
        aiFeedback: true,
        quiz: {
          select: {
            id: true,
            type: true,
            title: true,
            practiceTopicId: true,
            toeicWritingSetItems: { select: { id: true }, take: 1 },
            questions: { select: { id: true, type: true, content: true } },
          },
        },
        results: {
          select: { questionId: true, answer: true, isCorrect: true },
        },
      },
    });
    // Only practice quizzes, by the same rule as rewards and progress: every
    // listening and reading quiz, a Writing task only with a practice topic and
    // outside the TOEIC writing sets. Requiring a topic for every quiz left out
    // the listening quizzes that have none (owner 2026-11-12: 7 wrong answers,
    // an empty notebook).
    if (
      !row ||
      !isRewardableQuiz({
        type: row.quiz.type,
        practiceTopicId: row.quiz.practiceTopicId,
        inToeicWritingSet: row.quiz.toeicWritingSetItems.length > 0,
      })
    )
      return [];
    return [
      ...quizObservations({ ...row, questions: row.quiz.questions }),
      ...writingObservations({ ...row, questions: row.quiz.questions }),
    ];
  }

  private async readGrammar(id: number): Promise<MistakeObservation[]> {
    const row = await this.prisma.grammarAttempt.findUnique({
      where: { id },
      select: {
        id: true,
        createdAt: true,
        answers: true,
        topic: {
          select: {
            id: true,
            title: true,
            questions: {
              select: {
                id: true,
                question: true,
                options: true,
                correctIndex: true,
                explanation: true,
              },
            },
          },
        },
      },
    });
    return row
      ? grammarObservations({ ...row, questions: row.topic.questions })
      : [];
  }

  private async readSpeaking(id: number): Promise<MistakeObservation[]> {
    const row = await this.prisma.speakingSubmission.findUnique({
      where: { id },
      select: {
        id: true,
        exerciseId: true,
        submittedAt: true,
        aiFeedback: true,
        exercise: { select: { title: true } },
      },
    });
    return row
      ? speakingObservations({ ...row, exerciseTitle: row.exercise.title })
      : [];
  }

  /**
   * Applies one attempt, once: the marker row and the notebook rows commit
   * together, and a second pass on the same attempt changes nothing.
   */
  private async ingest(
    userId: number,
    kind: IngestKind,
    sourceId: number,
    read: () => Promise<MistakeObservation[]>,
  ) {
    const observations = await read();
    await this.prisma.$transaction(async (tx) => {
      const marker = await tx.learnerMistakeIngest.createMany({
        data: [{ userId, kind, sourceId }],
        skipDuplicates: true,
      });
      if (marker.count === 0) return;
      for (const obs of observations) await this.apply(tx, userId, obs);
    });
  }

  private async apply(
    tx: Prisma.TransactionClient,
    userId: number,
    obs: MistakeObservation,
  ) {
    const where = {
      userId_sourceType_itemKey: {
        userId,
        sourceType: obs.sourceType,
        itemKey: obs.itemKey,
      },
    };
    const row = await tx.learnerMistake.findUnique({ where });
    const next = applyObservation(
      row
        ? {
            ...row,
            skill: row.skill as MistakeSkill,
            detail: row.detail as unknown as MistakeDetail,
          }
        : null,
      obs,
    );
    if (!next) return;
    const data = {
      skill: next.skill,
      tag: next.tag,
      detail: next.detail as unknown as Prisma.InputJsonValue,
      wrongCount: next.wrongCount,
      correctStreak: next.correctStreak,
      firstSeenAt: next.firstSeenAt,
      lastSeenAt: next.lastSeenAt,
      resolvedAt: next.resolvedAt,
    };
    await tx.learnerMistake.upsert({
      where,
      create: {
        userId,
        sourceType: obs.sourceType,
        itemKey: obs.itemKey,
        ...data,
      },
      update: data,
    });
  }

  private skillOf(value?: string): MistakeSkill | undefined {
    const skill = value?.toUpperCase();
    if (!skill) return undefined;
    if (!MISTAKE_SKILLS.includes(skill as MistakeSkill))
      throw new BadRequestException('Kỹ năng không hợp lệ.');
    return skill as MistakeSkill;
  }

  /** Open mistakes in total and per skill. */
  async summary(userId: number) {
    await this.sync(userId);
    const groups = await this.prisma.learnerMistake.groupBy({
      by: ['skill'],
      where: { userId, resolvedAt: null, ...IN_NOTEBOOK },
      _count: { _all: true },
    });
    const bySkill = Object.fromEntries(
      MISTAKE_SKILLS.map((skill) => [
        skill,
        groups.find((g) => g.skill === skill)?._count._all ?? 0,
      ]),
    ) as Record<MistakeSkill, number>;
    const [resolved, answerable] = await Promise.all([
      this.prisma.learnerMistake.count({
        where: { userId, resolvedAt: { not: null }, ...IN_NOTEBOOK },
      }),
      this.prisma.learnerMistake.count({
        where: {
          userId,
          resolvedAt: null,
          ...IN_NOTEBOOK,
          detail: { path: ['answerable'], equals: true },
        },
      }),
    ]);
    return {
      open: Object.values(bySkill).reduce((n, c) => n + c, 0),
      resolved,
      /** Open mistakes that can be answered again inside the notebook. */
      answerable,
      bySkill,
      resolveAfterCorrect: RESOLVE_AFTER_CORRECT,
    };
  }

  async list(
    userId: number,
    query: { skill?: string; status?: string; page?: number },
  ) {
    await this.sync(userId);
    const skill = this.skillOf(query.skill);
    const resolved = query.status === 'resolved';
    const page = Math.max(1, Math.floor(Number(query.page) || 1));
    const where = {
      userId,
      ...(skill ? { skill } : IN_NOTEBOOK),
      resolvedAt: resolved ? { not: null } : null,
    };
    const [total, rows] = await Promise.all([
      this.prisma.learnerMistake.count({ where }),
      this.prisma.learnerMistake.findMany({
        where,
        orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
    ]);
    return {
      total,
      page,
      pageSize: PAGE_SIZE,
      items: rows.map((row) => ({
        id: row.id,
        skill: row.skill,
        sourceType: row.sourceType,
        tag: row.tag,
        wrongCount: row.wrongCount,
        correctStreak: row.correctStreak,
        firstSeenAt: row.firstSeenAt,
        lastSeenAt: row.lastSeenAt,
        resolvedAt: row.resolvedAt,
        detail: row.detail,
      })),
    };
  }

  /** Open choice items to answer again: no key, no explanation. */
  async review(userId: number, skillParam?: string) {
    await this.sync(userId);
    const skill = this.skillOf(skillParam);
    const rows = await this.prisma.learnerMistake.findMany({
      where: {
        userId,
        resolvedAt: null,
        ...(skill ? { skill } : IN_NOTEBOOK),
        detail: { path: ['answerable'], equals: true },
      },
      // The ones not seen for longest come first.
      orderBy: [{ lastSeenAt: 'asc' }, { id: 'asc' }],
      take: REVIEW_SIZE,
    });
    return {
      resolveAfterCorrect: RESOLVE_AFTER_CORRECT,
      items: rows.map((row) =>
        reviewQuestion(
          row.id,
          row.skill,
          row.detail as unknown as MistakeDetail,
        ),
      ),
    };
  }

  private async own(userId: number, id: number) {
    const row = await this.prisma.learnerMistake.findFirst({
      where: { id, userId, ...IN_NOTEBOOK },
    });
    if (!row) throw new NotFoundException('Không tìm thấy lỗi này.');
    return row;
  }

  /** Checks one answer given in a review and moves the mistake on. */
  async answer(userId: number, id: number, selectedIndex: number) {
    const row = await this.own(userId, id);
    const detail = row.detail as unknown as MistakeDetail;
    const options = detail.options ?? [];
    if (
      !detail.answerable ||
      typeof detail.correctIndex !== 'number' ||
      !Number.isInteger(selectedIndex) ||
      selectedIndex < 0 ||
      selectedIndex >= options.length
    )
      throw new BadRequestException('Câu này không trả lời lại được ở đây.');
    const correct = selectedIndex === detail.correctIndex;
    const next = await this.moveOn(row, correct);
    return {
      id: row.id,
      correct,
      selectedIndex,
      correctIndex: detail.correctIndex,
      explanation: detail.explanation ?? null,
      passage: detail.passage ?? null,
      ...next,
    };
  }

  /**
   * One answer given in a review: right moves the streak on (closing the
   * mistake at RESOLVE_AFTER_CORRECT), wrong counts it and starts again.
   */
  private async moveOn(
    row: Pick<MistakeState, 'wrongCount' | 'correctStreak' | 'resolvedAt'> & {
      id: number;
    },
    correct: boolean,
  ) {
    const now = new Date();
    const next: Pick<
      MistakeState,
      'wrongCount' | 'correctStreak' | 'resolvedAt'
    > = correct
      ? {
          wrongCount: row.wrongCount,
          correctStreak: row.correctStreak + 1,
          resolvedAt:
            row.resolvedAt ??
            (row.correctStreak + 1 >= RESOLVE_AFTER_CORRECT ? now : null),
        }
      : { wrongCount: row.wrongCount + 1, correctStreak: 0, resolvedAt: null };
    await this.prisma.learnerMistake.update({
      where: { id: row.id },
      data: { ...next, lastSeenAt: now },
    });
    return {
      correctStreak: next.correctStreak,
      resolved: next.resolvedAt !== null,
      resolveAfterCorrect: RESOLVE_AFTER_CORRECT,
    };
  }

  /**
   * The sentence behind an open "Dịch câu" mistake of this learner, for the
   * typed review (graded by the Writing module, which owns the AI grader).
   */
  async translationReviewTarget(userId: number, id: number) {
    const row = await this.own(userId, id);
    const detail = row.detail as unknown as MistakeDetail;
    if (
      row.sourceType !== 'TRANSLATION_SENTENCE' ||
      detail.kind !== 'TRANSLATION' ||
      typeof detail.ref?.questionId !== 'number' ||
      typeof detail.ref?.quizId !== 'number'
    )
      throw new BadRequestException('Câu này không phải câu dịch.');
    return {
      id: row.id,
      questionId: detail.ref.questionId,
      quizId: detail.ref.quizId,
    };
  }

  /** Records the outcome of a typed translation review. */
  async recordTranslationReview(userId: number, id: number, correct: boolean) {
    const row = await this.own(userId, id);
    return { id: row.id, correct, ...(await this.moveOn(row, correct)) };
  }

  /** The learner says a mistake is understood, or opens it again. */
  async setResolved(userId: number, id: number, resolved: boolean) {
    const row = await this.own(userId, id);
    await this.prisma.learnerMistake.update({
      where: { id: row.id },
      data: resolved
        ? { resolvedAt: row.resolvedAt ?? new Date() }
        : { resolvedAt: null, correctStreak: 0 },
    });
    return { id: row.id, resolved };
  }

  /**
   * What the learner got wrong most between two moments, for the weekly
   * report. Reads new attempts first, so a learner who never opened the
   * notebook is covered.
   */
  async tagsBetween(userId: number, from: Date, until: Date) {
    await this.sync(userId);
    const rows = await this.prisma.learnerMistake.findMany({
      where: {
        userId,
        ...IN_NOTEBOOK,
        tag: { not: null },
        lastSeenAt: { gte: from, lt: until },
      },
      select: { skill: true, tag: true, wrongCount: true },
      take: 200,
    });
    return topMistakeTags(rows);
  }

  /** What the learner gets wrong most, for the tutor prompt. No sync here. */
  async topTags(userId: number): Promise<string[]> {
    const rows = await this.prisma.learnerMistake.findMany({
      where: { userId, resolvedAt: null, tag: { not: null }, ...IN_NOTEBOOK },
      select: { skill: true, tag: true, wrongCount: true },
      orderBy: { lastSeenAt: 'desc' },
      take: 200,
    });
    return topMistakeTags(rows);
  }
}
