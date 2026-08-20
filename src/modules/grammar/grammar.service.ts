import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CreateGrammarTopicDto } from './dto/create-grammar-topic.dto';
import { CreateGrammarQuestionDto } from './dto/create-grammar-question.dto';

@Injectable()
export class GrammarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async getTopics(userId?: number) {
    const topics = await this.prisma.grammarTopic.findMany({
      include: {
        _count: { select: { questions: true } },
      },
      orderBy: { order: 'asc' },
    });

    const userAttemptsMap: Record<
      number,
      { lastScore: number; count: number }
    > = {};
    if (userId) {
      const attempts = await this.prisma.grammarAttempt.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
      attempts.forEach((att) => {
        if (!userAttemptsMap[att.topicId]) {
          userAttemptsMap[att.topicId] = {
            lastScore: att.score,
            count: 1,
          };
        } else {
          userAttemptsMap[att.topicId].count += 1;
        }
      });
    }

    return topics.map((t) => ({
      id: t.id,
      title: t.title,
      level: t.level,
      description: t.description,
      videoYoutubeId: t.videoYoutubeId,
      keyFormula: t.keyFormula,
      totalQuestions: t._count.questions,
      isCompleted: !!userAttemptsMap[t.id],
      lastScore: userAttemptsMap[t.id]?.lastScore ?? null,
      attemptCount: userAttemptsMap[t.id]?.count ?? 0,
    }));
  }

  async getTopicDetail(id: number, userId?: number) {
    const topic = await this.prisma.grammarTopic.findUnique({
      where: { id },
      include: {
        questions: {
          orderBy: { order: 'asc' },
        },
      },
    });

    if (!topic) {
      throw new NotFoundException(`Grammar topic with ID ${id} not found`);
    }

    let latestAttempt: any = null;
    if (userId) {
      latestAttempt = await this.prisma.grammarAttempt.findFirst({
        where: { topicId: id, userId },
        orderBy: { createdAt: 'desc' },
      });
    }

    return {
      ...topic,
      latestAttempt,
    };
  }

  async submitAttempt(
    topicId: number,
    userId: number,
    answers: Record<string, number>,
  ) {
    const topic = await this.prisma.grammarTopic.findUnique({
      where: { id: topicId },
      include: { questions: true },
    });

    if (!topic) {
      throw new NotFoundException(`Topic ${topicId} not found`);
    }

    let correctCount = 0;
    const questionsResult = topic.questions.map((q) => {
      const selected = answers[String(q.id)] ?? answers[q.id];
      const isCorrect = selected === q.correctIndex;
      if (isCorrect) correctCount++;
      return {
        questionId: q.id,
        selectedOption: selected,
        correctOption: q.correctIndex,
        isCorrect,
        explanation: q.explanation,
      };
    });

    const totalQuestions = topic.questions.length || 1;
    const score = Math.round((correctCount / totalQuestions) * 100);

    // Save attempt
    const attempt = await this.prisma.grammarAttempt.create({
      data: {
        userId,
        topicId,
        score,
        answers: answers as any,
      },
    });

    // Reward Bánh Mì & XP
    const rewardBanh = Math.max(5, Math.floor(score / 10));
    const rewardXP = score;

    await this.prisma.userStats.upsert({
      where: { userId },
      update: { totalBanhRan: { increment: rewardBanh } },
      create: { userId, totalBanhRan: rewardBanh },
    });

    await this.prisma.pointHistory.create({
      data: {
        userId,
        points: rewardBanh,
        reason: `Hoàn thành bài Ngữ pháp: ${topic.title} (${score}%)`,
      },
    });

    // Emit event for Gamification
    this.eventEmitter.emit('gamification.xp_earned', {
      userId,
      points: rewardXP,
    });

    return {
      attemptId: attempt.id,
      score,
      correctCount,
      totalQuestions,
      rewardBanh,
      rewardXP,
      questionsResult,
    };
  }

  async getMyAttempts(userId: number) {
    return this.prisma.grammarAttempt.findMany({
      where: { userId },
      include: {
        topic: {
          select: {
            id: true,
            title: true,
            level: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  // Admin/Teacher APIs
  async createTopic(dto: CreateGrammarTopicDto) {
    return this.prisma.grammarTopic.create({
      data: {
        title: dto.title,
        level: dto.level || 'BEGINNER',
        description: dto.description,
        videoYoutubeId: dto.videoYoutubeId,
        keyFormula: dto.keyFormula,
        order: dto.order || 0,
      },
    });
  }

  async createQuestion(topicId: number, dto: CreateGrammarQuestionDto) {
    return this.prisma.grammarQuestion.create({
      data: {
        topicId,
        question: dto.question,
        options: dto.options,
        correctIndex: dto.correctIndex,
        explanation: dto.explanation,
        order: dto.order || 0,
      },
    });
  }

  async deleteTopic(id: number) {
    return this.prisma.grammarTopic.delete({
      where: { id },
    });
  }

  async deleteQuestion(id: number) {
    return this.prisma.grammarQuestion.delete({
      where: { id },
    });
  }
}
