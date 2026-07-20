import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TopicCategory } from '@prisma/client';

@Injectable()
export class ReadingService {
  constructor(private prisma: PrismaService) {}

  async getTopicsByCategory(category: TopicCategory, userId: number) {
    const topics = await this.prisma.practiceTopic.findMany({
      where: { category },
      orderBy: { order: 'asc' },
      include: {
        quizzes: {
          include: {
            questions: true,
          },
        },
      },
    });

    const userResults = await this.prisma.result.findMany({
      where: {
        submission: {
          userId: userId,
          quiz: {
            practiceTopic: {
              category: category,
            },
          },
        },
      },
    });

    const correctQuestionIds = new Set(
      userResults.filter((r) => r.isCorrect).map((r) => r.questionId),
    );
    const completedQuestionIds = new Set(userResults.map((r) => r.questionId));

    return topics.map((topic) => {
      let totalQuestions = 0;
      let completedCount = 0;
      let correctCount = 0;
      let completedArticles = 0;

      topic.quizzes.forEach((quiz) => {
        const allQuestions = quiz.questions;
        totalQuestions += allQuestions.length;

        let isQuizCompleted = true;
        if (allQuestions.length === 0) isQuizCompleted = false;

        allQuestions.forEach((q) => {
          if (completedQuestionIds.has(q.id)) {
            completedCount++;
          } else {
            isQuizCompleted = false;
          }
          if (correctQuestionIds.has(q.id)) correctCount++;
        });

        if (isQuizCompleted) completedArticles++;
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

    if (!topic) throw new NotFoundException('Topic not found');
    return topic;
  }

  async getQuizTheory(quizId: number) {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id: quizId },
      select: {
        id: true,
        title: true,
        theoryContent: true,
      },
    });
    if (!quiz) throw new NotFoundException('Quiz not found');
    return quiz;
  }

  async getBilingualProgress(userId: number) {
    // Tìm tất cả quizzes thuộc BILINGUAL_LEVEL
    const bilingualQuizzes = await this.prisma.quiz.findMany({
      where: {
        practiceTopic: {
          category: TopicCategory.BILINGUAL_LEVEL,
        },
      },
      include: {
        questions: true,
      },
    });

    const userResults = await this.prisma.result.findMany({
      where: {
        submission: {
          userId: userId,
          quiz: {
            practiceTopic: {
              category: TopicCategory.BILINGUAL_LEVEL,
            },
          },
        },
      },
    });

    const correctQuestionIds = new Set(
      userResults.filter((r) => r.isCorrect).map((r) => r.questionId),
    );
    const completedQuestionIds = new Set(userResults.map((r) => r.questionId));

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
      let isCompleted = true;
      let qAnswered = 0;
      let qCorrect = 0;

      if (quiz.questions.length === 0) isCompleted = false; // Bỏ qua nếu không có câu hỏi

      quiz.questions.forEach((q) => {
        if (completedQuestionIds.has(q.id)) {
          qAnswered++;
        } else {
          isCompleted = false; // Phải làm hết mới tính là Đã đọc xong
        }
        if (correctQuestionIds.has(q.id)) qCorrect++;
      });

      questionsAnswered += qAnswered;
      correctAnswers += qCorrect;

      if (isCompleted) {
        completedArticles++;
        const contentArray = quiz.bilingualContent as any[];
        const sCount = contentArray ? contentArray.length : 0;
        sentencesRead += sCount;

        completedArticlesList.push({
          title: quiz.title,
          sentencesCount: sCount,
          questionsCount: quiz.questions.length,
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
