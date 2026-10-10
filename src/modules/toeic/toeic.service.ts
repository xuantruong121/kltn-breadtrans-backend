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
import {
  AttemptMode,
  AttemptStatus,
  IntegrityEventType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SpeakingService } from '../speaking/speaking.service';
import { validateToeicExam } from './toeic.validation';

const MIN_DURATION = 60;
const MAX_DURATION = 21600;
const PENDING_TTL_MS = 2 * 60 * 60 * 1000;

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
  ) {
    const groups = await tx.toeicQuestionGroup.findMany({
      where: { examId },
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

  async getExams() {
    const exams = await this.prisma.toeicExamSet.findMany({
      include: {
        groups: {
          include: { questions: true },
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
        learnerReady: validation.learnerReady,
        validation: { counts: validation.counts, issues: validation.issues },
      };
    });
  }

  async getExamBriefing(examId: number, userId?: number) {
    const exam = await this.prisma.toeicExamSet.findUnique({
      where: { id: examId },
      include: {
        groups: {
          select: {
            id: true,
            part: true,
            groupOrder: true,
            imageUrl: true,
            audioUrl: true,
            passageText: true,
            questions: {
              select: {
                id: true,
                questionNumber: true,
                options: true,
                correctIndex: true,
              },
            },
          },
          orderBy: { groupOrder: 'asc' },
        },
      },
    });
    if (!exam) throw new NotFoundException('Exam not found');
    const partQuestionCounts = new Map<number, number>();
    for (const group of exam.groups) {
      partQuestionCounts.set(
        group.part,
        (partQuestionCounts.get(group.part) ?? 0) + group.questions.length,
      );
    }

    const validation = validateToeicExam(exam);
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
    if (metadata.examFormat !== 'FOUR_SKILL' || metadata.isBundle !== true)
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
        questions: { select: { options: true }, take: 1 },
      },
    });
    if (!group) throw new NotFoundException('TOEIC question group not found');
    const attempt = await this.prisma.toeicAttempt.findUnique({
      where: { id: attemptId },
      select: { userId: true, examId: true, mode: true, status: true },
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
    if (group.audioUrl) {
      const response = await fetch(group.audioUrl);
      if (response.ok) return Buffer.from(await response.arrayBuffer());
    }
    // Strict Full Test playback must use a durable authored artifact. Practice
    // mode keeps its legacy pedagogical fallback for groups that are not yet
    // materialized; authoring is handled by the bounded maintenance script.
    if (attempt.mode !== AttemptMode.FULL_TEST) {
      let text = group.passageText;
      if (group.part === 1) {
        const options = group.questions[0]?.options;
        if (
          !Array.isArray(options) ||
          !options.every((item) => typeof item === 'string')
        ) {
          throw new ServiceUnavailableException(
            'Câu Part 1 chưa có nội dung audio',
          );
        }
        text = options.join(' ');
      }
      if (group.part === 2 && text) {
        text = text.replace(/^\s*AUDIO\s+PROMPT\s*:\s*/i, '');
      }
      if (!text)
        throw new ServiceUnavailableException('Nhóm câu hỏi này chưa có audio');
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
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockTuple(tx, userId, examId, mode);
        const exam = await tx.toeicExamSet.findUnique({
          where: { id: examId },
          include: { groups: { include: { questions: true } } },
        });
        if (!exam) throw new NotFoundException('Exam not found');
        this.validateDuration(exam.durationSeconds);
        this.validateModeCompatibility(exam.type, mode);
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
          } else return { ...active, reused: true };
        }
        const created = await tx.toeicAttempt.create({
          data: {
            userId,
            examId,
            mode,
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
        data: { status: AttemptStatus.IN_PROGRESS, startedAt, deadline },
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
      attempt.deadline &&
      attempt.deadline <= new Date()
    )
      await this.finalizeExpired(attemptId, attempt.userId);
    const current = await this.prisma.toeicAttempt.findUnique({
      where: { id: attemptId },
      include: {
        exam: {
          include: {
            groups: {
              include: { questions: { orderBy: { questionNumber: 'asc' } } },
              orderBy: { groupOrder: 'asc' },
            },
          },
        },
        answers: true,
      },
    });
    if (!current) throw new NotFoundException('Attempt not found');
    if (current.status === AttemptStatus.PENDING_START)
      return { ...current, exam: { ...current.exam, groups: [] } };
    return {
      ...current,
      exam: {
        ...current.exam,
        groups: current.exam.groups.map((group) => ({
          ...group,
          passageText: group.part <= 4 ? null : group.passageText,
          questions: group.questions.map((question) => {
            const {
              correctIndex: _correctIndex,
              explanation: _explanation,
              ...safeQuestion
            } = question;
            void _correctIndex;
            void _explanation;
            // In a full-test attempt Part 1 and Part 2 prompts/options are
            // audio-only. Keep option cardinality for the answer UI, but do
            // not send the answer text to the browser before submission.
            if (current.mode === AttemptMode.FULL_TEST && group.part <= 2) {
              return {
                ...safeQuestion,
                text: null,
                options: Array.isArray(question.options)
                  ? question.options.map(() => '')
                  : [],
              };
            }
            return safeQuestion;
          }),
        })),
      },
    };
  }

  private async validateAndSaveAnswers(
    tx: Prisma.TransactionClient,
    attempt: { id: number; examId: number },
    userId: number,
    answers: Record<string, number>,
  ) {
    const ids = Object.keys(answers).map(Number);
    if (
      ids.some((id) => !Number.isInteger(id)) ||
      new Set(ids).size !== ids.length
    )
      throw new BadRequestException('Danh sách câu trả lời không hợp lệ');
    const questions = await tx.toeicQuestion.findMany({
      where: { id: { in: ids }, group: { examId: attempt.examId } },
      select: { id: true, options: true },
    });
    if (questions.length !== ids.length)
      throw new BadRequestException('Câu hỏi không thuộc đề thi này');
    for (const question of questions) {
      const options = Array.isArray(question.options) ? question.options : [];
      const selected = answers[String(question.id)];
      if (
        !Number.isInteger(selected) ||
        selected < 0 ||
        selected >= options.length
      )
        throw new BadRequestException('Đáp án được chọn không hợp lệ');
    }
    await Promise.all(
      ids.map((questionId) =>
        tx.toeicAttemptAnswer.upsert({
          where: {
            attemptId_questionId: { attemptId: attempt.id, questionId },
          },
          update: { selectedIndex: answers[String(questionId)] },
          create: {
            attemptId: attempt.id,
            questionId,
            selectedIndex: answers[String(questionId)],
          },
        }),
      ),
    );
  }

  async saveAnswers(
    attemptId: number,
    userId: number,
    answers: Record<string, number>,
  ) {
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
      if (attempt.deadline && attempt.deadline <= new Date()) {
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
      await this.validateAndSaveAnswers(tx, attempt, userId, answers);
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
    const scores = this.legacyScores(
      counts.listeningCorrect,
      counts.readingCorrect,
    );
    const updated = await tx.toeicAttempt.update({
      where: { id: attempt.id },
      data: {
        status: AttemptStatus.SUBMITTED,
        submittedAt,
        listeningCorrect: counts.listeningCorrect,
        readingCorrect: counts.readingCorrect,
        totalCorrect: counts.listeningCorrect + counts.readingCorrect,
        ...scores,
        totalScore: scores.listeningScore + scores.readingScore,
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
            await this.getQuestionCounts(tx, attempt.examId),
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
          await this.getQuestionCounts(tx, attempt.examId),
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

  async getHistory(userId: number) {
    const attempts = await this.prisma.toeicAttempt.findMany({
      where: { userId },
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
    if (attempt.status !== AttemptStatus.SUBMITTED)
      throw new BadRequestException('Chỉ có thể xem review sau khi nộp bài');
    return {
      attemptId: attempt.id,
      exam: attempt.exam,
      submittedAt: attempt.submittedAt,
      questions: attempt.exam.groups
        .flatMap((group) =>
          group.questions.map((question) => ({ group, question })),
        )
        .sort((a, b) => a.question.questionNumber - b.question.questionNumber)
        .map(({ group, question }) => {
          const answer = attempt.answers.find(
            (candidate) => candidate.questionId === question.id,
          );
          const options = Array.isArray(question.options)
            ? question.options
            : [];
          const standardAnswer = options[question.correctIndex];
          return {
            questionId: question.id,
            questionNumber: question.questionNumber,
            part: group.part,
            passageText: group.passageText,
            imageUrl: group.imageUrl,
            questionText: question.text,
            options,
            learnerAnswer:
              answer?.selectedIndex == null
                ? null
                : (options[answer.selectedIndex] ?? null),
            standardAnswer:
              typeof standardAnswer === 'string' ? standardAnswer : null,
            isCorrect:
              answer?.selectedIndex != null &&
              answer.selectedIndex === question.correctIndex,
            explanation: question.explanation ?? null,
          };
        }),
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
    return {
      remaining:
        attempt.deadline && attempt.status === AttemptStatus.IN_PROGRESS
          ? Math.max(
              0,
              Math.floor((attempt.deadline.getTime() - Date.now()) / 1000),
            )
          : 0,
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
      if (attempt.deadline && attempt.deadline <= new Date())
        await this.finalizeExpired(attemptId, attempt.userId);
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
          await this.getQuestionCounts(tx, current.examId),
        ),
      };
    });

    return result.formatted;
  }
}
