import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import {
  AttemptMode,
  AttemptStatus,
  IntegrityEventType,
  Prisma,
  QuizPublicationStatus,
  ToeicAttemptSection,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SpeakingService } from '../speaking/speaking.service';
import { validateToeicExam } from './toeic.validation';
import { buildToeicListeningAudioScript } from './toeic-listening-audio';
import { buildLrStats, parseToeicGoal } from './toeic-lr-stats';
import { reviewStatus, summarizeLrReview } from './toeic-lr-review';
import { toeicQuestionType } from './toeic-question-type';
import {
  listeningMasterFor,
  listeningMasterUrl,
  masterMatchesGroups,
} from './toeic-listening-master';

const MIN_DURATION = 60;
const MAX_DURATION = 21600;
const PENDING_TTL_MS = 2 * 60 * 60 * 1000;
/** Official TOEIC Reading section timing; server-authoritative, never a client value. */
const READING_SECTION_SECONDS = 75 * 60;

type AnswerRow = {
  selectedIndex: number | null;
  question: { correctIndex: number; group: { part: number } };
};

type ExpiredFinalization = {
  attempt: any;
  finalized: boolean;
};

@Injectable()
export class ToeicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly speakingService: SpeakingService,
    @Optional() private readonly eventEmitter?: EventEmitter2,
  ) {}

  private lockKey(userId: number, examId: number, mode: AttemptMode) {
    return `toeic_attempt:${userId}:${examId}:${mode}`;
  }

  private async lockTuple(
    tx: Prisma.TransactionClient,
    userId: number,
    examId: number,
    mode: AttemptMode,
  ) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${this.lockKey(userId, examId, mode)}))`;
  }

  private async lockAttemptRow(
    tx: Prisma.TransactionClient,
    attemptId: number,
  ) {
    const rows = await tx.$queryRaw<Array<{ id: number }>>`
      SELECT id FROM "ToeicAttempt" WHERE id = ${attemptId} FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  private validateDuration(value: number) {
    if (
      !Number.isInteger(value) ||
      value < MIN_DURATION ||
      value > MAX_DURATION
    ) {
      throw new BadRequestException(
        `Thời lượng phải từ ${MIN_DURATION} đến ${MAX_DURATION} giây`,
      );
    }
  }

  private validateModeCompatibility(type: string, mode: AttemptMode) {
    if (
      mode === AttemptMode.PRACTICE &&
      type !== 'FULL_TEST' &&
      type !== 'PRACTICE_BY_PART'
    ) {
      throw new BadRequestException(
        'Chế độ luyện tập không tương thích với đề thi',
      );
    }
    if (mode === AttemptMode.FULL_TEST && type !== 'FULL_TEST') {
      throw new BadRequestException('Đề này không hỗ trợ chế độ thi đầy đủ');
    }
  }

  private getRawCounts(answers: AnswerRow[]) {
    let listeningCorrect = 0;
    let readingCorrect = 0;
    for (const answer of answers) {
      if (
        answer.selectedIndex === null ||
        answer.selectedIndex !== answer.question.correctIndex
      )
        continue;
      if (answer.question.group.part >= 1 && answer.question.group.part <= 4)
        listeningCorrect++;
      else if (
        answer.question.group.part >= 5 &&
        answer.question.group.part <= 7
      )
        readingCorrect++;
    }
    return { listeningCorrect, readingCorrect };
  }

  private async getQuestionCounts(
    tx: Prisma.TransactionClient,
    examId: number,
    parts: number[] = [],
  ) {
    const groups = await tx.toeicQuestionGroup.findMany({
      where: { examId, ...(parts.length ? { part: { in: parts } } : {}) },
      select: { part: true, questions: { select: { id: true } } },
    });
    return groups.reduce<{
      listeningTotal: number;
      readingTotal: number;
      parts: Record<number, number>;
    }>(
      (result, group) => {
        result.parts[group.part] =
          (result.parts[group.part] ?? 0) + group.questions.length;
        if (group.part >= 1 && group.part <= 4)
          result.listeningTotal += group.questions.length;
        else if (group.part >= 5 && group.part <= 7)
          result.readingTotal += group.questions.length;
        return result;
      },
      {
        listeningTotal: 0,
        readingTotal: 0,
        parts: {},
      },
    );
  }

  private legacyScores(listeningCorrect: number, readingCorrect: number) {
    return {
      listeningScore: Math.min(495, Math.max(5, listeningCorrect * 5)),
      readingScore: Math.min(495, Math.max(5, readingCorrect * 5)),
    };
  }

  async getExams(isStaff = false) {
    const exams = await this.prisma.toeicExamSet.findMany({
      where: isStaff
        ? {}
        : { publicationStatus: QuizPublicationStatus.PUBLISHED },
      select: {
        id: true,
        title: true,
        description: true,
        type: true,
        difficulty: true,
        durationSeconds: true,
        publicationStatus: true,
        groups: {
          select: {
            id: true,
            part: true,
            groupOrder: true,
            canonicalAccent: true,
            imageUrl: true,
            audioUrl: true,
            passageText: true,
            transcriptText: true,
            imageBrief: true,
            mediaMetadata: true,
            questions: {
              select: {
                id: true,
                questionNumber: true,
                text: true,
                options: true,
                correctIndex: true,
              },
            },
          },
          orderBy: { groupOrder: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return exams.map((exam) => {
      const validation = validateToeicExam(exam);
      return {
        id: exam.id,
        title: exam.title,
        description: exam.description,
        type: exam.type,
        difficulty: exam.difficulty,
        durationSeconds: exam.durationSeconds,
        publicationStatus: exam.publicationStatus,
        learnerReady: validation.learnerReady,
        validation: { counts: validation.counts, issues: validation.issues },
      };
    });
  }

  async getExamBriefing(examId: number, userId?: number, isStaff = false) {
    const exam = await this.prisma.toeicExamSet.findUnique({
      where: { id: examId },
      include: {
        groups: {
          select: {
            id: true,
            part: true,
            groupOrder: true,
            canonicalAccent: true,
            imageUrl: true,
            audioUrl: true,
            passageText: true,
            transcriptText: true,
            imageBrief: true,
            mediaMetadata: true,
            questions: {
              select: {
                id: true,
                questionNumber: true,
                text: true,
                options: true,
                correctIndex: true,
              },
            },
          },
          orderBy: { groupOrder: 'asc' },
        },
      },
    });
    if (
      !exam ||
      (!isStaff && exam.publicationStatus !== QuizPublicationStatus.PUBLISHED)
    ) {
      throw new NotFoundException('Exam not found');
    }
    const partQuestionCounts = new Map<number, number>();
    for (const group of exam.groups) {
      partQuestionCounts.set(
        group.part,
        (partQuestionCounts.get(group.part) ?? 0) + group.questions.length,
      );
    }

    const validation = validateToeicExam(exam);
    // Every unfinished attempt of this learner on this exam, per mode, so the
    // start screen can offer "continue" for the right mode.
    const activeAttempts = userId
      ? await this.prisma.toeicAttempt.findMany({
          where: {
            userId,
            examId,
            status: {
              in: [AttemptStatus.PENDING_START, AttemptStatus.IN_PROGRESS],
            },
          },
          orderBy: { id: 'desc' },
          select: {
            id: true,
            status: true,
            deadline: true,
            mode: true,
            selectedParts: true,
          },
        })
      : [];
    const activeAttempt = userId
      ? await this.prisma.toeicAttempt.findFirst({
          where: {
            userId,
            examId,
            mode:
              exam.type === 'FULL_TEST'
                ? AttemptMode.FULL_TEST
                : AttemptMode.PRACTICE,
            status: {
              in: [AttemptStatus.PENDING_START, AttemptStatus.IN_PROGRESS],
            },
          },
          orderBy: { id: 'desc' },
          select: { id: true, status: true, deadline: true },
        })
      : null;
    return {
      id: exam.id,
      title: exam.title,
      description: exam.description,
      type: exam.type,
      difficulty: exam.difficulty,
      durationSeconds: exam.durationSeconds,
      learnerReady: validation.learnerReady,
      validation: { counts: validation.counts, issues: validation.issues },
      activeAttempt,
      activeAttempts,
      parts: Array.from(partQuestionCounts.entries())
        .sort(([partA], [partB]) => partA - partB)
        .map(([part, questionCount]) => ({ part, questionCount })),
    };
  }

  async getExamDetails(examId: number, includeAnswers = false) {
    if (!includeAnswers) return this.getExamBriefing(examId);
    return this.prisma.toeicExamSet.findUnique({
      where: { id: examId },
      include: {
        groups: {
          include: { questions: { orderBy: { questionNumber: 'asc' } } },
          orderBy: { groupOrder: 'asc' },
        },
      },
    });
  }

  async getBundle(quizId: number, includeAnswers = false) {
    const quiz = await this.prisma.quiz.findUnique({ where: { id: quizId } });
    if (!quiz) throw new NotFoundException('TOEIC bundle not found');
    const metadata =
      quiz.bilingualContent &&
      typeof quiz.bilingualContent === 'object' &&
      !Array.isArray(quiz.bilingualContent)
        ? (quiz.bilingualContent as Record<string, unknown>)
        : {};
    // Keep the persisted canonical format and the legacy migration alias
    // readable. Existing seeded bundles use TOEIC_4_SKILLS, while older
    // lifecycle records may still carry FOUR_SKILL.
    const isFourSkillFormat =
      metadata.examFormat === 'TOEIC_4_SKILLS' ||
      metadata.examFormat === 'FOUR_SKILL';
    if (!isFourSkillFormat || metadata.isBundle !== true)
      throw new BadRequestException('Quiz này không phải gói TOEIC 4 kỹ năng');
    const examSetId = Number(metadata.listeningReadingExamSetId);
    const speakingWritingQuizId = Number(metadata.speakingWritingQuizId);
    if (
      !Number.isInteger(examSetId) ||
      !Number.isInteger(speakingWritingQuizId)
    )
      throw new BadRequestException(
        'Gói TOEIC chưa liên kết đủ các bài thành phần',
      );
    const [listeningReading, speakingWriting] = await Promise.all([
      this.getExamDetails(examSetId, includeAnswers),
      this.prisma.quiz.findUnique({
        where: { id: speakingWritingQuizId },
        include: { questions: { orderBy: { order: 'asc' } } },
      }),
    ]);
    if (!speakingWriting)
      throw new NotFoundException('Bài Speaking/Writing không tồn tại');
    return {
      id: quiz.id,
      title: quiz.title,
      description: quiz.description,
      bilingualContent: quiz.bilingualContent,
      listeningReading,
      speakingWriting: {
        id: speakingWriting.id,
        title: speakingWriting.title,
        description: speakingWriting.description,
        questions: includeAnswers
          ? speakingWriting.questions
          : speakingWriting.questions.map(({ content, ...question }) => ({
              ...question,
              content: this.redactContent(content),
            })),
      },
    };
  }

  private redactContent(content: unknown) {
    if (!content || typeof content !== 'object' || Array.isArray(content))
      return content;
    const copy = { ...(content as Record<string, unknown>) };
    delete copy.correct;
    delete copy.correctAnswer;
    delete copy.explanation;
    return copy;
  }

  async generateGroupAudio(groupId: number, userId: number, attemptId: number) {
    const group = await this.prisma.toeicQuestionGroup.findUnique({
      where: { id: groupId },
      select: {
        part: true,
        examId: true,
        canonicalAccent: true,
        audioUrl: true,
        passageText: true,
        transcriptText: true,
        questions: {
          select: { options: true, correctIndex: true },
          orderBy: { questionNumber: 'asc' },
        },
      },
    });
    if (!group) throw new NotFoundException('TOEIC question group not found');
    const attempt = await this.prisma.toeicAttempt.findUnique({
      where: { id: attemptId },
      select: {
        userId: true,
        examId: true,
        mode: true,
        status: true,
        section: true,
        listeningPosition: true,
      },
    });
    if (
      !attempt ||
      attempt.userId !== userId ||
      attempt.examId !== group.examId
    ) {
      throw new ForbiddenException(
        'Bạn không có quyền nghe audio của lượt thi này',
      );
    }
    if (attempt.status !== AttemptStatus.IN_PROGRESS) {
      throw new BadRequestException('Lượt thi không còn ở trạng thái làm bài');
    }
    if (
      attempt.mode === AttemptMode.FULL_TEST &&
      attempt.section === ToeicAttemptSection.LISTENING &&
      group.part <= 4
    ) {
      // One-pass enforcement at the API layer: the only group whose audio
      // can be fetched is the one at the attempt's current manifest
      // position — never a past (replay) or future (skip-ahead) segment.
      const groupIds = await this.getListeningManifestGroupIds(attempt.examId);
      if (groupIds[attempt.listeningPosition] !== groupId)
        throw new ForbiddenException(
          'Không thể nghe lại hoặc nghe trước nhóm câu hỏi này trong Full Test nghiêm ngặt',
        );
    }
    if (group.audioUrl) {
      const response = await fetch(group.audioUrl);
      if (response.ok) return Buffer.from(await response.arrayBuffer());
    }
    // Strict Full Test playback must use a durable authored artifact. Practice
    // mode keeps its legacy pedagogical fallback for groups that are not yet
    // materialized; authoring is handled by the bounded maintenance script.
    if (attempt.mode !== AttemptMode.FULL_TEST) {
      let text: string;
      try {
        text = buildToeicListeningAudioScript(group);
      } catch {
        throw new ServiceUnavailableException('Nhóm câu hỏi này chưa có audio');
      }
      return this.speakingService.generateTts(
        text,
        group.canonicalAccent === 'UK' ? 'UK' : 'US',
        1,
      );
    }
    throw new ServiceUnavailableException(
      'Nhóm nghe chưa có audio artifact đã được tạo',
    );
  }

  async startAttempt(
    userId: number,
    examId: number,
    mode: AttemptMode = AttemptMode.PRACTICE,
    parts: number[] = [],
  ) {
    // Practice may cover chosen Parts; Full Test is always the whole exam.
    // An empty list (or all seven) means the whole exam.
    const chosen = [...new Set(parts)]
      .filter((p) => Number.isInteger(p) && p >= 1 && p <= 7)
      .sort((a, b) => a - b);
    const selectedParts =
      mode === AttemptMode.PRACTICE && chosen.length < 7 ? chosen : [];
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockTuple(tx, userId, examId, mode);
        const exam = await tx.toeicExamSet.findUnique({
          where: { id: examId },
          include: { groups: { include: { questions: true } } },
        });
        if (!exam) throw new NotFoundException('Exam not found');
        if (exam.publicationStatus !== QuizPublicationStatus.PUBLISHED) {
          throw new NotFoundException('Exam not found');
        }
        this.validateDuration(exam.durationSeconds);
        this.validateModeCompatibility(exam.type, mode);
        if (selectedParts.length) {
          const available = new Set(exam.groups.map((g) => g.part));
          if (selectedParts.some((p) => !available.has(p)))
            throw new BadRequestException('Đề này không có Part đã chọn');
        }
        if (mode === AttemptMode.FULL_TEST) {
          const validation = validateToeicExam(exam);
          if (!validation.learnerReady)
            throw new ServiceUnavailableException(
              'Đề Full Test chưa đủ nội dung/media để bắt đầu',
            );
        }
        const active = await tx.toeicAttempt.findFirst({
          where: {
            userId,
            examId,
            mode,
            status: {
              in: [AttemptStatus.PENDING_START, AttemptStatus.IN_PROGRESS],
            },
          },
          orderBy: { id: 'desc' },
        });
        if (active) {
          if (
            active.status === AttemptStatus.PENDING_START &&
            Date.now() - active.createdAt.getTime() > PENDING_TTL_MS
          )
            await tx.toeicAttempt.delete({ where: { id: active.id } });
          else if (
            active.status === AttemptStatus.IN_PROGRESS &&
            active.deadline &&
            active.deadline.getTime() <= Date.now()
          ) {
            // Finalize the expired attempt, then create a fresh pending attempt
            // for the new start request. The historical result remains intact.
            await this.finalizeExpiredTx(tx, active.id, userId);
          } else if (
            active.selectedParts.join(',') !== selectedParts.join(',')
          ) {
            // Never silently resume a practice covering different Parts.
            throw new ConflictException(
              'Bạn đang có lượt luyện tập dở với các Part khác. Hãy làm tiếp hoặc hủy lượt đó trước.',
            );
          } else return { ...active, reused: true };
        }
        const created = await tx.toeicAttempt.create({
          data: {
            userId,
            examId,
            mode,
            selectedParts,
            durationSeconds: exam.durationSeconds,
            status: AttemptStatus.PENDING_START,
          },
        });
        return { ...created, reused: false };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException('Bạn đã có một lượt thi đang mở');
      throw error;
    }
  }

  async beginAttempt(attemptId: number, userId: number) {
    return this.prisma.$transaction(async (tx) => {
      const initial = await tx.toeicAttempt.findUnique({
        where: { id: attemptId },
      });
      if (!initial) throw new NotFoundException('Attempt not found');
      await this.lockTuple(tx, initial.userId, initial.examId, initial.mode);
      await this.lockAttemptRow(tx, attemptId);
      const attempt = await tx.toeicAttempt.findUnique({
        where: { id: attemptId },
        include: { exam: true },
      });
      if (!attempt) throw new NotFoundException('Attempt not found');
      if (attempt.userId !== userId)
        throw new ForbiddenException('Bạn không có quyền bắt đầu lượt thi này');
      if (attempt.status === AttemptStatus.IN_PROGRESS) return attempt;
      if (attempt.status !== AttemptStatus.PENDING_START)
        throw new BadRequestException(
          'Lượt thi không còn ở trạng thái chờ bắt đầu',
        );
      const startedAt = new Date();
      const deadline = new Date(
        startedAt.getTime() + attempt.durationSeconds * 1000,
      );
      return tx.toeicAttempt.update({
        where: { id: attemptId },
        data: {
          status: AttemptStatus.IN_PROGRESS,
          startedAt,
          deadline,
          // No section: owner decision 2026-10-27, Full Test has seekable
          // audio and open navigation under one 120-minute deadline. The
          // section/one-pass rules below still apply to attempts begun before
          // (their `section` is set), so those are not changed mid-attempt.
        },
      });
    });
  }

  /** Deterministic server-authoritative Listening order: Part 1→4, group order within each Part. */
  private async getListeningManifestGroupIds(examId: number) {
    const groups = await this.prisma.toeicQuestionGroup.findMany({
      where: { examId, part: { lte: 4 } },
      select: { id: true, part: true, groupOrder: true },
      orderBy: [{ part: 'asc' }, { groupOrder: 'asc' }],
    });
    return groups.map((g) => g.id);
  }

  /**
   * The continuous Listening recording for a Practice or Full Test attempt,
   * or `available: false` with the reason. Only a legacy strict attempt
   * (begun with a one-pass `section`) is refused; its audio stays group by
   * group, enforced above.
   * Published-ness is checked with a cached HEAD so an unpublished master
   * falls back to per-group audio instead of a broken player.
   */
  async getListeningMaster(attemptId: number, userId: number) {
    const attempt = await this.prisma.toeicAttempt.findUnique({
      where: { id: attemptId },
      select: { userId: true, examId: true, status: true, section: true },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');
    if (attempt.userId !== userId)
      throw new ForbiddenException('Bạn không có quyền truy cập bài thi này');
    // After submission the recording is replayable in the answer review.
    // Before that, only a legacy strict attempt (one-pass section) is refused.
    const submitted = attempt.status === AttemptStatus.SUBMITTED;
    if (attempt.section && !submitted)
      return { available: false as const, reason: 'STRICT_MODE' };
    if (attempt.status !== AttemptStatus.IN_PROGRESS && !submitted)
      return { available: false as const, reason: 'NOT_IN_PROGRESS' };
    const master = listeningMasterFor(attempt.examId);
    if (!master) return { available: false as const, reason: 'NO_MASTER' };
    const groupIds = await this.getListeningManifestGroupIds(attempt.examId);
    if (!masterMatchesGroups(master, groupIds))
      return { available: false as const, reason: 'STALE' };
    const url = listeningMasterUrl(master);
    // Published object first; otherwise the verified local build (local
    // development before the owner approves publishing to R2).
    const source =
      url && (await this.isPublished(url))
        ? { url, path: null }
        : this.localMasterFile(attempt.examId)
          ? {
              url: null,
              path: `/toeic/listening-master/${attempt.examId}/audio`,
            }
          : null;
    if (!source) return { available: false as const, reason: 'NOT_PUBLISHED' };
    return {
      available: true as const,
      ...source,
      durationSeconds: master.durationSeconds,
      timeline: master.timeline,
    };
  }

  private readonly localMasterCache = new Map<number, string | null>();

  /** The local master build, only when its bytes match the registry (sha256). */
  localMasterFile(examId: number): string | null {
    if (this.localMasterCache.has(examId))
      return this.localMasterCache.get(examId)!;
    const master = listeningMasterFor(examId);
    const file = resolvePath(
      process.cwd(),
      'artifacts',
      'toeic-listening-master',
      `exam-${examId}`,
      'master.mp3',
    );
    let found: string | null = null;
    if (master && existsSync(file)) {
      const sha = createHash('sha256').update(readFileSync(file)).digest('hex');
      if (sha === master.sha256) found = file;
    }
    this.localMasterCache.set(examId, found);
    return found;
  }

  private readonly publishedCache = new Map<
    string,
    { ok: boolean; at: number }
  >();

  private async isPublished(url: string) {
    const cached = this.publishedCache.get(url);
    if (cached && Date.now() - cached.at < 5 * 60_000) return cached.ok;
    let ok = false;
    try {
      ok = (await fetch(url, { method: 'HEAD' })).ok;
    } catch {
      ok = false;
    }
    this.publishedCache.set(url, { ok, at: Date.now() });
    return ok;
  }

  /**
   * Strict Full Test one-pass Listening manifest. Only the segment at the
   * attempt's current `listeningPosition` carries a fetchable `audioUrl` —
   * past segments (already consumed) and future segments (not yet reached)
   * both come back with `audioUrl: null`, so replay and skip-ahead are
   * blocked at the API layer, not merely hidden by the UI.
   */
  async getListeningManifest(attemptId: number, userId: number) {
    const attempt = await this.prisma.toeicAttempt.findUnique({
      where: { id: attemptId },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');
    if (attempt.userId !== userId)
      throw new ForbiddenException('Bạn không có quyền truy cập bài thi này');
    if (attempt.mode !== AttemptMode.FULL_TEST)
      throw new BadRequestException(
        'Chỉ Full Test mới có Listening manifest nghiêm ngặt',
      );
    const groups = await this.prisma.toeicQuestionGroup.findMany({
      where: { examId: attempt.examId, part: { lte: 4 } },
      select: { id: true, part: true, groupOrder: true, audioUrl: true },
      orderBy: [{ part: 'asc' }, { groupOrder: 'asc' }],
    });
    return {
      section: attempt.section,
      listeningPosition: attempt.listeningPosition,
      totalSegments: groups.length,
      segments: groups.map((group, index) => ({
        groupId: group.id,
        part: group.part,
        groupOrder: group.groupOrder,
        audioUrl: index === attempt.listeningPosition ? group.audioUrl : null,
      })),
    };
  }

  /**
   * Advances the one-pass Listening cursor by exactly one segment. The
   * cursor only ever moves forward — there is no endpoint that decrements
   * or resets it — and once it reaches the end of the manifest the attempt
   * transitions to Reading automatically and the transition is one-way.
   */
  async advanceListening(attemptId: number, userId: number) {
    return this.prisma.$transaction(async (tx) => {
      const initial = await tx.toeicAttempt.findUnique({
        where: { id: attemptId },
      });
      if (!initial) throw new NotFoundException('Attempt not found');
      await this.lockAttemptRow(tx, attemptId);
      const attempt = await tx.toeicAttempt.findUnique({
        where: { id: attemptId },
      });
      if (!attempt) throw new NotFoundException('Attempt not found');
      if (attempt.userId !== userId)
        throw new ForbiddenException(
          'Bạn không có quyền điều khiển lượt thi này',
        );
      if (attempt.status !== AttemptStatus.IN_PROGRESS)
        throw new BadRequestException('Lượt thi chưa bắt đầu hoặc đã kết thúc');
      if (
        attempt.mode !== AttemptMode.FULL_TEST ||
        attempt.section !== ToeicAttemptSection.LISTENING
      )
        throw new BadRequestException(
          'Phần Listening đã kết thúc hoặc chưa bắt đầu',
        );
      const groupIds = await this.getListeningManifestGroupIds(attempt.examId);
      const nextPosition = attempt.listeningPosition + 1;
      if (nextPosition >= groupIds.length) {
        const readingStartedAt = new Date();
        const readingDeadline = new Date(
          readingStartedAt.getTime() + READING_SECTION_SECONDS * 1000,
        );
        return tx.toeicAttempt.update({
          where: { id: attemptId },
          data: {
            listeningPosition: groupIds.length,
            section: ToeicAttemptSection.READING,
            readingStartedAt,
            readingDeadline,
          },
        });
      }
      return tx.toeicAttempt.update({
        where: { id: attemptId },
        data: { listeningPosition: nextPosition },
      });
    });
  }

  async getAttemptDetail(attemptId: number, userId: number, role?: string) {
    const attempt = await this.prisma.toeicAttempt.findUnique({
      where: { id: attemptId },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');
    if (role !== 'ADMIN' && attempt.userId !== userId)
      throw new ForbiddenException('Bạn không có quyền truy cập bài thi này');
    if (
      attempt.status === AttemptStatus.IN_PROGRESS &&
      ((attempt.deadline && attempt.deadline <= new Date()) ||
        (attempt.section === ToeicAttemptSection.READING &&
          attempt.readingDeadline &&
          attempt.readingDeadline <= new Date()))
    )
      await this.finalizeExpired(attemptId, attempt.userId);
    const current = await this.prisma.toeicAttempt.findUnique({
      where: { id: attemptId },
      select: {
        id: true,
        userId: true,
        examId: true,
        mode: true,
        status: true,
        createdAt: true,
        startedAt: true,
        deadline: true,
        durationSeconds: true,
        submittedAt: true,
        currentQuestionId: true,
        markedQuestionIds: true,
        selectedParts: true,
        section: true,
        listeningPosition: true,
        readingStartedAt: true,
        readingDeadline: true,
        exam: {
          select: {
            id: true,
            title: true,
            description: true,
            type: true,
            difficulty: true,
            durationSeconds: true,
            groups: {
              select: {
                id: true,
                examId: true,
                part: true,
                canonicalAccent: true,
                audioUrl: true,
                imageUrl: true,
                passageText: true,
                groupOrder: true,
                questions: {
                  select: {
                    id: true,
                    groupId: true,
                    questionNumber: true,
                    text: true,
                    options: true,
                  },
                  orderBy: { questionNumber: 'asc' },
                },
              },
              orderBy: { groupOrder: 'asc' },
            },
          },
        },
        answers: { select: { questionId: true, selectedIndex: true } },
      },
    });
    if (!current) throw new NotFoundException('Attempt not found');
    if (current.status === AttemptStatus.PENDING_START)
      return { ...current, exam: { ...current.exam, groups: [] } };
    return {
      ...current,
      markedQuestionIds: this.safeMarkedQuestionIds(current.markedQuestionIds),
      exam: {
        ...current.exam,
        // A part practice serves only its chosen Parts.
        groups: current.exam.groups
          .filter(
            (group) =>
              current.selectedParts.length === 0 ||
              current.selectedParts.includes(group.part),
          )
          .map((group) => ({
            ...group,
            passageText: group.part <= 4 ? null : group.passageText,
            questions: group.questions.map((question) => {
              // Part 1 and Part 2 prompts/options are audio-only in every mode:
              // the printed options are the spoken answers, so sending them
              // (as Practice once did) gave the answer away. Keep the option
              // cardinality for the answer UI; review shows the text afterwards.
              if (group.part <= 2) {
                return {
                  ...question,
                  text: null,
                  options: Array.isArray(question.options)
                    ? question.options.map(() => '')
                    : [],
                };
              }
              return question;
            }),
          })),
      },
    };
  }

  private safeMarkedQuestionIds(value: unknown): number[] {
    return Array.isArray(value)
      ? value.filter((id): id is number => Number.isInteger(id) && id > 0)
      : [];
  }

  private async validateAndSaveAnswers(
    tx: Prisma.TransactionClient,
    attempt: {
      id: number;
      examId: number;
      mode: AttemptMode;
      section: ToeicAttemptSection | null;
      selectedParts?: number[];
    },
    userId: number,
    answers: Record<string, number | null>,
  ) {
    const ids = Object.keys(answers).map(Number);
    if (
      ids.some((id) => !Number.isInteger(id)) ||
      new Set(ids).size !== ids.length
    )
      throw new BadRequestException('Danh sách câu trả lời không hợp lệ');
    const questions = await tx.toeicQuestion.findMany({
      where: { id: { in: ids }, group: { examId: attempt.examId } },
      select: { id: true, options: true, group: { select: { part: true } } },
    });
    if (questions.length !== ids.length)
      throw new BadRequestException('Câu hỏi không thuộc đề thi này');
    if (
      attempt.selectedParts?.length &&
      questions.some((q) => !attempt.selectedParts!.includes(q.group.part))
    )
      throw new BadRequestException('Câu hỏi không thuộc các Part đã chọn');
    if (attempt.mode === AttemptMode.FULL_TEST && attempt.section) {
      for (const question of questions) {
        const isListening = question.group.part <= 4;
        if (isListening && attempt.section !== ToeicAttemptSection.LISTENING)
          throw new BadRequestException(
            'Phần Listening đã kết thúc, không thể sửa đáp án',
          );
        if (!isListening && attempt.section !== ToeicAttemptSection.READING)
          throw new BadRequestException('Phần Reading chưa bắt đầu');
      }
    }
    // null clears a saved answer (restoring a checkpoint taken before it).
    const cleared = ids.filter((id) => answers[String(id)] === null);
    for (const question of questions) {
      const options = Array.isArray(question.options) ? question.options : [];
      const selected = answers[String(question.id)];
      if (selected === null) continue;
      if (
        !Number.isInteger(selected) ||
        selected < 0 ||
        selected >= options.length
      )
        throw new BadRequestException('Đáp án được chọn không hợp lệ');
    }
    if (cleared.length > 0)
      await tx.toeicAttemptAnswer.deleteMany({
        where: { attemptId: attempt.id, questionId: { in: cleared } },
      });
    const chosen = ids.filter((id) => answers[String(id)] !== null);
    if (chosen.length > 0) {
      const rows = chosen.map(
        (questionId) =>
          Prisma.sql`(${attempt.id}, ${questionId}, ${answers[String(questionId)]})`,
      );
      await tx.$executeRaw`
        INSERT INTO "ToeicAttemptAnswer" ("attemptId", "questionId", "selectedIndex")
        VALUES ${Prisma.join(rows)}
        ON CONFLICT ("attemptId", "questionId")
        DO UPDATE SET "selectedIndex" = EXCLUDED."selectedIndex"
      `;
    }
  }

  async saveAnswers(
    attemptId: number,
    userId: number,
    payload:
      | Record<string, number>
      | {
          answers: Record<string, number | null>;
          markedQuestionIds?: number[];
          currentQuestionId?: number;
        },
  ) {
    const request: {
      answers: Record<string, number | null>;
      markedQuestionIds?: number[];
      currentQuestionId?: number;
    } =
      typeof payload === 'object' &&
      payload !== null &&
      'answers' in payload &&
      typeof (payload as { answers?: unknown }).answers === 'object'
        ? (payload as {
            answers: Record<string, number | null>;
            markedQuestionIds?: number[];
            currentQuestionId?: number;
          })
        : { answers: payload as Record<string, number> };
    const result = await this.prisma.$transaction(async (tx) => {
      const initial = await tx.toeicAttempt.findUnique({
        where: { id: attemptId },
      });
      if (!initial) throw new NotFoundException('Attempt not found');
      await this.lockTuple(tx, initial.userId, initial.examId, initial.mode);
      await this.lockAttemptRow(tx, attemptId);
      const attempt = await tx.toeicAttempt.findUnique({
        where: { id: attemptId },
      });
      if (!attempt) throw new NotFoundException('Attempt not found');
      if (attempt.userId !== userId)
        throw new ForbiddenException(
          'Bạn không có quyền chỉnh sửa bài thi này',
        );
      if (attempt.status !== AttemptStatus.IN_PROGRESS)
        throw new BadRequestException('Lượt thi chưa bắt đầu hoặc đã kết thúc');
      const readingExpired =
        attempt.section === ToeicAttemptSection.READING &&
        attempt.readingDeadline &&
        attempt.readingDeadline <= new Date();
      if (
        (attempt.deadline && attempt.deadline <= new Date()) ||
        readingExpired
      ) {
        const finalization = await this.finalizeExpiredTx(
          tx,
          attemptId,
          userId,
        );
        return {
          success: false,
          expired: true,
          finalizedAttempt: finalization.finalized
            ? finalization.attempt
            : null,
        };
      }
      await this.validateAndSaveAnswers(tx, attempt, userId, request.answers);
      // Omitted = keep the saved flags (an answer-only save must not clear
      // them); an array, even [], replaces them.
      const markedQuestionIds = request.markedQuestionIds;
      if (markedQuestionIds !== undefined) {
        if (
          !Array.isArray(markedQuestionIds) ||
          markedQuestionIds.some((id) => !Number.isInteger(id) || id <= 0)
        )
          throw new BadRequestException('Danh sách câu đánh dấu không hợp lệ');
        const markedQuestions = await tx.toeicQuestion.count({
          where: {
            id: { in: markedQuestionIds },
            group: {
              examId: attempt.examId,
              ...(attempt.selectedParts?.length
                ? { part: { in: attempt.selectedParts } }
                : {}),
            },
          },
        });
        if (markedQuestions !== new Set(markedQuestionIds).size)
          throw new BadRequestException('Câu đánh dấu không thuộc đề thi này');
      }
      if (
        request.currentQuestionId !== undefined &&
        (request.currentQuestionId <= 0 ||
          (await tx.toeicQuestion.count({
            where: {
              id: request.currentQuestionId,
              group: { examId: attempt.examId },
            },
          })) !== 1)
      )
        throw new BadRequestException('Câu hiện tại không thuộc đề thi này');
      await tx.toeicAttempt.update({
        where: { id: attempt.id },
        data: {
          ...(markedQuestionIds !== undefined
            ? { markedQuestionIds: [...new Set(markedQuestionIds)] }
            : {}),
          ...(request.currentQuestionId !== undefined
            ? { currentQuestionId: request.currentQuestionId }
            : {}),
        },
      });
      return { success: true, expired: false, finalizedAttempt: null };
    });

    if (result.finalizedAttempt) {
      await this.emitSubmissionEvent(result.finalizedAttempt, userId);
    }
    if (result.expired) {
      throw new BadRequestException('Thời gian làm bài đã kết thúc');
    }
    return { success: true };
  }

  private async finalizeExpiredTx(
    tx: Prisma.TransactionClient,
    attemptId: number,
    userId: number,
  ): Promise<ExpiredFinalization> {
    await this.lockAttemptRow(tx, attemptId);
    const attempt = await tx.toeicAttempt.findUnique({
      where: { id: attemptId },
      include: {
        answers: { include: { question: { include: { group: true } } } },
      },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');
    if (attempt.userId !== userId)
      throw new ForbiddenException('Bạn không có quyền kết thúc lượt thi này');
    if (attempt.status === AttemptStatus.SUBMITTED)
      return { attempt, finalized: false };
    if (!attempt.deadline || attempt.deadline > new Date())
      return { attempt, finalized: false };
    return {
      attempt: await this.computeAndSubmitTx(tx, attempt, attempt.deadline),
      finalized: true,
    };
  }

  private async computeAndSubmitTx(
    tx: Prisma.TransactionClient,
    attempt: any,
    submittedAt: Date,
  ) {
    const counts = this.getRawCounts(attempt.answers);
    // A part practice is not a 200-question test: no converted scores.
    const partial = (attempt.selectedParts ?? []).length > 0;
    const full = this.legacyScores(
      counts.listeningCorrect,
      counts.readingCorrect,
    );
    const scores = partial
      ? { listeningScore: null, readingScore: null }
      : full;
    const updated = await tx.toeicAttempt.update({
      where: { id: attempt.id },
      data: {
        status: AttemptStatus.SUBMITTED,
        submittedAt,
        listeningCorrect: counts.listeningCorrect,
        readingCorrect: counts.readingCorrect,
        totalCorrect: counts.listeningCorrect + counts.readingCorrect,
        ...scores,
        totalScore: partial ? null : full.listeningScore + full.readingScore,
      },
    });
    return { ...updated, answers: attempt.answers };
  }

  private async finalizeExpired(attemptId: number, userId: number) {
    const result = await this.prisma.$transaction((tx) =>
      this.finalizeExpiredTx(tx, attemptId, userId),
    );
    if (result.finalized) {
      await this.emitSubmissionEvent(result.attempt, userId);
    }
    return result;
  }

  private async emitSubmissionEvent(attempt: any, userId: number) {
    if (!this.eventEmitter) return;
    await this.eventEmitter.emitAsync('toeic.submitted', {
      userId,
      examId: attempt.examId,
      mode: attempt.mode,
      attemptId: attempt.id,
    });
  }

  async submitAttempt(attemptId: number, userId: number) {
    const result = await this.prisma.$transaction(async (tx) => {
      const initial = await tx.toeicAttempt.findUnique({
        where: { id: attemptId },
      });
      if (!initial) throw new NotFoundException('Attempt not found');
      await this.lockTuple(tx, initial.userId, initial.examId, initial.mode);
      await this.lockAttemptRow(tx, attemptId);
      const attempt = await tx.toeicAttempt.findUnique({
        where: { id: attemptId },
        include: {
          answers: { include: { question: { include: { group: true } } } },
        },
      });
      if (!attempt) throw new NotFoundException('Attempt not found');
      if (attempt.userId !== userId)
        throw new ForbiddenException('Bạn không có quyền nộp bài thi này');
      if (attempt.status === AttemptStatus.SUBMITTED)
        return {
          formatted: this.formatResult(
            attempt,
            await this.getQuestionCounts(
              tx,
              attempt.examId,
              attempt.selectedParts,
            ),
          ),
          shouldEmit: false,
          attempt,
        };
      if (attempt.status !== AttemptStatus.IN_PROGRESS)
        throw new BadRequestException('Lượt thi chưa được bắt đầu');
      const submittedAt =
        attempt.deadline && attempt.deadline < new Date()
          ? attempt.deadline
          : new Date();
      const updated = await this.computeAndSubmitTx(tx, attempt, submittedAt);
      return {
        formatted: this.formatResult(
          updated,
          await this.getQuestionCounts(
            tx,
            attempt.examId,
            attempt.selectedParts,
          ),
        ),
        shouldEmit: true,
        attempt: updated,
      };
    });

    if (result.shouldEmit)
      await this.emitSubmissionEvent(result.attempt, userId);

    return result.formatted;
  }

  private formatResult(
    attempt: any,
    totals: {
      listeningTotal: number;
      readingTotal: number;
      parts?: Record<number, number>;
    },
  ) {
    const partBreakdown = [1, 2, 3, 4, 5, 6, 7].map((part) => {
      const partAnswers = ((attempt.answers ?? []) as AnswerRow[]).filter(
        (answer: AnswerRow) => answer.question.group.part === part,
      );
      return {
        part,
        correct:
          this.getRawCounts(partAnswers).listeningCorrect +
          this.getRawCounts(partAnswers).readingCorrect,
        total: totals.parts?.[part] ?? 0,
      };
    });
    return {
      ...attempt,
      practiceResult: {
        listeningCorrect: attempt.listeningCorrect ?? 0,
        listeningTotal: totals.listeningTotal,
        readingCorrect: attempt.readingCorrect ?? 0,
        readingTotal: totals.readingTotal,
        totalCorrect: attempt.totalCorrect ?? 0,
        totalQuestions: totals.listeningTotal + totals.readingTotal,
      },
      disclaimer:
        'Đây là kết quả luyện tập mô phỏng TOEIC, không phải điểm thi chính thức ETS.',
      scoreLabel: 'Điểm TOEIC ước tính trong bài luyện tập',
      partBreakdown,
    };
  }

  /**
   * Statistics over this learner's submitted L&R attempts (standalone and
   * 4 Skills children), for the last `days` before the latest submission
   * (all time when `days` is null).
   */
  async getLrStats(userId: number, days: number | null) {
    const attempts = await this.prisma.toeicAttempt.findMany({
      where: {
        userId,
        status: AttemptStatus.SUBMITTED,
        submittedAt: { not: null },
      },
      select: {
        id: true,
        examId: true,
        mode: true,
        startedAt: true,
        submittedAt: true,
        listeningScore: true,
        readingScore: true,
        totalScore: true,
        selectedParts: true,
        exam: { select: { title: true } },
        assessmentComponent: { select: { id: true } },
      },
    });
    const examIds = [...new Set(attempts.map((a) => a.examId))];
    const [questions, answers] = await Promise.all([
      this.prisma.toeicQuestion.findMany({
        where: { group: { examId: { in: examIds } } },
        select: {
          id: true,
          text: true,
          options: true,
          correctIndex: true,
          group: { select: { examId: true, part: true, passageText: true } },
        },
      }),
      this.prisma.toeicAttemptAnswer.findMany({
        where: { attemptId: { in: attempts.map((a) => a.id) } },
        select: { attemptId: true, questionId: true, selectedIndex: true },
      }),
    ]);
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      select: { targetScore: true, nextExamDate: true },
    });
    const stats = buildLrStats({
      days,
      attempts: attempts.map((a) => ({
        id: a.id,
        examId: a.examId,
        examTitle: a.exam.title,
        mode: a.mode,
        inAssessment: Boolean(a.assessmentComponent),
        startedAt: a.startedAt,
        submittedAt: a.submittedAt!,
        listeningScore: a.listeningScore,
        readingScore: a.readingScore,
        totalScore: a.totalScore,
        parts: a.selectedParts,
      })),
      questions: questions.map((q) => ({
        id: q.id,
        examId: q.group.examId,
        part: q.group.part,
        correctIndex: q.correctIndex,
        type: toeicQuestionType({
          part: q.group.part,
          text: q.text,
          options: q.options,
          correctIndex: q.correctIndex,
          groupText: q.group.passageText,
        }),
      })),
      answers,
    });
    return { ...stats, goal: parseToeicGoal(profile) };
  }

  /** Save the learner's TOEIC exam date and target score on their profile. */
  async saveToeicGoal(
    userId: number,
    goal: { examDate?: string | null; targetScore?: number | null },
  ) {
    const examDate = goal.examDate ?? null;
    if (examDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(examDate))
      throw new BadRequestException('Ngày dự thi phải có dạng YYYY-MM-DD');
    if (examDate !== null && Number.isNaN(Date.parse(examDate)))
      throw new BadRequestException('Ngày dự thi không hợp lệ');
    const target = goal.targetScore ?? null;
    if (
      target !== null &&
      (!Number.isInteger(target) ||
        target < 10 ||
        target > 990 ||
        target % 5 !== 0)
    )
      throw new BadRequestException(
        'Điểm mục tiêu TOEIC phải là bội số của 5, từ 10 đến 990',
      );
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!profile) throw new NotFoundException('Không tìm thấy hồ sơ học viên');
    const saved = await this.prisma.profile.update({
      where: { userId },
      data: {
        nextExamDate: examDate,
        targetScore: target === null ? null : `TOEIC ${target}`,
      },
      select: { targetScore: true, nextExamDate: true },
    });
    return parseToeicGoal(saved);
  }

  async getHistory(userId: number) {
    const attempts = await this.prisma.toeicAttempt.findMany({
      // Child attempts that belong to a unified assessment are represented by
      // the parent history entry. Keep this endpoint for standalone L&R work
      // so the learner does not see the same attempt twice.
      where: { userId, assessmentComponent: null },
      include: { exam: { select: { id: true, title: true, type: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return attempts.map((attempt) => ({
      id: attempt.id,
      exam: attempt.exam,
      mode: attempt.mode,
      status: attempt.status,
      createdAt: attempt.createdAt,
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
      totalScore: attempt.totalScore,
      listeningCorrect: attempt.listeningCorrect,
      readingCorrect: attempt.readingCorrect,
      totalCorrect: attempt.totalCorrect,
    }));
  }

  async getReview(attemptId: number, userId: number, role?: string) {
    const attempt = await this.prisma.toeicAttempt.findUnique({
      where: { id: attemptId },
      include: {
        exam: {
          select: {
            id: true,
            title: true,
            type: true,
            groups: {
              include: { questions: true },
              orderBy: { groupOrder: 'asc' },
            },
          },
        },
        assessmentComponent: { select: { id: true } },
        answers: {
          include: {
            question: {
              include: {
                group: {
                  select: {
                    id: true,
                    part: true,
                    groupOrder: true,
                    passageText: true,
                    imageUrl: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!attempt) throw new NotFoundException('Review not found');
    if (role !== 'ADMIN' && attempt.userId !== userId)
      throw new ForbiddenException('Bạn không có quyền xem bài review này');
    // Answer keys, transcripts and explanations exist only after submission.
    if (attempt.status !== AttemptStatus.SUBMITTED)
      throw new BadRequestException('Chỉ có thể xem review sau khi nộp bài');
    const inScope = (part: number) =>
      attempt.selectedParts.length === 0 ||
      attempt.selectedParts.includes(part);
    const answerOf = new Map(
      attempt.answers.map((a) => [a.questionId, a.selectedIndex]),
    );
    const marked = new Set(
      this.safeMarkedQuestionIds(attempt.markedQuestionIds),
    );
    const groups = attempt.exam.groups.filter((g) => inScope(g.part));
    // The listening transcript is the exact authored text the group's audio
    // was synthesized from; null when it cannot be built.
    const transcriptOf = (group: (typeof groups)[number]) => {
      if (group.part > 4) return null;
      try {
        return buildToeicListeningAudioScript(group);
      } catch {
        return null;
      }
    };
    const questions = groups
      .flatMap((group) =>
        group.questions.map((question) => ({ group, question })),
      )
      .sort((a, b) => a.question.questionNumber - b.question.questionNumber)
      .map(({ group, question }) => {
        const selected = answerOf.get(question.id) ?? null;
        const options = Array.isArray(question.options)
          ? (question.options as string[])
          : [];
        const status = reviewStatus(selected, question.correctIndex);
        return {
          questionId: question.id,
          questionNumber: question.questionNumber,
          part: group.part,
          groupId: group.id,
          passageText: group.part <= 4 ? null : group.passageText,
          imageUrl: group.imageUrl,
          transcript: transcriptOf(group),
          questionText: question.text,
          options,
          selectedIndex: selected,
          correctIndex: question.correctIndex,
          learnerAnswer: selected === null ? null : (options[selected] ?? null),
          standardAnswer: options[question.correctIndex] ?? null,
          status,
          isCorrect: status === 'CORRECT',
          flagged: marked.has(question.id),
          explanation: question.explanation ?? null,
        };
      });
    const durationSeconds =
      attempt.startedAt && attempt.submittedAt
        ? Math.max(
            0,
            Math.round(
              (attempt.submittedAt.getTime() - attempt.startedAt.getTime()) /
                1000,
            ),
          )
        : null;
    return {
      attemptId: attempt.id,
      exam: {
        id: attempt.exam.id,
        title: attempt.exam.title,
        type: attempt.exam.type,
      },
      mode: attempt.mode,
      selectedParts: attempt.selectedParts,
      inAssessment: Boolean(attempt.assessmentComponent),
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
      durationSeconds,
      // Internal conversion (5 points per correct answer per skill); null for
      // a part practice. Not an ETS score.
      scores: {
        listening: attempt.listeningScore,
        reading: attempt.readingScore,
        total: attempt.totalScore,
      },
      summary: summarizeLrReview(questions),
      questions,
    };
  }

  async cancelAttempt(attemptId: number, userId: number) {
    return this.prisma.$transaction(async (tx) => {
      const initial = await tx.toeicAttempt.findUnique({
        where: { id: attemptId },
      });
      if (!initial) throw new NotFoundException('Attempt not found');
      await this.lockTuple(tx, initial.userId, initial.examId, initial.mode);
      await this.lockAttemptRow(tx, attemptId);
      const attempt = await tx.toeicAttempt.findUnique({
        where: { id: attemptId },
      });
      if (!attempt) throw new NotFoundException('Attempt not found');
      if (attempt.userId !== userId)
        throw new ForbiddenException('Bạn không có quyền hủy lượt thi này');
      if (attempt.status === AttemptStatus.SUBMITTED)
        throw new BadRequestException('Không thể hủy lượt thi đã nộp');
      await tx.toeicAttempt.delete({ where: { id: attemptId } });
      return { success: true, attemptId };
    });
  }

  async recordIntegrityEvent(
    attemptId: number,
    userId: number,
    eventType: IntegrityEventType,
    questionId?: number,
    metadata?: unknown,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const initial = await tx.toeicAttempt.findUnique({
        where: { id: attemptId },
      });
      if (!initial) throw new NotFoundException('Attempt not found');
      await this.lockTuple(tx, initial.userId, initial.examId, initial.mode);
      await this.lockAttemptRow(tx, attemptId);
      const attempt = await tx.toeicAttempt.findUnique({
        where: { id: attemptId },
      });
      if (!attempt || attempt.userId !== userId)
        throw new ForbiddenException('Bạn không có quyền ghi nhận sự kiện này');
      if (
        attempt.status !== AttemptStatus.IN_PROGRESS ||
        !attempt.deadline ||
        attempt.deadline <= new Date()
      )
        throw new BadRequestException('Lượt thi đã kết thúc');
      let part: number | undefined;
      if (questionId !== undefined) {
        const question = await tx.toeicQuestion.findFirst({
          where: { id: questionId, group: { examId: attempt.examId } },
          select: { group: { select: { part: true } } },
        });
        if (!question)
          throw new BadRequestException('Câu hỏi không thuộc lượt thi');
        part = question.group.part;
      }
      return tx.toeicIntegrityEvent.create({
        data: {
          attemptId,
          eventType,
          questionId,
          part,
          metadata: metadata as Prisma.InputJsonValue | undefined,
        },
      });
    });
  }

  async getRemainingTime(attemptId: number, userId: number, role?: string) {
    const attempt = await this.prisma.toeicAttempt.findUnique({
      where: { id: attemptId },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');
    if (role !== 'ADMIN' && attempt.userId !== userId)
      throw new ForbiddenException('Bạn không có quyền truy cập bài thi này');
    if (attempt.status !== AttemptStatus.IN_PROGRESS)
      return { remaining: 0, section: attempt.section };
    // Strict Full Test: Listening is paced by the audio manifest, not a
    // countdown — the client should not show a Reading-style timer there.
    // Reading has its own server-authoritative 75-minute deadline.
    if (attempt.mode === AttemptMode.FULL_TEST && attempt.section) {
      if (attempt.section === ToeicAttemptSection.LISTENING)
        return { remaining: null, section: ToeicAttemptSection.LISTENING };
      return {
        remaining: attempt.readingDeadline
          ? Math.max(
              0,
              Math.floor(
                (attempt.readingDeadline.getTime() - Date.now()) / 1000,
              ),
            )
          : 0,
        section: ToeicAttemptSection.READING,
      };
    }
    return {
      remaining: attempt.deadline
        ? Math.max(
            0,
            Math.floor((attempt.deadline.getTime() - Date.now()) / 1000),
          )
        : 0,
      section: attempt.section,
    };
  }

  async getResult(attemptId: number, userId: number, role?: string) {
    const attempt = await this.prisma.toeicAttempt.findUnique({
      where: { id: attemptId },
    });
    if (!attempt) throw new NotFoundException('Result not found');
    if (role !== 'ADMIN' && attempt.userId !== userId)
      throw new ForbiddenException(
        'Bạn không có quyền xem kết quả bài thi này',
      );
    if (attempt.status !== AttemptStatus.SUBMITTED) {
      const expired =
        (attempt.deadline && attempt.deadline <= new Date()) ||
        (attempt.section === ToeicAttemptSection.READING &&
          attempt.readingDeadline &&
          attempt.readingDeadline <= new Date());
      if (expired) await this.finalizeExpired(attemptId, attempt.userId);
      else throw new BadRequestException('Bài thi đang diễn ra, chưa nộp bài');
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const current = await tx.toeicAttempt.findUnique({
        where: { id: attemptId },
        include: {
          answers: { include: { question: { include: { group: true } } } },
        },
      });
      if (!current) throw new NotFoundException('Result not found');
      return {
        formatted: this.formatResult(
          current,
          await this.getQuestionCounts(
            tx,
            current.examId,
            current.selectedParts,
          ),
        ),
      };
    });

    return result.formatted;
  }
}
