import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { QuizType, TopicCategory } from '@prisma/client';

type ReadingQuestionContent = {
  passage?: unknown;
  content?: unknown;
};

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
  constructor(private prisma: PrismaService) {}

  async getTopicsByCategory(category: TopicCategory, userId?: number) {
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
            bilingualContent: true,
            timeLimit: true,
            questions: { select: { id: true } },
            _count: { select: { questions: true } },
          },
        },
      },
    });

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
      };
    });
  }

  async getTopicDetails(topicId: number) {
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
            bilingualContent: true,
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
    return topic;
  }

  async getQuizTheory(quizId: number) {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id: quizId },
      select: {
        id: true,
        title: true,
        type: true,
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
    return quiz;
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
