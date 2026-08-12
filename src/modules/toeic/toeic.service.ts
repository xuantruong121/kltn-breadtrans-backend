import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AttemptMode } from '@prisma/client';

@Injectable()
export class ToeicService {
  constructor(private prisma: PrismaService) {}

  async getExams() {
    return this.prisma.toeicExamSet.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async getExamDetails(examId: number) {
    const exam = await this.prisma.toeicExamSet.findUnique({
      where: { id: examId },
      include: {
        groups: {
          include: { questions: true },
          orderBy: { groupOrder: 'asc' },
        },
      },
    });
    if (!exam) throw new NotFoundException('Exam not found');
    return exam;
  }

  async startAttempt(userId: number, examId: number, mode: AttemptMode) {
    return this.prisma.toeicAttempt.create({
      data: {
        userId,
        examId,
        mode,
        startedAt: new Date(),
      },
    });
  }

  async getRemainingTime(attemptId: number) {
    const attempt = await this.prisma.toeicAttempt.findUnique({
      where: { id: attemptId },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');
    if (attempt.submittedAt) return { remaining: 0 };

    // Assume TOEIC is 120 minutes (7200 seconds)
    const MAX_TIME = 7200;
    const elapsed = Math.floor(
      (new Date().getTime() - attempt.startedAt.getTime()) / 1000,
    );
    const remaining = Math.max(0, MAX_TIME - elapsed);
    return { remaining };
  }

  async saveAnswers(attemptId: number, answers: Record<string, number>) {
    const attempt = await this.prisma.toeicAttempt.findUnique({
      where: { id: attemptId },
    });
    if (!attempt || attempt.submittedAt)
      throw new BadRequestException('Cannot save');

    const updatePromises = Object.entries(answers).map(([qId, sIdx]) =>
      this.prisma.toeicAttemptAnswer.upsert({
        where: {
          attemptId_questionId: {
            attemptId,
            questionId: parseInt(qId),
          },
        },
        update: { selectedIndex: sIdx },
        create: {
          attemptId,
          questionId: parseInt(qId),
          selectedIndex: sIdx,
        },
      }),
    );
    await Promise.all(updatePromises);
    return { success: true };
  }

  async submitAttempt(attemptId: number) {
    const attempt = await this.prisma.toeicAttempt.findUnique({
      where: { id: attemptId },
      include: { answers: { include: { question: true } } },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');

    let listeningScore = 0;
    let readingScore = 0;
    let correctListening = 0;
    let correctReading = 0;

    // Simple grading logic (in reality, use TOEIC conversion table)
    attempt.answers.forEach((ans) => {
      if (ans.selectedIndex === ans.question.correctIndex) {
        // Assume questions 1-100 are Listening (Part 1-4), 101-200 are Reading (Part 5-7)
        if (ans.question.questionNumber <= 100) correctListening++;
        else correctReading++;
      }
    });

    // Mock conversion (multiply by 5 for roughly 5-495 range each)
    listeningScore = Math.min(495, Math.max(5, correctListening * 5));
    readingScore = Math.min(495, Math.max(5, correctReading * 5));

    return this.prisma.toeicAttempt.update({
      where: { id: attemptId },
      data: {
        submittedAt: new Date(),
        listeningScore,
        readingScore,
        totalScore: listeningScore + readingScore,
      },
    });
  }

  async getResult(attemptId: number) {
    const attempt = await this.prisma.toeicAttempt.findUnique({
      where: { id: attemptId },
      include: {
        exam: { include: { groups: { include: { questions: true } } } },
        answers: true,
      },
    });
    if (!attempt) throw new NotFoundException('Result not found');
    return attempt;
  }
}
