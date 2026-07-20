import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TopicCategory } from '@prisma/client';
import { AiService } from '../ai/ai.service';

@Injectable()
export class WritingService {
  constructor(
    private prisma: PrismaService,
    private aiService: AiService,
  ) {}

  async getTopics() {
    const categories = await this.prisma.practiceTopic.findMany({
      where: { category: TopicCategory.WRITING_PART1 },
      include: {
        _count: {
          select: { quizzes: true },
        },
      },
    });

    const quizzes = await this.prisma.quiz.findMany({
      where: { practiceTopic: { category: TopicCategory.WRITING_PART1 } },
      include: {
        questions: true,
        practiceTopic: true,
      },
      orderBy: { id: 'desc' },
    });

    return {
      categories,
      quizzes: quizzes.map((q) => {
        const question = q.questions[0];
        const content = question.content as any;
        return {
          id: q.id,
          topicId: q.practiceTopicId,
          topicName: q.practiceTopic?.name,
          imageUrl: content.imageUrl,
          keywords: content.keywords,
        };
      }),
    };
  }

  async getQuizDetails(quizId: number) {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id: quizId },
      include: { questions: true },
    });

    if (!quiz || quiz.questions.length === 0) {
      throw new NotFoundException('Quiz not found');
    }

    const question = quiz.questions[0];
    const content = question.content as any;

    return {
      quizId: quiz.id,
      imageUrl: content.imageUrl,
      keywords: content.keywords,
      sampleSentences: content.sampleSentences,
    };
  }

  async getCommunitySubmissions(quizId: number) {
    const submissions = await this.prisma.submission.findMany({
      where: { quizId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            profile: { select: { fullName: true } },
          },
        },
        results: true,
      },
      orderBy: { score: 'desc' },
    });

    return submissions.map((sub) => ({
      id: sub.id,
      user: sub.user.profile?.fullName || sub.user.email,
      score: sub.score,
      answer: sub.results[0]?.answer,
      feedback: sub.aiFeedback,
      submittedAt: sub.submittedAt,
    }));
  }

  async submitWriting(quizId: number, userId: number, text: string) {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id: quizId },
      include: { questions: true },
    });
    if (!quiz || quiz.questions.length === 0)
      throw new NotFoundException('Quiz not found');

    const question = quiz.questions[0];
    const content = question.content as any;

    // AI evaluate
    const evaluation = await this.aiService.evaluateWritingPart1(
      content.imageUrl,
      content.keywords,
      text,
    );

    // Save submission
    const submission = await this.prisma.submission.create({
      data: {
        quizId,
        userId,
        score: evaluation.score,
        aiFeedback: evaluation.feedback,
        results: {
          create: [
            {
              questionId: question.id,
              answer: text,
              score: evaluation.score,
            },
          ],
        },
      },
    });

    return {
      submissionId: submission.id,
      score: evaluation.score,
      feedback: evaluation.feedback,
    };
  }
}
