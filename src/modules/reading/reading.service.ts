import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  QuizPublicationStatus,
  QuizType,
  Role,
  TopicCategory,
} from '@prisma/client';
import { QuizContentAccessService } from '../quiz/quiz-content-access.service';
import {
  resolveReadingCorrectOption,
  READING_MICRO_SKILLS,
} from '../quiz/reading-content.validation';

type ReadingQuestionContent = {
  passage?: unknown;
  content?: unknown;
  id?: number;
  type?: string;
};

const READING_TRACKING_SAMPLE_SIZE = 3;

export type ReadingSubskillMetric = {
  key: string;
  attempted: number;
  correct: number;
  accuracy: number;
  status: 'INSUFFICIENT_DATA' | 'NEEDS_IMPROVEMENT' | 'PROGRESSING' | 'GOOD';
  statusLabel: string;
};

export function readingMetricStatus(
  attempted: number,
  accuracy: number,
): ReadingSubskillMetric['status'] {
  if (attempted < READING_TRACKING_SAMPLE_SIZE) return 'INSUFFICIENT_DATA';
  if (accuracy < 50) return 'NEEDS_IMPROVEMENT';
  if (accuracy < 75) return 'PROGRESSING';
  return 'GOOD';
}

export function readingMetricStatusLabel(
  status: ReadingSubskillMetric['status'],
): string {
  switch (status) {
    case 'NEEDS_IMPROVEMENT':
      return 'Cần cải thiện';
    case 'PROGRESSING':
      return 'Đang tiến bộ';
    case 'GOOD':
      return 'Tốt';
    default:
      return 'Chưa đủ dữ liệu';
  }
}

function readContent(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function resolveReadingSubskill(value: unknown): string {
  const content = readContent(value);
  for (const key of ['skill', 'questionType', 'category']) {
    const candidate = content[key];
    if (typeof candidate === 'string' && candidate.trim()) {
      const normalized = candidate.trim().toUpperCase();
      if (normalized !== 'READING' && normalized !== 'BILINGUAL_READING') {
        return normalized;
      }
    }
  }
  return 'UNKNOWN';
}

function safeAnswer(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

function safeExplanation(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const parts = ['vi', 'evidence', 'keyPhrase', 'vocabularyNote']
    .map((key) => (typeof record[key] === 'string' ? record[key].trim() : ''))
    .filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : null;
}

function scorePercent(correct: number, total: number): number {
  return total > 0 ? Math.round((correct / total) * 100) : 0;
}

function normalizedText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function textFromCanonicalItem(value: unknown): string | null {
  if (typeof value === 'string') {
    const text = normalizedText(value);
    return text.length > 0 ? text : null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const key of ['en', 'text', 'sentence', 'passage']) {
    if (typeof record[key] === 'string') {
      const text = normalizedText(record[key]);
      if (text.length > 0) return text;
    }
  }
  return null;
}

/** Count deterministic sentence units without adding an NLP dependency. */
export function countReadingSentenceUnits(value: unknown): number {
  if (typeof value !== 'string') return 0;
  const text = normalizedText(value);
  if (!text) return 0;
  const units = text.match(/[^.!?]+(?:[.!?]+|$)/g);
  return units?.filter((unit) => unit.trim().length > 0).length ?? 0;
}

/**
 * Count sentences for a completed Reading quiz from canonical content first,
 * then from unique question passages. Malformed JSON is intentionally ignored.
 */
export function countReadingSentences(
  bilingualContent: unknown,
  questions: ReadingQuestionContent[],
): number {
  if (Array.isArray(bilingualContent)) {
    const canonicalTexts = new Set(
      bilingualContent
        .map(textFromCanonicalItem)
        .filter((text): text is string => Boolean(text)),
    );
    if (canonicalTexts.size > 0) {
      return [...canonicalTexts].reduce(
        (total, text) => total + countReadingSentenceUnits(text),
        0,
      );
    }
  }

  const passageTexts = new Set<string>();
  for (const question of questions) {
    const questionContent =
      question.content &&
      typeof question.content === 'object' &&
      !Array.isArray(question.content)
        ? (question.content as Record<string, unknown>)
        : question;
    if (typeof questionContent.passage === 'string') {
      const passage = normalizedText(questionContent.passage);
      if (passage) passageTexts.add(passage);
    }
  }
  return [...passageTexts].reduce(
    (total, passage) => total + countReadingSentenceUnits(passage),
    0,
  );
}

/** Require an exact, current question/result ID set for completion. */
export function isReadingSubmissionComplete(
  questionIds: number[],
  resultIds: number[],
): boolean {
  if (questionIds.length === 0 || resultIds.length !== questionIds.length) {
    return false;
  }
  const questions = new Set(questionIds);
  const results = new Set(resultIds);
  return (
    results.size === questionIds.length &&
    [...questions].every((questionId) => results.has(questionId))
  );
}

/** Resolves authoritative CEFR level for a reading practice topic. */
export function resolveReadingTopicLevel(
  name: string,
): 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED' {
  const upper = (name || '').toUpperCase();
  if (upper.includes('B1') || upper.includes('B2')) {
    return 'INTERMEDIATE';
  }
  if (upper.includes('C1') || upper.includes('C2')) {
    return 'ADVANCED';
  }
  return 'BEGINNER';
}

@Injectable()
export class ReadingService {
  constructor(
    private prisma: PrismaService,
    private readonly quizContentAccess: QuizContentAccessService,
  ) {}

  async getTopicsByCategory(
    category: TopicCategory,
    userId?: number,
    role?: Role,
  ) {
    const topics = await this.prisma.practiceTopic.findMany({
      where: { category },
      orderBy: { order: 'asc' },
      include: {
        quizzes: {
          select: {
            id: true,
            title: true,
            description: true,
            type: true,
            courseId: true,
            isPremiumContent: true,
            timeLimit: true,
            questions: { select: { id: true } },
            _count: { select: { questions: true } },
          },
        },
      },
    });

    const accessByQuiz = await this.quizContentAccess.resolveMany(
      topics.flatMap((topic) => topic.quizzes),
      userId,
      role,
    );

    const userResults = userId
      ? await this.prisma.submission.findMany({
          where: {
            userId,
            quiz: { practiceTopic: { category } },
          },
          orderBy: { submittedAt: 'desc' },
          select: {
            quizId: true,
            results: {
              select: { questionId: true, isCorrect: true },
            },
          },
        })
      : [];

    const latestByQuiz = new Map<
      number,
      { questionId: number; isCorrect: boolean | null }[]
    >();
    for (const submission of userResults) {
      if (!latestByQuiz.has(submission.quizId)) {
        latestByQuiz.set(submission.quizId, submission.results);
      }
    }

    return topics.map((topic) => {
      let totalQuestions = 0;
      let completedCount = 0;
      let correctCount = 0;
      let completedArticles = 0;

      topic.quizzes.forEach((quiz) => {
        const questionCount = quiz._count.questions;
        totalQuestions += questionCount;
        const questionIds = new Set(
          quiz.questions.map((question) => question.id),
        );
        const latestResults = (latestByQuiz.get(quiz.id) ?? []).filter(
          (result) => questionIds.has(result.questionId),
        );
        completedCount += latestResults.length;
        correctCount += latestResults.filter(
          (result) => result.isCorrect,
        ).length;
        if (latestResults.length === questionCount && questionCount > 0) {
          completedArticles++;
        }
      });

      return {
        id: topic.id,
        name: topic.name,
        vietnameseName: topic.vietnameseName,
        iconUrl: topic.iconUrl,
        level: resolveReadingTopicLevel(topic.name),
        totalQuestions,
        completedQuestions: completedCount,
        correctAnswers: correctCount,
        incorrectAnswers: completedCount - correctCount,
        completedArticles,
        totalArticles: topic.quizzes.length,
        quizzes: topic.quizzes.map((quiz) => {
          const access = accessByQuiz.get(quiz.id) ?? {
            isPremiumContent: quiz.isPremiumContent,
            isLocked: false,
          };
          return {
            id: quiz.id,
            title: quiz.title,
            description: quiz.description,
            type: quiz.type,
            timeLimit: quiz.timeLimit,
            questionCount: quiz._count.questions,
            isPremiumContent: access.isPremiumContent,
            isLocked: access.isLocked,
          };
        }),
      };
    });
  }

  async getTopicDetails(topicId: number, userId?: number, role?: Role) {
    const topic = await this.prisma.practiceTopic.findUnique({
      where: { id: topicId },
      include: {
        quizzes: {
          where: { type: QuizType.BILINGUAL_READING },
          select: {
            id: true,
            title: true,
            description: true,
            type: true,
            courseId: true,
            isPremiumContent: true,
            timeLimit: true,
            _count: {
              select: { questions: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!topic || topic.category !== TopicCategory.BILINGUAL_LEVEL) {
      throw new NotFoundException('Reading topic not found');
    }
    const accessByQuiz = await this.quizContentAccess.resolveMany(
      topic.quizzes,
      userId,
      role,
    );
    return {
      ...topic,
      quizzes: topic.quizzes.map((quiz) => {
        const access = accessByQuiz.get(quiz.id) ?? {
          isPremiumContent: quiz.isPremiumContent,
          isLocked: false,
        };
        const safeQuiz = quiz;
        return {
          ...safeQuiz,
          isPremiumContent: access.isPremiumContent,
          isLocked: access.isLocked,
        };
      }),
    };
  }

  async getQuizTheory(quizId: number, userId: number, role?: Role) {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id: quizId },
      select: {
        id: true,
        title: true,
        type: true,
        isPremiumContent: true,
        courseId: true,
        theoryContent: true,
        practiceTopic: { select: { category: true } },
      },
    });
    if (
      !quiz ||
      quiz.practiceTopic?.category !== TopicCategory.BILINGUAL_LEVEL ||
      quiz.type !== QuizType.BILINGUAL_READING
    ) {
      throw new NotFoundException('Reading quiz not found');
    }
    await this.quizContentAccess.assertAccess(quiz, userId, role);
    return quiz;
  }

  /**
   * Server-owned Reading progress, subskill, trend and mistake projection.
   * It intentionally derives from immutable Submission/Result rows instead of
   * introducing a second attempt or mistake table in this phase.
   */
  async getTracking(userId: number, role?: Role) {
    const [submissions, stats] = await Promise.all([
      this.prisma.submission.findMany({
        where: {
          userId,
          quiz: {
            type: QuizType.BILINGUAL_READING,
            practiceTopic: { category: TopicCategory.BILINGUAL_LEVEL },
          },
        },
        orderBy: { submittedAt: 'asc' },
        include: {
          quiz: {
            select: {
              id: true,
              title: true,
              isPremiumContent: true,
              publicationStatus: true,
              questions: {
                select: { id: true, type: true, content: true, order: true },
                orderBy: { order: 'asc' },
              },
            },
          },
          results: true,
        },
      }),
      this.prisma.userStats.findUnique({ where: { userId } }),
    ]);

    const completed = submissions.filter((submission) =>
      isReadingSubmissionComplete(
        submission.quiz.questions.map((question) => question.id),
        submission.results.map((result) => result.questionId),
      ),
    );

    type Attempt = {
      submissionId: number;
      quizId: number;
      quizTitle: string;
      correct: number;
      total: number;
      accuracy: number;
      submittedAt: string;
    };
    const attempts: Attempt[] = [];
    const subskillStats = new Map<
      string,
      { attempted: number; correct: number }
    >();
    const mistakes: Array<{
      question: string;
      yourAnswer: string;
      correctAnswer: string | null;
      answerAvailable: boolean;
      explanation: string | null;
      subskill: string;
      source: string;
      date: string;
      status: 'NEEDS_REVIEW';
    }> = [];

    for (const submission of completed) {
      const questionById = new Map(
        submission.quiz.questions.map((question) => [question.id, question]),
      );
      let correct = 0;
      for (const result of submission.results) {
        const question = questionById.get(result.questionId);
        if (!question) continue;
        const subskill = resolveReadingSubskill(question.content);
        const metric = subskillStats.get(subskill) ?? {
          attempted: 0,
          correct: 0,
        };
        metric.attempted += 1;
        if (result.isCorrect === true) {
          metric.correct += 1;
          correct += 1;
        }
        subskillStats.set(subskill, metric);

        if (result.isCorrect !== true) {
          const content = readContent(question.content);
          const resolved = resolveReadingCorrectOption(question.content);
          mistakes.push({
            question:
              typeof content.text === 'string' && content.text.trim()
                ? content.text.trim()
                : 'Câu hỏi Reading',
            yourAnswer: safeAnswer(result.answer),
            correctAnswer:
              resolved.status === 'available' ? resolved.answer : null,
            answerAvailable: resolved.status === 'available',
            explanation: safeExplanation(content.explanation),
            subskill,
            source: submission.quiz.title,
            date: submission.submittedAt.toISOString(),
            status: 'NEEDS_REVIEW',
          });
        }
      }
      attempts.push({
        submissionId: submission.id,
        quizId: submission.quizId,
        quizTitle: submission.quiz.title,
        correct,
        total: submission.quiz.questions.length,
        accuracy: scorePercent(correct, submission.quiz.questions.length),
        submittedAt: submission.submittedAt.toISOString(),
      });
    }

    const subskills = [
      ...new Set([...READING_MICRO_SKILLS, ...subskillStats.keys()]),
    ].map((key) => {
      const metric = subskillStats.get(key) ?? { attempted: 0, correct: 0 };
      const accuracy = scorePercent(metric.correct, metric.attempted);
      const status = readingMetricStatus(metric.attempted, accuracy);
      return {
        key,
        attempted: metric.attempted,
        correct: metric.correct,
        accuracy,
        status,
        statusLabel: readingMetricStatusLabel(status),
      } satisfies ReadingSubskillMetric;
    });

    const recentAttempts = attempts.slice(-5).reverse();
    const chronologicalRecent = [...recentAttempts].reverse();
    const previous = chronologicalRecent.at(-2);
    const latest = chronologicalRecent.at(-1);
    const delta =
      latest && previous ? latest.accuracy - previous.accuracy : null;
    const trendDirection =
      delta === null
        ? 'INSUFFICIENT_DATA'
        : delta > 0
          ? 'IMPROVING'
          : delta < 0
            ? 'DECLINING'
            : 'STABLE';

    const totalQuestions = [...subskillStats.values()].reduce(
      (sum, metric) => sum + metric.attempted,
      0,
    );
    const totalCorrect = [...subskillStats.values()].reduce(
      (sum, metric) => sum + metric.correct,
      0,
    );
    const completedQuizIds = new Set(
      completed.map((submission) => submission.quizId),
    );
    const adequatelySampled = subskills
      .filter((metric) => metric.attempted >= READING_TRACKING_SAMPLE_SIZE)
      .sort((a, b) => a.accuracy - b.accuracy || a.key.localeCompare(b.key));
    const weakest = adequatelySampled[0];

    let recommendation: {
      subskill: string;
      reason: string;
      quizId: number;
      title: string;
      isLocked: boolean;
    } | null = null;
    if (weakest) {
      const candidates = await this.prisma.quiz.findMany({
        where: {
          type: QuizType.BILINGUAL_READING,
          publicationStatus: QuizPublicationStatus.PUBLISHED,
          practiceTopic: { category: TopicCategory.BILINGUAL_LEVEL },
          questions: { some: {} },
        },
        select: {
          id: true,
          title: true,
          type: true,
          isPremiumContent: true,
          courseId: true,
          questions: { select: { content: true } },
        },
        orderBy: { id: 'asc' },
      });
      const accessByQuiz = await this.quizContentAccess.resolveMany(
        candidates,
        userId,
        role,
      );
      const matchingCandidates = candidates.filter((quiz) =>
        quiz.questions.some(
          (question) =>
            resolveReadingSubskill(question.content) === weakest.key,
        ),
      );
      const candidate =
        matchingCandidates.find(
          (quiz) => !(accessByQuiz.get(quiz.id)?.isLocked ?? false),
        ) ?? matchingCandidates[0];
      if (candidate) {
        const access = accessByQuiz.get(candidate.id) ?? {
          isPremiumContent: candidate.isPremiumContent,
          isLocked: false,
        };
        recommendation = {
          subskill: weakest.key,
          reason: `${weakest.key} đang có độ chính xác thấp nhất trong các kỹ năng đã đủ ${READING_TRACKING_SAMPLE_SIZE} lượt trả lời.`,
          quizId: candidate.id,
          title: candidate.title,
          isLocked: access.isLocked,
        };
      }
    }

    return {
      progress: {
        completedExercises: completedQuizIds.size,
        completedAttempts: completed.length,
        accuracy: scorePercent(totalCorrect, totalQuestions),
        recentAverage:
          recentAttempts.length > 0
            ? Math.round(
                recentAttempts.reduce(
                  (sum, attempt) => sum + attempt.accuracy,
                  0,
                ) / recentAttempts.length,
              )
            : 0,
        lastPracticedAt: attempts.at(-1)?.submittedAt ?? null,
        currentStreak: stats?.streakCount ?? 0,
      },
      subskills,
      recentAttempts,
      recentTrend: {
        direction: trendDirection,
        delta,
        attempts: chronologicalRecent,
      },
      mistakes: {
        total: mistakes.length,
        bySubskill: subskills
          .map((metric) => ({
            subskill: metric.key,
            count: mistakes.filter((mistake) => mistake.subskill === metric.key)
              .length,
          }))
          .filter((item) => item.count > 0),
        items: mistakes.slice(-50).reverse(),
      },
      recommendation,
      sampleSize: READING_TRACKING_SAMPLE_SIZE,
    };
  }

  async getBilingualProgress(userId: number) {
    const bilingualQuizzes = await this.prisma.quiz.findMany({
      where: {
        type: QuizType.BILINGUAL_READING,
        practiceTopic: { category: TopicCategory.BILINGUAL_LEVEL },
      },
      select: {
        id: true,
        title: true,
        bilingualContent: true,
        _count: { select: { questions: true } },
        questions: { select: { id: true, content: true } },
      },
    });

    const userSubmissions = await this.prisma.submission.findMany({
      where: {
        userId,
        quiz: {
          type: QuizType.BILINGUAL_READING,
          practiceTopic: { category: TopicCategory.BILINGUAL_LEVEL },
        },
      },
      orderBy: { submittedAt: 'desc' },
      select: {
        quizId: true,
        results: { select: { questionId: true, isCorrect: true } },
      },
    });
    const latestByQuiz = new Map<
      number,
      (typeof userSubmissions)[number]['results']
    >();
    for (const submission of userSubmissions) {
      if (!latestByQuiz.has(submission.quizId)) {
        latestByQuiz.set(submission.quizId, submission.results);
      }
    }

    let completedArticles = 0;
    let sentencesRead = 0;
    let questionsAnswered = 0;
    let correctAnswers = 0;
    const completedArticlesList: {
      title: string;
      sentencesCount: number;
      questionsCount: number;
    }[] = [];

    bilingualQuizzes.forEach((quiz) => {
      const results = latestByQuiz.get(quiz.id) ?? [];
      const questionIds = new Set(
        quiz.questions.map((question) => question.id),
      );
      const answered = [
        ...new Map(
          results
            .filter((result) => questionIds.has(result.questionId))
            .map((result) => [result.questionId, result]),
        ).values(),
      ];
      const complete = isReadingSubmissionComplete(
        [...questionIds],
        results.map((result) => result.questionId),
      );
      questionsAnswered += answered.length;
      correctAnswers += answered.filter((result) => result.isCorrect).length;

      if (complete) {
        completedArticles++;
        const sentencesCount = countReadingSentences(
          quiz.bilingualContent,
          quiz.questions,
        );
        sentencesRead += sentencesCount;
        completedArticlesList.push({
          title: quiz.title,
          sentencesCount,
          questionsCount: questionIds.size,
        });
      }
    });

    return {
      completedArticles,
      sentencesRead,
      questionsAnswered,
      accuracy:
        questionsAnswered === 0
          ? 0
          : Math.round((correctAnswers / questionsAnswered) * 100),
      completedArticlesList,
    };
  }
}
