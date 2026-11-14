import { hasVietnameseDiacritics } from '../diagnostic/diagnostic-productive';
import { levelFields } from '../learning-path/level-access.service';
import {
  completedWritingQuizIds,
  loadWritingExerciseProgress,
  writingCompletionStatuses,
  writingCompletionXp,
} from './writing-exercise-progress';
import {
  exceedsPictureWordLimit,
  PICTURE_SENTENCE,
  PICTURE_SENTENCE_MAX_WORDS,
  buildPracticeWritingRequest,
  practiceRubric,
  practiceWritingTask,
  validatePracticeWritingResult,
  type PracticeWritingResult,
} from './practice-writing-grading';
import {
  planLimits,
  revisionLimitMessage,
  type PlanCode,
} from '../subscription/plan-limits';
import { SubscriptionService } from '../subscription/subscription.service';
import { loadRevisionChain } from './writing-revision';
import {
  closestAnswer,
  matchTranslation,
  SENTENCE_TRANSLATION_MAX_CHARS,
  SENTENCE_TRANSLATION_MAX_SCORE,
  SENTENCE_TRANSLATION_RUBRIC,
  translationTaskOf,
  type SentenceTranslationTask,
} from './sentence-translation.logic';
import {
  buildTranslationGradeRequest,
  validateTranslationGrade,
  type TranslationGrade,
} from './sentence-translation-grading';
import {
  translationResult,
  translationVerdictLabel,
  type TranslationCheck,
} from './sentence-translation-result';
import {
  returnAiGrading,
  takeAiGrading,
} from '../../common/guards/ai-rate-limit.guard';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { MistakesService } from '../mistakes/mistakes.service';
import type Redis from 'ioredis';
import {
  revisionGate,
  revisionGraderInput,
  revisionView,
  type RevisionAttempt,
} from './writing-revision.logic';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { QuizPublicationStatus, QuizType, TopicCategory } from '@prisma/client';
import { AiService } from '../ai/ai.service';
import { QuizContentAccessService } from '../quiz/quiz-content-access.service';
import { TrialService } from '../subscription/trial.service';
import { cefrSpan } from '../subscription/practice-level';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import {
  EXAM_WRITING_GIVE_UP_AFTER_MS,
  EXAM_WRITING_RETRY_AFTER_MS,
  examWritingGaveUp,
  examWritingTries,
} from './exam-writing-grading';

/** A task's cue words, from either authored field. */
export function keywordsOf(c: any): string[] {
  return Array.isArray(c?.keywords)
    ? c.keywords
    : Array.isArray(c?.requiredKeywords)
      ? c.requiredKeywords
      : [];
}

const GENERAL_WRITING_TYPES: QuizType[] = [
  QuizType.WRITING_PICTURE,
  QuizType.WRITING_EMAIL,
];

/**
 * A Writing task is either a catalog practice task (Writing Part 1/2 topic) or
 * a task of a TOEIC exam writing set. Exam tasks have no practice topic, so
 * requiring one made every exam Writing task answer "not found"; access to
 * them is still restricted by assertExamInternalWritingAccess.
 */
const PRACTICE_GRADE_ATTEMPTS = 2;
/**
 * Practice grading deadline. A timeout is ambiguous (the provider may still
 * finish and bill the request), so it ends the grading instead of trying
 * another key; the learner's text is not stored and they may submit again.
 */
const PRACTICE_GRADE_TIMEOUT_MS = 60_000;
/** One sentence is quick to judge; a learner is waiting on it. */
const TRANSLATION_GRADE_TIMEOUT_MS = 20_000;

function isWritingQuiz(quiz: {
  type: QuizType;
  practiceTopic?: { category: TopicCategory } | null;
  toeicWritingSetItems?: unknown[];
}) {
  return (
    GENERAL_WRITING_TYPES.includes(quiz.type) &&
    (quiz.practiceTopic?.category === TopicCategory.WRITING_PART1 ||
      quiz.practiceTopic?.category === TopicCategory.WRITING_PART2 ||
      (quiz.toeicWritingSetItems?.length ?? 0) > 0)
  );
}

@Injectable()
export class WritingService {
  private readonly logger = new Logger(WritingService.name);
  /** Keeps the job from grading an answer the first pass is still on. */
  private readonly gradingNow = new Set<number>();

  constructor(
    private prisma: PrismaService,
    private aiService: AiService,
    @Optional() private readonly quizContentAccess?: QuizContentAccessService,
    @Optional() private readonly eventEmitter?: EventEmitter2,
    @Optional() private readonly trial?: TrialService,
    @Optional() private readonly subscriptions?: SubscriptionService,
    @Optional() @InjectRedis() private readonly redis?: Redis,
    @Optional() private readonly mistakes?: MistakesService,
  ) {}

  /** The plan that decides how many revisions this learner gets. */
  private async revisionPlan(
    userId: number,
    role?: import('@prisma/client').Role,
  ): Promise<PlanCode> {
    if (role === 'ADMIN') return 'PRO';
    return (await this.subscriptions?.planCodeFor(userId)) ?? 'FREE';
  }

  private async resolveCanonicalTask(
    quizId: number,
    userId: number,
    role: import('@prisma/client').Role | undefined,
    expectedPart: 'PART2' | 'PART3' | 'ANY',
    context?: { attemptId: number; componentId: number },
  ) {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id: quizId },
      include: {
        practiceTopic: true,
        toeicWritingSetItems: { select: { id: true }, take: 1 },
        questions: {
          select: { id: true, content: true },
          orderBy: { order: 'asc' },
          take: 1,
        },
      },
    });

    if (!quiz || !isWritingQuiz(quiz) || quiz.questions.length === 0) {
      throw new NotFoundException('Không tìm thấy bài Viết.');
    }
    if (expectedPart !== 'ANY' && quiz.type !== QuizType.WRITING_EMAIL) {
      throw new BadRequestException('Bài viết không thuộc Writing Part 2/3');
    }
    await this.assertWritingAccess(quiz, userId, role);
    if (role !== 'ADMIN')
      await this.assertExamInternalWritingAccess(quizId, userId, context);

    const question = quiz.questions[0];
    const content = (question.content ?? {}) as Record<string, unknown>;
    const isPart3 = [
      'PROPOSAL',
      'OPINION',
      'ESSAY',
      'OPINION_ESSAY',
      'ANALYTICAL_RESPONSE',
      'ARGUMENT',
    ].includes(String(content.taskType));
    if (
      expectedPart !== 'ANY' &&
      ((expectedPart === 'PART3' && !isPart3) ||
        (expectedPart === 'PART2' && isPart3))
    ) {
      throw new BadRequestException('Bài viết không thuộc đúng phần đánh giá');
    }

    const prompt = String(
      content.prompt ?? quiz.description ?? quiz.title,
    ).trim();
    if (!prompt)
      throw new BadRequestException('Writing task chưa có đề bài hợp lệ');

    return {
      quiz,
      question,
      content,
      prompt,
      isPart3,
      maxScore: isPart3 ? 5 : 4,
    };
  }

  private validateEvaluation(
    evaluation: unknown,
    maxScore: number,
  ): { score: number; feedback: string; suggestions: string[] } {
    if (!evaluation || typeof evaluation !== 'object') {
      throw new ServiceUnavailableException('AI trả về kết quả không hợp lệ');
    }
    const value = evaluation as Record<string, unknown>;
    const score = Number(value.score);
    const feedback = value.feedback;
    const suggestions = value.suggestions;
    if (
      !Number.isFinite(score) ||
      score < 0 ||
      score > maxScore ||
      typeof feedback !== 'string' ||
      feedback.trim().length === 0 ||
      feedback.length > 10000 ||
      !Array.isArray(suggestions) ||
      suggestions.length > 30 ||
      suggestions.some((item) => typeof item !== 'string' || item.length > 2000)
    ) {
      throw new ServiceUnavailableException(
        'AI trả về kết quả đánh giá không hợp lệ',
      );
    }
    return {
      score,
      feedback: feedback.trim(),
      suggestions: suggestions
        .map((item) => String(item).trim())
        .filter(Boolean),
    };
  }

  private parsePersistedEvaluation(raw: string | null, maxScore: number) {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      // Practice results store their own scale and detail.
      if (parsed.rubricVersion && Number.isInteger(parsed.maxScore)) {
        const base = this.validateEvaluation(parsed, parsed.maxScore as number);
        return { ...base, detail: parsed as unknown as PracticeWritingResult };
      }
      return this.validateEvaluation(parsed, maxScore);
    } catch {
      return null;
    }
  }

  private async getIdempotentSubmission(
    userId: number,
    quizId: number,
    clientAttemptId?: string,
  ) {
    if (!clientAttemptId) return null;
    return this.prisma.submission.findUnique({
      where: {
        userId_quizId_clientAttemptId: { userId, quizId, clientAttemptId },
      },
      include: { results: true },
    });
  }

  private async persistAssessment(input: {
    quizId: number;
    quizTitle: string;
    quizType: QuizType;
    questionId: number;
    userId: number;
    answer: string;
    clientAttemptId: string;
    evaluation: { score: number; feedback: string; suggestions: string[] };
    maxScore: number;
    detail?: PracticeWritingResult;
    /** Catalog exercises: every task must be graded before the exercise counts. */
    exercise?: { questionIds: number[]; position: number };
    /** An exam answer stored earlier: its grade is written onto that row. */
    pendingSubmissionId?: number;
    /** More fields for aiFeedback (a translation check keeps its result here). */
    extra?: Record<string, unknown>;
  }) {
    const feedback = JSON.stringify({
      ...(input.detail ?? {}),
      ...(input.extra ?? {}),
      feedback: input.evaluation.feedback,
      suggestions: input.evaluation.suggestions,
      maxScore: input.maxScore,
      score: input.evaluation.score,
      skill: 'WRITING',
    });
    try {
      const submission = await this.prisma.$transaction(async (tx) => {
        let created: { id: number };
        if (input.pendingSubmissionId) {
          const claimed = await tx.submission.updateMany({
            where: { id: input.pendingSubmissionId, score: null },
            data: { score: input.evaluation.score, aiFeedback: feedback },
          });
          if (claimed.count === 0) return null;
          await tx.result.updateMany({
            where: { submissionId: input.pendingSubmissionId },
            data: { score: input.evaluation.score },
          });
          created = { id: input.pendingSubmissionId };
        } else {
          created = await tx.submission.create({
            data: {
              quizId: input.quizId,
              userId: input.userId,
              clientAttemptId: input.clientAttemptId,
              score: input.evaluation.score,
              aiFeedback: feedback,
              results: {
                create: [
                  {
                    questionId: input.questionId,
                    answer: input.answer,
                    score: input.evaluation.score,
                  },
                ],
              },
            },
          });
        }
        await tx.learningActivity.create({
          data: {
            userId: input.userId,
            type: 'WRITING_PRACTICE_COMPLETED',
            title: input.exercise
              ? `${input.quizTitle} — Câu ${input.exercise.position}/${input.exercise.questionIds.length}`
              : input.quizTitle,
            detail: `${input.evaluation.score}/${input.maxScore} điểm`,
            score: Math.round((input.evaluation.score / input.maxScore) * 100),
            sourceType: 'WRITING_SUBMISSION',
            sourceId: String(created.id),
          },
        });
        return created;
      });
      // Another pass already stored this grade, and its reward.
      if (!submission) return { id: input.pendingSubmissionId as number };

      // A multi-task exercise is rewarded once, when its last task is graded,
      // with the exercise score; earlier tasks earn nothing on their own.
      let score = Math.round((input.evaluation.score / input.maxScore) * 100);
      if (input.exercise) {
        const { summary } = await loadWritingExerciseProgress(
          this.prisma,
          input.userId,
          input.quizId,
          input.exercise.questionIds,
        );
        if (!summary.complete || summary.percent === null) return submission;
        score = summary.percent;
      }
      const rewardInsert = await this.prisma.userQuizReward.createMany({
        data: { userId: input.userId, quizId: input.quizId },
        skipDuplicates: true,
      });
      this.eventEmitter?.emit('quiz.submitted', {
        userId: input.userId,
        quizId: input.quizId,
        score,
        scorePercent: score,
        xp: writingCompletionXp(score),
        quizType: input.quizType,
        submissionId: submission.id,
        isFirstSubmission: rewardInsert.count === 1,
      });
      return submission;
    } catch (error) {
      if (this.isClientAttemptConflict(error)) {
        const existing = await this.getIdempotentSubmission(
          input.userId,
          input.quizId,
          input.clientAttemptId,
        );
        if (existing) return existing;
      }
      throw error;
    }
  }

  /** Grades stored exam answers one at a time. Never throws for a bad grade. */
  async gradeExamSubmissions(submissionIds: number[]) {
    for (const id of submissionIds) await this.gradeExamSubmission(id);
  }

  /** The system job: picks up answers whose first grading did not finish. */
  async retryUngradedExamWriting(now = new Date()) {
    const rows = await this.prisma.submission.findMany({
      where: {
        score: null,
        assessmentLinks: { some: {} },
        submittedAt: {
          gte: new Date(now.getTime() - EXAM_WRITING_GIVE_UP_AFTER_MS),
          lte: new Date(now.getTime() - EXAM_WRITING_RETRY_AFTER_MS),
        },
      },
      select: { id: true, aiFeedback: true, submittedAt: true },
      orderBy: { id: 'asc' },
      take: 24,
    });
    await this.gradeExamSubmissions(
      rows.filter((row) => !examWritingGaveUp(row, now)).map((row) => row.id),
    );
    return { attempted: rows.length };
  }

  private async gradeExamSubmission(id: number) {
    if (this.gradingNow.has(id)) return;
    this.gradingNow.add(id);
    try {
      const submission = await this.prisma.submission.findUnique({
        where: { id },
        include: {
          results: { take: 1 },
          quiz: {
            include: {
              practiceTopic: true,
              questions: {
                select: { id: true, content: true },
                orderBy: [{ order: 'asc' }, { id: 'asc' }],
                take: 1,
              },
            },
          },
        },
      });
      const answer = submission?.results[0]?.answer;
      const question = submission?.quiz.questions[0];
      if (
        !submission ||
        submission.score !== null ||
        typeof answer !== 'string' ||
        !question
      )
        return;
      const quiz = submission.quiz;
      const content = question.content as any;
      try {
        const { evaluation, validatedEvaluation, detail } =
          await this.gradeAnswer(
            quiz,
            content,
            answer,
            quiz.practiceTopic
              ? practiceWritingTask(content ?? {}, quiz.title)
              : null,
          );
        await this.persistAssessment({
          detail,
          quizId: quiz.id,
          quizTitle: quiz.title,
          quizType: quiz.type,
          questionId: question.id,
          userId: submission.userId,
          answer,
          clientAttemptId: submission.clientAttemptId ?? '',
          evaluation: validatedEvaluation,
          maxScore: evaluation.maxScore,
          pendingSubmissionId: id,
        });
      } catch (error) {
        this.logger.warn(
          `exam_writing_grading_failed submissionId=${id}: ${(error as Error).message}`,
        );
        await this.prisma.submission.updateMany({
          where: { id, score: null },
          data: {
            aiFeedback: JSON.stringify({
              gradingTries: examWritingTries(submission.aiFeedback) + 1,
            }),
          },
        });
      }
    } finally {
      this.gradingNow.delete(id);
    }
  }

  private isClientAttemptConflict(error: unknown) {
    if (!error || typeof error !== 'object') return false;
    const candidate = error as { code?: string; meta?: { target?: unknown } };
    const target = candidate.meta?.target;
    return (
      candidate.code === 'P2002' &&
      Array.isArray(target) &&
      target.includes('userId') &&
      target.includes('quizId') &&
      target.includes('clientAttemptId')
    );
  }

  private formatAssessmentResponse(
    submission: { id: number },
    evaluation: {
      score: number;
      feedback: string;
      suggestions: string[];
      detail?: PracticeWritingResult;
    },
    maxScore: number,
    taskType?: unknown,
    exercise?: Record<string, unknown>,
  ) {
    const detail = evaluation.detail;
    return {
      ...(exercise ? { exercise } : {}),
      submissionId: submission.id,
      status: 'COMPLETED',
      score: evaluation.score,
      maxScore: detail?.maxScore ?? maxScore,
      feedback: evaluation.feedback,
      suggestions: evaluation.suggestions,
      taskType: taskType ? String(taskType) : null,
      // Practice tasks: per-criterion scores and grounded corrections.
      ...(detail
        ? {
            rubricVersion: detail.rubricVersion,
            criteria: detail.criteria,
            strengths: detail.strengths,
            corrections: detail.corrections,
            wordCount: detail.wordCount,
            wordRange: detail.wordRange,
            keywords: detail.keywords,
            ...(detail.linking ? { linking: detail.linking } : {}),
            ...(detail.scene ? { scene: detail.scene } : {}),
            ...(detail.scoreAdjustment
              ? { scoreAdjustment: detail.scoreAdjustment }
              : {}),
          }
        : {}),
    };
  }

  private async assertWritingAccess(
    quiz: {
      id: number;
      type: QuizType;
      isPremiumContent: boolean;
    },
    userId?: number,
    role?: import('@prisma/client').Role,
  ) {
    if (this.quizContentAccess) {
      await this.quizContentAccess.assertAccess(quiz, userId, role);
    }
  }

  private async assertExamInternalWritingAccess(
    quizId: number,
    userId: number | undefined,
    context?: { attemptId: number; componentId: number },
  ) {
    const links = await this.prisma.toeicWritingSetItem.findMany({
      where: { writingQuizId: quizId },
      select: {
        writingSetId: true,
        writingSet: {
          select: {
            assessmentComponents: {
              select: { id: true, assessmentId: true },
            },
          },
        },
      },
    });
    const internalSetIds = links
      .filter((link) => link.writingSet.assessmentComponents.length > 0)
      .map((link) => link.writingSetId);
    if (!internalSetIds.length) return;
    if (!userId || !context) {
      throw new NotFoundException('Writing task không tồn tại');
    }
    const authorized =
      await this.prisma.toeicAssessmentAttemptComponent.findFirst({
        where: {
          assessmentAttemptId: context.attemptId,
          assessmentComponentId: context.componentId,
          status: 'IN_PROGRESS',
          assessmentAttempt: { userId },
          assessmentComponent: { writingSetId: { in: internalSetIds } },
        },
        select: { id: true },
      });
    if (!authorized)
      throw new ForbiddenException(
        'Cần mở Writing từ lượt làm bài TOEIC hợp lệ',
      );
  }

  private async resolveWritingAccess(
    quizzes: Array<{
      id: number;
      type: QuizType;
      isPremiumContent: boolean;
      /** Carries the authored CEFR tag the access policy reads. */
      title?: string;
    }>,
    userId?: number,
    role?: import('@prisma/client').Role,
  ) {
    if (this.quizContentAccess) {
      return this.quizContentAccess.resolveMany(quizzes, userId, role);
    }
    return new Map(
      quizzes.map((quiz) => [
        quiz.id,
        {
          isPremiumContent: quiz.isPremiumContent,
          isLocked: false,
          requiredPlan: 'FREE',
        },
      ]),
    );
  }

  async getTopics(userId?: number, role?: import('@prisma/client').Role) {
    const categories = await this.prisma.practiceTopic.findMany({
      where: {
        category: {
          in: [TopicCategory.WRITING_PART1, TopicCategory.WRITING_PART2],
        },
      },
      include: {
        _count: {
          select: { quizzes: true },
        },
      },
    });

    const quizzes = await this.prisma.quiz.findMany({
      where: {
        type: { in: GENERAL_WRITING_TYPES },
        publicationStatus: QuizPublicationStatus.PUBLISHED,
        practiceTopic: {
          category: {
            in: [TopicCategory.WRITING_PART1, TopicCategory.WRITING_PART2],
          },
        },
      },
      include: {
        questions: {
          select: { content: true },
          orderBy: { order: 'asc' },
          take: 1,
        },
        practiceTopic: true,
      },
      orderBy: { id: 'desc' },
    });

    const quizIds = quizzes.map((q) => q.id);
    const [allQuestions, gradedResults] = userId
      ? await Promise.all([
          this.prisma.question.findMany({
            where: { quizId: { in: quizIds } },
            select: { id: true, quizId: true },
          }),
          this.prisma.result.findMany({
            where: {
              score: { not: null },
              submission: { userId, quizId: { in: quizIds } },
            },
            select: { questionId: true },
          }),
        ])
      : [[], []];

    const completedQuizIds = completedWritingQuizIds(
      allQuestions,
      gradedResults.map((r) => r.questionId),
    );
    const statuses = writingCompletionStatuses(
      allQuestions,
      gradedResults.map((r) => r.questionId),
    );

    const accessByQuiz = await this.resolveWritingAccess(quizzes, userId, role);

    // "Viết câu theo tranh": every task's picture and cue words, so the
    // catalog can show one card per picture. Not answers: the sample and the
    // scene description stay on the server.
    const pictureQuizIds = quizzes
      .filter(
        (q) =>
          (q.questions[0]?.content as { taskType?: unknown } | null)
            ?.taskType === PICTURE_SENTENCE,
      )
      .map((q) => q.id);
    const graded = new Set(gradedResults.map((r) => r.questionId));
    const pictureTasksByQuiz = new Map<
      number,
      Array<{
        questionId: number;
        position: number;
        imageUrl: string | null;
        keywords: string[];
        isGraded: boolean;
      }>
    >();
    if (pictureQuizIds.length) {
      const rows = await this.prisma.question.findMany({
        where: { quizId: { in: pictureQuizIds } },
        select: { id: true, quizId: true, content: true },
        orderBy: [{ order: 'asc' }, { id: 'asc' }],
      });
      for (const row of rows) {
        const c = (row.content ?? {}) as Record<string, unknown>;
        const list = pictureTasksByQuiz.get(row.quizId) ?? [];
        list.push({
          questionId: row.id,
          position: list.length + 1,
          imageUrl: typeof c.imageUrl === 'string' ? c.imageUrl : null,
          keywords: keywordsOf(c),
          isGraded: graded.has(row.id),
        });
        pictureTasksByQuiz.set(row.quizId, list);
      }
    }

    return {
      categories,
      quizzes: quizzes.map((q) => {
        const question = q.questions[0];
        const content = (question?.content ?? {}) as any;
        const access = accessByQuiz.get(q.id) ?? {
          isPremiumContent: Boolean(q.isPremiumContent),
          isLocked: false,
          requiredPlan: 'FREE',
        };
        const safeMetadata = {
          id: q.id,
          title: q.title,
          description: q.description,
          type: q.type,
          topicId: q.practiceTopicId,
          topicName: q.practiceTopic?.name,
          level: content.level,
          taskType: content.taskType,
          isCompleted: completedQuizIds.has(q.id),
          completionStatus: statuses.get(q.id) ?? 'NOT_STARTED',
          ...(pictureTasksByQuiz.has(q.id)
            ? { pictureTasks: pictureTasksByQuiz.get(q.id) }
            : {}),
          isPremiumContent: access.isPremiumContent,
          isLocked: access.isLocked,
          ...levelFields(access),
          requiredPlan: access.requiredPlan ?? 'FREE',
          cefrLevel: 'cefrLevel' in access ? access.cefrLevel : null,
        };
        if (access.isLocked) return safeMetadata;
        return {
          ...safeMetadata,
          level: content.level,
          taskType: content.taskType,
          prompt: content.prompt,
          imageUrl: content.imageUrl ?? null,
          keywords: Array.isArray(content.keywords)
            ? content.keywords
            : Array.isArray(content.requiredKeywords)
              ? content.requiredKeywords
              : [],
          wordRange: Array.isArray(content.wordRange)
            ? content.wordRange
            : null,
        };
      }),
    };
  }

  async getQuizDetails(
    quizId: number,
    userId?: number,
    role?: import('@prisma/client').Role,
    context?: { attemptId: number; componentId: number },
  ) {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id: quizId },
      include: {
        practiceTopic: true,
        toeicWritingSetItems: { select: { id: true }, take: 1 },
        questions: {
          select: { id: true, content: true },
          orderBy: [{ order: 'asc' }, { id: 'asc' }],
        },
      },
    });

    if (
      !quiz ||
      !isWritingQuiz(quiz) ||
      (quiz.publicationStatus !== undefined &&
        quiz.publicationStatus !== QuizPublicationStatus.PUBLISHED) ||
      quiz.questions.length === 0
    ) {
      throw new NotFoundException('Không tìm thấy bài tập.');
    }

    await this.assertWritingAccess(quiz, userId, role);
    if (role !== 'ADMIN')
      await this.assertExamInternalWritingAccess(quizId, userId, context);

    const question = quiz.questions[0];
    const content = question.content as any;
    const isEssayTask = [
      'PROPOSAL',
      'OPINION',
      'ESSAY',
      'OPINION_ESSAY',
    ].includes(content.taskType);

    // Every task of a catalog exercise, with the learner's latest grade.
    let exercise: Record<string, unknown> | undefined;
    if (quiz.practiceTopic) {
      const questionIds = quiz.questions.map((q) => q.id);
      const progress = userId
        ? await loadWritingExerciseProgress(
            this.prisma,
            userId,
            quizId,
            questionIds,
          )
        : null;
      exercise = {
        ...(progress?.summary ?? {
          total: questionIds.length,
          answered: 0,
          complete: false,
          percent: null,
          nextQuestionId: questionIds[0] ?? null,
        }),
        questions: quiz.questions.map((q, index) => {
          const c = q.content as any;
          const latest = progress?.latest.get(q.id);
          const rubric = practiceRubric(c);
          const translation = translationTaskOf(c);
          return {
            id: q.id,
            position: index + 1,
            taskType: c?.taskType ?? null,
            prompt: c?.prompt ?? null,
            imageUrl: c?.imageUrl ?? null,
            keywords: keywordsOf(c),
            requirements: Array.isArray(c?.requirements) ? c.requirements : [],
            wordRange: Array.isArray(c?.wordRange) ? c.wordRange : null,
            maxScore: translation
              ? SENTENCE_TRANSLATION_MAX_SCORE
              : rubric
                ? rubric.reduce((n, r) => n + r.max, 0)
                : null,
            // Translation: word help and the tip; never the accepted answers.
            ...(translation
              ? { hints: translation.hints, grammarTip: translation.grammarTip }
              : {}),
            latest: latest
              ? {
                  submissionId: latest.submissionId,
                  score: latest.score,
                  maxScore: latest.maxScore,
                }
              : null,
          };
        }),
      };
    }

    return {
      ...(exercise ? { exercise } : {}),
      quizId: quiz.id,
      title: quiz.title,
      description: quiz.description,
      type: quiz.type,
      topicName: quiz.practiceTopic?.name ?? '',
      level: content.level,
      cefrLevel: this.quizContentAccess
        ? cefrSpan(this.quizContentAccess.cefrRange(quiz))
        : null,
      taskType: content.taskType,
      prompt: content.prompt,
      imageUrl: content.imageUrl,
      keywords: Array.isArray(content.keywords)
        ? content.keywords
        : Array.isArray(content.requiredKeywords)
          ? content.requiredKeywords
          : [],
      sampleSentences: content.sampleSentences,
      email: typeof content.email === 'string' ? content.email : null,
      wordRange: Array.isArray(content.wordRange) ? content.wordRange : null,
      maxScore: translationTaskOf(content)
        ? SENTENCE_TRANSLATION_MAX_SCORE
        : quiz.type === QuizType.WRITING_PICTURE
          ? 3
          : isEssayTask
            ? 5
            : 4,
    };
  }

  /** The caller's own submissions for one exercise; never other learners'. */
  async getCommunitySubmissions(
    quizId: number,
    userId: number,
    role?: import('@prisma/client').Role,
  ) {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id: quizId },
      select: {
        id: true,
        type: true,
        publicationStatus: true,
        isPremiumContent: true,
        practiceTopic: { select: { category: true } },
      },
    });
    if (
      !quiz ||
      !isWritingQuiz(quiz) ||
      (quiz.publicationStatus !== undefined &&
        quiz.publicationStatus !== QuizPublicationStatus.PUBLISHED)
    ) {
      throw new NotFoundException('Không tìm thấy bài tập.');
    }
    await this.assertWritingAccess(quiz, userId, role);
    const submissions = await this.prisma.submission.findMany({
      where: { quizId, userId },
      include: { results: true },
      orderBy: { submittedAt: 'desc' },
    });

    return submissions.map((sub) => ({
      id: sub.id,
      score: sub.score,
      answer: sub.results[0]?.answer,
      feedback: sub.aiFeedback,
      submittedAt: sub.submittedAt,
    }));
  }

  /** Calls the provider and validates the grade. Stores nothing. */
  private async gradeAnswer(
    quiz: {
      type: QuizType;
      title: string;
      description?: string | null;
    },
    content: any,
    answer: string,
    practiceTask: ReturnType<typeof practiceWritingTask> | null,
    previousAttempt?: ReturnType<typeof revisionGraderInput>,
  ) {
    let evaluation: {
      score: number;
      maxScore: number;
      feedback: string;
      suggestions: string[];
    };
    let detail: PracticeWritingResult | undefined;
    try {
      if (practiceTask) {
        const request = buildPracticeWritingRequest(
          practiceTask,
          answer,
          previousAttempt,
        );
        let reason = 'NO_ATTEMPT';
        for (
          let attempt = 1;
          attempt <= PRACTICE_GRADE_ATTEMPTS && !detail;
          attempt += 1
        ) {
          const out = await this.aiService.generateStructuredJson({
            systemInstruction: request.systemInstruction,
            prompt: request.prompt,
            responseSchema: request.responseSchema,
            temperature: 0.2,
            timeoutMs: PRACTICE_GRADE_TIMEOUT_MS,
            failoverOnTimeout: false,
          });
          let parsed: unknown;
          try {
            parsed = JSON.parse(out.text);
          } catch {
            reason = 'INVALID_JSON';
            continue;
          }
          const verdict = validatePracticeWritingResult(
            parsed,
            practiceTask,
            answer,
            request.facts,
          );
          if (verdict.ok) detail = verdict.value;
          else reason = verdict.reason;
        }
        if (!detail)
          throw new Error(`PRACTICE_WRITING_GRADE_INVALID: ${reason}`);
        evaluation = {
          score: detail.score,
          maxScore: detail.maxScore,
          feedback: detail.feedback,
          suggestions: detail.suggestions,
        };
      } else if (quiz.type === QuizType.WRITING_PICTURE) {
        const result = content.imageUrl
          ? await this.aiService.evaluateWritingPart1(
              content.imageUrl,
              Array.isArray(content.keywords)
                ? content.keywords
                : Array.isArray(content.requiredKeywords)
                  ? content.requiredKeywords
                  : [],
              answer,
            )
          : await this.aiService.evaluateWritingPart2(
              content.prompt ?? quiz.description ?? quiz.title,
              answer,
            );
        evaluation = {
          score: result.score,
          maxScore: content.imageUrl ? 3 : 4,
          feedback: result.feedback,
          suggestions:
            'suggestions' in result && Array.isArray(result.suggestions)
              ? result.suggestions.map(String)
              : [],
        };
      } else if (
        ['PROPOSAL', 'OPINION', 'ESSAY', 'OPINION_ESSAY'].includes(
          content.taskType,
        )
      ) {
        const result = await this.aiService.evaluateWritingPart3(
          content.prompt ?? quiz.description ?? quiz.title,
          answer,
        );
        evaluation = { ...result, maxScore: 5 };
      } else {
        // A written request is graded against the e-mail it answers.
        const instructions = content.prompt ?? quiz.description ?? quiz.title;
        const result = await this.aiService.evaluateWritingPart2(
          content.email
            ? `${content.email}

Task: ${instructions}`
            : instructions,
          answer,
        );
        evaluation = { ...result, maxScore: 4 };
      }
    } catch (error) {
      throw new ServiceUnavailableException(
        'Dịch vụ chấm bài hiện không khả dụng. Bài viết của bạn chưa được lưu điểm; vui lòng thử lại sau.',
        { cause: error as Error },
      );
    }

    // Unaccented Vietnamese feedback is unreadable; refuse it like any other
    // unusable grade (the learner can submit again; nothing is stored).
    if (!hasVietnameseDiacritics(evaluation.feedback))
      throw new ServiceUnavailableException(
        'Dịch vụ chấm bài trả về nhận xét không hợp lệ. Bài viết chưa được lưu điểm; vui lòng thử lại.',
      );
    const validatedEvaluation = this.validateEvaluation(
      evaluation,
      evaluation.maxScore,
    );
    return { evaluation, validatedEvaluation, detail };
  }

  async submitWriting(
    quizId: number,
    userId: number,
    text: string,
    role?: import('@prisma/client').Role,
    clientAttemptId?: string,
    context?: { attemptId: number; componentId: number },
    questionId?: number,
  ) {
    const answer = text?.trim();
    if (!answer) throw new BadRequestException('Bài viết không được để trống');
    if (answer.length > 20000)
      throw new BadRequestException('Bài viết vượt quá giới hạn cho phép');

    const quiz = await this.prisma.quiz.findUnique({
      where: { id: quizId },
      include: {
        practiceTopic: true,
        toeicWritingSetItems: { select: { id: true }, take: 1 },
        questions: {
          select: { id: true, content: true },
          orderBy: [{ order: 'asc' }, { id: 'asc' }],
        },
      },
    });
    if (
      !quiz ||
      !isWritingQuiz(quiz) ||
      (quiz.publicationStatus !== undefined &&
        quiz.publicationStatus !== QuizPublicationStatus.PUBLISHED) ||
      quiz.questions.length === 0
    )
      throw new NotFoundException('Không tìm thấy bài tập.');

    await this.assertWritingAccess(quiz, userId, role);
    if (role !== 'ADMIN')
      await this.assertExamInternalWritingAccess(quizId, userId, context);

    // Catalog exercises hold several independent tasks, answered one at a
    // time; TOEIC exam Writing quizzes keep their single task.
    const isExercise = Boolean(quiz.practiceTopic);
    const question =
      questionId === undefined
        ? quiz.questions[0]
        : quiz.questions.find((item) => item.id === questionId);
    if (!question || (!isExercise && question !== quiz.questions[0]))
      throw new BadRequestException('Câu hỏi không thuộc bài luyện viết này');
    const content = question.content as any;
    // A translation sentence is checked on its own endpoint, never by the
    // writing grader.
    if (translationTaskOf(content))
      throw new BadRequestException(
        'Câu dịch được kiểm tra từng câu, không nộp như bài viết.',
      );
    const exercise = isExercise
      ? {
          questionIds: quiz.questions.map((item) => item.id),
          position: quiz.questions.indexOf(question) + 1,
        }
      : undefined;
    const exerciseState = async () =>
      exercise
        ? {
            questionId: question.id,
            position: exercise.position,
            ...(
              await loadWritingExerciseProgress(
                this.prisma,
                userId,
                quizId,
                exercise.questionIds,
              )
            ).summary,
          }
        : undefined;
    const logicalAttemptId = clientAttemptId ?? randomUUID();
    const existing = await this.getIdempotentSubmission(
      userId,
      quizId,
      logicalAttemptId,
    );
    if (existing) {
      const existingMaxScore = [
        'PROPOSAL',
        'OPINION',
        'ESSAY',
        'OPINION_ESSAY',
        'ANALYTICAL_RESPONSE',
        'ARGUMENT',
      ].includes(String(content.taskType))
        ? 5
        : quiz.type === QuizType.WRITING_PICTURE && content.imageUrl
          ? 3
          : 4;
      const existingEvaluation = this.parsePersistedEvaluation(
        existing.aiFeedback,
        existingMaxScore,
      );
      if (!existingEvaluation) {
        throw new ConflictException(
          'Lần nộp bài này đang được xử lý hoặc không hợp lệ',
        );
      }
      return this.formatAssessmentResponse(
        existing,
        existingEvaluation,
        existingMaxScore,
        content.taskType,
        await exerciseState(),
      );
    }

    // Catalog practice tasks are graded with their own authored rubric; TOEIC
    // exam writing tasks (no practice topic) keep their exam graders.
    const practiceTask = quiz.practiceTopic
      ? practiceWritingTask(content ?? {}, quiz.title)
      : null;
    if (exceedsPictureWordLimit(practiceTask, answer)) {
      throw new BadRequestException(
        `Câu trả lời cho bài viết theo tranh tối đa ${PICTURE_SENTENCE_MAX_WORDS} từ.`,
      );
    }

    // A free PLUS trial grades at most 3 paid-level Writing answers.
    const trialCounted =
      !context && (this.quizContentAccess?.isPremium(quiz) ?? false);
    if (trialCounted) await this.trial?.assertGradingLeft(userId, 'WRITING');

    const { evaluation, validatedEvaluation, detail } = await this.gradeAnswer(
      quiz,
      content,
      answer,
      practiceTask,
    );
    if (trialCounted) await this.trial?.recordGrading(userId, 'WRITING');
    const submission = await this.persistAssessment({
      detail,
      exercise,
      quizId,
      quizTitle: quiz.title,
      quizType: quiz.type,
      questionId: question.id,
      userId,
      answer,
      clientAttemptId: logicalAttemptId,
      evaluation: validatedEvaluation,
      maxScore: evaluation.maxScore,
    });
    return this.formatAssessmentResponse(
      submission,
      { ...validatedEvaluation, detail },
      evaluation.maxScore,
      content.taskType,
      await exerciseState(),
    );
  }

  /**
   * "Dịch câu" (owner 2026-11-14): checks one translated sentence. An answer
   * that matches an accepted translation (after normalisation, or with one
   * typo in a longer word) is right without the AI and costs no grading. Any
   * other answer takes one AI grading from the learner's daily allowance; with
   * none left it is compared with the answers only (UNMATCHED, 0 points). The
   * grade is stored like a picture task, so progress, completion and the
   * exercise reward work the same way.
   */
  async checkTranslation(
    quizId: number,
    questionId: number,
    userId: number,
    text: string,
    role?: import('@prisma/client').Role,
    clientAttemptId?: string,
  ) {
    const answer = text?.trim();
    if (!answer) throw new BadRequestException('Câu dịch không được để trống');
    if (answer.length > SENTENCE_TRANSLATION_MAX_CHARS)
      throw new BadRequestException('Câu dịch quá dài cho một câu.');

    const quiz = await this.prisma.quiz.findUnique({
      where: { id: quizId },
      include: {
        practiceTopic: true,
        toeicWritingSetItems: { select: { id: true }, take: 1 },
        questions: {
          select: { id: true, content: true },
          orderBy: [{ order: 'asc' }, { id: 'asc' }],
        },
      },
    });
    if (
      !quiz ||
      !isWritingQuiz(quiz) ||
      !quiz.practiceTopic ||
      (quiz.publicationStatus !== undefined &&
        quiz.publicationStatus !== QuizPublicationStatus.PUBLISHED)
    )
      throw new NotFoundException('Không tìm thấy bài tập.');
    await this.assertWritingAccess(quiz, userId, role);

    const question = quiz.questions.find((item) => item.id === questionId);
    const task = question ? translationTaskOf(question.content) : null;
    if (!question || !task)
      throw new BadRequestException('Câu này không thuộc bài dịch câu.');
    const exercise = {
      questionIds: quiz.questions.map((item) => item.id),
      position: quiz.questions.indexOf(question) + 1,
    };
    const exerciseState = async () => ({
      questionId: question.id,
      position: exercise.position,
      ...(
        await loadWritingExerciseProgress(
          this.prisma,
          userId,
          quizId,
          exercise.questionIds,
        )
      ).summary,
    });

    const logicalAttemptId = clientAttemptId ?? randomUUID();
    const existing = await this.getIdempotentSubmission(
      userId,
      quizId,
      logicalAttemptId,
    );
    if (existing) {
      let stored: { translation?: TranslationCheck } = {};
      try {
        stored = JSON.parse(existing.aiFeedback ?? '{}');
      } catch {
        stored = {};
      }
      if (!stored.translation)
        throw new ConflictException(
          'Lần kiểm tra này đang được xử lý hoặc không hợp lệ',
        );
      return {
        ...stored.translation,
        submissionId: existing.id,
        exercise: await exerciseState(),
      };
    }

    const check = await this.gradeTranslation(task, answer, userId, role);

    const submission = await this.persistAssessment({
      exercise,
      quizId,
      quizTitle: quiz.title,
      quizType: quiz.type,
      questionId: question.id,
      userId,
      answer,
      clientAttemptId: logicalAttemptId,
      evaluation: {
        score: check.score,
        feedback: check.explanation ?? translationVerdictLabel(check.verdict),
        suggestions: [],
      },
      maxScore: SENTENCE_TRANSLATION_MAX_SCORE,
      extra: { rubricVersion: SENTENCE_TRANSLATION_RUBRIC, translation: check },
    });
    return {
      ...check,
      submissionId: submission.id,
      exercise: await exerciseState(),
    };
  }

  /**
   * The grade of one translated sentence, stored nowhere: an accepted answer
   * (or a typo of one) is right without the AI; any other answer takes one AI
   * grading, or with none left is only compared with the answers (UNMATCHED).
   * When the AI fails the grading is given back and a 503 is thrown.
   */
  private async gradeTranslation(
    task: SentenceTranslationTask,
    answer: string,
    userId: number,
    role?: import('@prisma/client').Role,
  ): Promise<TranslationCheck> {
    const match = matchTranslation(answer, task.acceptedAnswers);
    if (match.kind !== 'NONE')
      return translationResult(task, answer, {
        verdict: 'CORRECT',
        source: 'MATCH',
        closest: match.matched,
        typo:
          match.kind === 'TYPO'
            ? { typed: match.typed, expected: match.expected }
            : null,
      });
    const grading = await this.takeTranslationGrading(userId, role);
    if (!grading.allowed)
      return translationResult(task, answer, {
        verdict: 'UNMATCHED',
        source: 'NO_AI',
        closest: closestAnswer(answer, task.acceptedAnswers),
        quotaExhausted: true,
      });
    let grade: TranslationGrade | null = null;
    try {
      grade = await this.gradeTranslationWithAi(task, answer);
    } finally {
      if (!grade && grading.key && this.redis)
        await returnAiGrading(this.redis, grading.key);
    }
    if (!grade)
      throw new ServiceUnavailableException(
        'Chưa chấm được câu này, hãy thử lại.',
      );
    return translationResult(task, answer, {
      verdict: grade.verdict,
      source: 'AI',
      closest: closestAnswer(answer, task.acceptedAnswers),
      grade,
    });
  }

  /**
   * A "Dịch câu" mistake answered again in the notebook (owner 2026-11-14):
   * graded like the exercise, nothing stored as a submission (so exercise
   * progress and rewards do not move); only the notebook streak changes.
   */
  async reviewTranslationMistake(
    userId: number,
    mistakeId: number,
    text: string,
    role?: import('@prisma/client').Role,
  ) {
    if (!this.mistakes)
      throw new ServiceUnavailableException('Sổ lỗi chưa sẵn sàng.');
    const answer = text?.trim();
    if (!answer) throw new BadRequestException('Câu dịch không được để trống');
    if (answer.length > SENTENCE_TRANSLATION_MAX_CHARS)
      throw new BadRequestException('Câu dịch quá dài cho một câu.');
    const target = await this.mistakes.translationReviewTarget(
      userId,
      mistakeId,
    );
    const question = await this.prisma.question.findFirst({
      where: { id: target.questionId, quizId: target.quizId },
      select: { content: true },
    });
    const task = question ? translationTaskOf(question.content) : null;
    if (!task) throw new NotFoundException('Câu dịch này không còn nữa.');
    const check = await this.gradeTranslation(task, answer, userId, role);
    const outcome = await this.mistakes.recordTranslationReview(
      userId,
      mistakeId,
      check.verdict === 'CORRECT',
    );
    return { ...outcome, check };
  }

  /** One AI grading for a translation; admins are never counted. */
  private async takeTranslationGrading(
    userId: number,
    role?: import('@prisma/client').Role,
  ): Promise<{ allowed: boolean; key: string | null }> {
    if (role === 'ADMIN') return { allowed: true, key: null };
    // Without Redis the allowance cannot be counted: no AI, answers only.
    if (!this.redis) return { allowed: false, key: null };
    const planCode = (await this.subscriptions?.planCodeFor(userId)) ?? 'FREE';
    const taken = await takeAiGrading(this.redis, userId, planCode);
    if (!taken.allowed) {
      // Not used: the count stays at what the learner really used.
      await returnAiGrading(this.redis, taken.key);
      return { allowed: false, key: null };
    }
    return { allowed: true, key: taken.key };
  }

  /** The AI's grade, or null when every try failed or was unusable. */
  private async gradeTranslationWithAi(
    task: SentenceTranslationTask,
    answer: string,
  ): Promise<TranslationGrade | null> {
    const request = buildTranslationGradeRequest(task, answer);
    for (let attempt = 1; attempt <= PRACTICE_GRADE_ATTEMPTS; attempt += 1) {
      try {
        const out = await this.aiService.generateStructuredJson({
          ...request,
          temperature: 0.1,
          timeoutMs: TRANSLATION_GRADE_TIMEOUT_MS,
          failoverOnTimeout: false,
        });
        const verdict = validateTranslationGrade(JSON.parse(out.text), answer);
        if (verdict.ok) return verdict.value;
        this.logger.warn(`Translation grade rejected: ${verdict.reason}`);
      } catch (error) {
        this.logger.warn(
          `Translation grade failed: ${(error as Error)?.message ?? error}`,
        );
      }
    }
    return null;
  }

  /**
   * Guided rewrite: grades a corrected text for a practice answer the learner
   * already has a grade for. As many per first submission as the learner's
   * plan allows (plan-limits.ts); none on Free. The grade is stored as a new submission that points at the
   * first one; it earns no reward and emits no quiz event.
   */
  async reviseWriting(
    submissionId: number,
    userId: number,
    text: string,
    role?: import('@prisma/client').Role,
    clientAttemptId?: string,
  ) {
    const answer = text?.trim();
    if (!answer) throw new BadRequestException('Bài viết không được để trống');
    if (answer.length > 20000)
      throw new BadRequestException('Bài viết vượt quá giới hạn cho phép');

    const source = await this.prisma.submission.findFirst({
      where: { id: submissionId, userId },
      select: {
        id: true,
        quizId: true,
        revisionOfId: true,
        results: {
          select: { questionId: true },
          orderBy: { id: 'asc' },
          take: 1,
        },
        quiz: {
          include: {
            practiceTopic: true,
            questions: {
              select: { id: true, content: true },
              orderBy: [{ order: 'asc' }, { id: 'asc' }],
            },
          },
        },
      },
    });
    const quiz = source?.quiz;
    if (
      !source ||
      !quiz ||
      !quiz.practiceTopic ||
      !isWritingQuiz(quiz) ||
      quiz.publicationStatus !== QuizPublicationStatus.PUBLISHED
    )
      throw new NotFoundException('Không tìm thấy bài nộp.');
    await this.assertWritingAccess(quiz, userId, role);

    const question = quiz.questions.find(
      (item) => item.id === source.results[0]?.questionId,
    );
    const content = (question?.content ?? {}) as Record<string, unknown>;
    const practiceTask = question
      ? practiceWritingTask(content, quiz.title)
      : null;
    const rootId = source.revisionOfId ?? source.id;
    const chain = await loadRevisionChain(this.prisma, rootId);
    if (
      !question ||
      !practiceTask ||
      !chain.some((attempt) => attempt.submissionId === source.id)
    )
      throw new BadRequestException(
        'Bài viết này không hỗ trợ sửa và nộp lại.',
      );
    if (exceedsPictureWordLimit(practiceTask, answer))
      throw new BadRequestException(
        `Câu trả lời cho bài viết theo tranh tối đa ${PICTURE_SENTENCE_MAX_WORDS} từ.`,
      );

    // The plan decides how many revisions an answer gets: none on Free.
    const plan = await this.revisionPlan(userId, role);
    const revisionLimit = planLimits(plan).writingRevisions;
    const limitReached = () =>
      revisionLimit === 0
        ? new ForbiddenException({
            message: revisionLimitMessage(plan),
            requiredPlan: 'PLUS',
          })
        : new ConflictException(revisionLimitMessage(plan));

    const respond = (
      stored: { id: number },
      evaluation: Parameters<WritingService['formatAssessmentResponse']>[1],
      maxScore: number,
      attempts: RevisionAttempt[],
    ) => ({
      ...this.formatAssessmentResponse(
        stored,
        evaluation,
        maxScore,
        content.taskType,
      ),
      revision: revisionView(attempts, stored.id, revisionLimit),
    });

    const logicalAttemptId = clientAttemptId ?? randomUUID();
    const existing = await this.getIdempotentSubmission(
      userId,
      source.quizId,
      logicalAttemptId,
    );
    if (existing) {
      const previous = this.parsePersistedEvaluation(existing.aiFeedback, 0);
      if (!previous || existing.revisionOfId !== rootId)
        throw new ConflictException(
          'Lần nộp bài này đang được xử lý hoặc không hợp lệ',
        );
      return respond(existing, previous, 0, chain);
    }

    const gate = revisionGate(chain, answer, revisionLimit);
    if (!gate.ok && gate.reason === 'LIMIT') throw limitReached();
    if (!gate.ok)
      throw new BadRequestException('Hãy sửa bài viết trước khi nộp lại.');

    // A free PLUS trial grades at most 3 paid-level Writing answers; a
    // revision is one more graded answer.
    const trialCounted = this.quizContentAccess?.isPremium(quiz) ?? false;
    if (trialCounted) await this.trial?.assertGradingLeft(userId, 'WRITING');

    const previousAttempt = chain[chain.length - 1];
    const { evaluation, validatedEvaluation, detail } = await this.gradeAnswer(
      quiz,
      content,
      answer,
      practiceTask,
      revisionGraderInput(previousAttempt),
    );
    if (trialCounted) await this.trial?.recordGrading(userId, 'WRITING');

    const feedback = JSON.stringify({
      ...(detail ?? {}),
      feedback: validatedEvaluation.feedback,
      suggestions: validatedEvaluation.suggestions,
      maxScore: evaluation.maxScore,
      score: validatedEvaluation.score,
      skill: 'WRITING',
    });
    let created: { id: number };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        // Two requests at once must not both take the last revision.
        await tx.$queryRaw`SELECT id FROM "Submission" WHERE id = ${rootId} FOR UPDATE`;
        const used = await tx.submission.count({
          where: { revisionOfId: rootId },
        });
        if (used >= revisionLimit) throw limitReached();
        const row = await tx.submission.create({
          data: {
            quizId: source.quizId,
            userId,
            clientAttemptId: logicalAttemptId,
            revisionOfId: rootId,
            score: validatedEvaluation.score,
            aiFeedback: feedback,
            results: {
              create: [
                {
                  questionId: question.id,
                  answer,
                  score: validatedEvaluation.score,
                },
              ],
            },
          },
          select: { id: true },
        });
        await tx.learningActivity.create({
          data: {
            userId,
            type: 'WRITING_PRACTICE_COMPLETED',
            title: `${quiz.title} — bản sửa ${used + 1}`,
            detail: `${validatedEvaluation.score}/${evaluation.maxScore} điểm`,
            score: Math.round(
              (validatedEvaluation.score / evaluation.maxScore) * 100,
            ),
            sourceType: 'WRITING_SUBMISSION',
            sourceId: String(row.id),
          },
        });
        return row;
      });
    } catch (error) {
      if (!this.isClientAttemptConflict(error)) throw error;
      const stored = await this.getIdempotentSubmission(
        userId,
        source.quizId,
        logicalAttemptId,
      );
      if (!stored || stored.revisionOfId !== rootId) throw error;
      created = stored;
    }
    return respond(
      created,
      { ...validatedEvaluation, detail },
      evaluation.maxScore,
      await loadRevisionChain(this.prisma, rootId),
    );
  }

  async submitWritingPart2(
    quizId: number,
    userId: number,
    userResponse: string,
    role?: import('@prisma/client').Role,
    clientAttemptId?: string,
    context?: { attemptId: number; componentId: number },
  ) {
    return this.submitCanonicalWritingAssessment(
      quizId,
      userId,
      userResponse,
      role,
      clientAttemptId,
      'PART2',
      context,
    );
  }

  async submitWritingPart3(
    quizId: number,
    userId: number,
    userEssay: string,
    role?: import('@prisma/client').Role,
    clientAttemptId?: string,
    context?: { attemptId: number; componentId: number },
  ) {
    return this.submitCanonicalWritingAssessment(
      quizId,
      userId,
      userEssay,
      role,
      clientAttemptId,
      'PART3',
      context,
    );
  }

  private async submitCanonicalWritingAssessment(
    quizId: number,
    userId: number,
    answerText: string,
    role: import('@prisma/client').Role | undefined,
    clientAttemptId: string | undefined,
    expectedPart: 'PART2' | 'PART3',
    context?: { attemptId: number; componentId: number },
  ) {
    const answer = answerText?.trim();
    if (!answer) throw new BadRequestException('Bài viết không được để trống');
    if (answer.length > 20000) {
      throw new BadRequestException('Bài viết vượt quá giới hạn cho phép');
    }
    const task = await this.resolveCanonicalTask(
      quizId,
      userId,
      role,
      expectedPart,
      context,
    );
    const logicalAttemptId = clientAttemptId ?? randomUUID();
    const existing = await this.getIdempotentSubmission(
      userId,
      quizId,
      logicalAttemptId,
    );
    if (existing) {
      const previous = this.parsePersistedEvaluation(
        existing.aiFeedback,
        task.maxScore,
      );
      if (!previous) {
        throw new ConflictException(
          'Lần nộp bài này đang được xử lý hoặc không hợp lệ',
        );
      }
      return this.formatAssessmentResponse(
        existing,
        previous,
        task.maxScore,
        task.content.taskType,
      );
    }

    let evaluation: { score: number; feedback: string; suggestions: string[] };
    try {
      const raw = task.isPart3
        ? await this.aiService.evaluateWritingPart3(task.prompt, answer)
        : await this.aiService.evaluateWritingPart2(task.prompt, answer);
      evaluation = this.validateEvaluation(raw, task.maxScore);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException(
        'Dịch vụ chấm bài hiện không khả dụng. Bài viết chưa được hoàn tất; hãy thử lại.',
        { cause: error as Error },
      );
    }

    const submission = await this.persistAssessment({
      quizId,
      quizTitle: task.quiz.title,
      quizType: task.quiz.type,
      questionId: task.question.id,
      userId,
      answer,
      clientAttemptId: logicalAttemptId,
      evaluation,
      maxScore: task.maxScore,
    });
    return this.formatAssessmentResponse(
      submission,
      evaluation,
      task.maxScore,
      task.content.taskType,
    );
  }
}
