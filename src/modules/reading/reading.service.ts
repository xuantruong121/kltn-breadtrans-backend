import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { QuizType, TopicCategory } from '@prisma/client';

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
        questions: { select: { id: true } },
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
      const resultIds = new Set(results.map((result) => result.questionId));
      const questionIds = new Set(
        quiz.questions.map((question) => question.id),
      );
      const answered = results.filter((result) =>
        questionIds.has(result.questionId),
      );
      const complete =
        questionIds.size > 0 && questionIds.size === resultIds.size;
      questionsAnswered += answered.length;
      correctAnswers += answered.filter((result) => result.isCorrect).length;

      if (complete) {
        completedArticles++;
        const content = Array.isArray(quiz.bilingualContent)
          ? quiz.bilingualContent
          : [];
        sentencesRead += content.length;
        completedArticlesList.push({
          title: quiz.title,
          sentencesCount: content.length,
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
