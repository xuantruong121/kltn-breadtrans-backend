import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateQuizDto,
  CreateQuestionDto,
  SubmitQuizDto,
} from './dto/quiz.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AiService } from '../ai/ai.service';

@Injectable()
export class QuizService {
  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
    private aiService: AiService,
  ) {}

  async createQuiz(dto: CreateQuizDto) {
    return this.prisma.quiz.create({ data: dto });
  }

  async getAllQuizzes() {
    return this.prisma.quiz.findMany({
      include: {
        _count: {
          select: { questions: true },
        },
      },
      orderBy: {
        id: 'desc',
      },
    });
  }

  async getListeningPractices() {
    return this.prisma.quiz.findMany({
      where: {
        type: 'LISTENING_PRACTICE',
      },
      include: {
        _count: {
          select: { questions: true },
        },
      },
      orderBy: {
        id: 'desc',
      },
    });
  }

  async getQuizById(id: number) {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id },
      include: { questions: { orderBy: { order: 'asc' } } },
    });
    if (!quiz) throw new NotFoundException('Quiz not found');
    return quiz;
  }

  async createQuestion(quizId: number, dto: CreateQuestionDto) {
    return this.prisma.question.create({
      data: {
        ...dto,
        quizId,
      },
    });
  }

  async submitQuiz(quizId: number, userId: number, dto: SubmitQuizDto) {
    const quiz = await this.getQuizById(quizId);

    let totalScore = 0;

    const resultsData = await Promise.all(
      dto.answers.map(async (ans) => {
        const question = quiz.questions.find(
          (q: any) => q.id === ans.questionId,
        );
        let isCorrect = false;
        let score = 0;

        if (question) {
          if (question.type === 'MULTIPLE_CHOICE') {
            const content = question.content as any;
            if (content.correct === ans.answer) {
              isCorrect = true;
              score = 1;
              totalScore += score;
            }
          } else if (question.type === 'DICTATION') {
            const content = question.content as any;
            const cleanCorrect = String(content.correctAnswer || '')
              .toLowerCase()
              .replace(/[.,!?]/g, '')
              .trim();
            const cleanAns = String(ans.answer || '')
              .toLowerCase()
              .replace(/[.,!?]/g, '')
              .trim();
            if (cleanCorrect === cleanAns) {
              isCorrect = true;
              score = 1;
              totalScore += score;
            }
          } else if (question.type === 'WRITING') {
            // Gọi AI chấm bài cho câu tự luận
            const content = question.content as any;
            await this.aiService.generateFeedback(
              content.text || 'Write an essay.',
              ans.answer,
            );
          }
        }

        return {
          questionId: ans.questionId,
          answer: ans.answer,
          isCorrect,
          score,
          // (Optional: You could save this feedback into the Result JSON if you want.
          // We will just accumulate it into the Submission aiFeedback for now)
        };
      }),
    );

    // Accumulate all AI feedback to store in the Submission
    let overallAiFeedback = '';
    // We run the map again just to combine (or we could have done it inside)
    for (const ans of dto.answers) {
      const question = quiz.questions.find((q: any) => q.id === ans.questionId);
      if (question && question.type === 'WRITING') {
        const content = question.content as any;
        const feedback = await this.aiService.generateFeedback(
          content.text,
          ans.answer,
        );
        overallAiFeedback += `Question: ${content.text}\nFeedback: ${feedback}\n\n`;
      }
    }

    const submission = await this.prisma.submission.create({
      data: {
        quizId,
        userId,
        score: totalScore,
        aiFeedback: overallAiFeedback ? overallAiFeedback : null,
        results: {
          create: resultsData,
        },
      },
      include: {
        results: true,
      },
    });

    // Phát ra sự kiện cho Gamification
    this.eventEmitter.emit('quiz.submitted', {
      userId,
      score: totalScore,
      submissionId: submission.id,
    });

    return submission;
  }

  /**
   * Quy đổi số câu đúng ra điểm TOEIC (10 - 990)
   */
  calculateToeicScore(listeningCorrect: number, readingCorrect: number) {
    const lCorrect = Math.min(100, Math.max(0, listeningCorrect));
    const rCorrect = Math.min(100, Math.max(0, readingCorrect));

    // Thang quy đổi chuẩn ETS TOEIC
    const convertListening = (c: number) => {
      if (c <= 5) return 5;
      if (c >= 96) return 495;
      return Math.round(5 + (c - 5) * (490 / 91));
    };

    const convertReading = (c: number) => {
      if (c <= 5) return 5;
      if (c >= 96) return 495;
      return Math.round(5 + (c - 5) * (490 / 91));
    };

    const listeningScore = convertListening(lCorrect);
    const readingScore = convertReading(rCorrect);
    const totalScore = listeningScore + readingScore;

    return {
      listening: { correct: lCorrect, total: 100, score: listeningScore },
      reading: { correct: rCorrect, total: 100, score: readingScore },
      totalScore,
    };
  }

  /**
   * Phân tích điểm mạnh / điểm yếu theo Tag & Category sau khi nộp bài (Analytics)
   */
  async getSubmissionAnalytics(submissionId: number) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        quiz: {
          include: {
            questions: true,
          },
        },
        results: true,
      },
    });

    if (!submission) throw new NotFoundException('Submission not found');

    const tagStats: Record<string, { correct: number; total: number }> = {};
    let totalCorrect = 0;
    const totalQuestions = submission.results.length;

    submission.results.forEach((res) => {
      if (res.isCorrect) totalCorrect++;
      const question = submission.quiz.questions.find(
        (q) => q.id === res.questionId,
      );
      const content = question?.content as any;
      const category = content?.category || question?.type || 'General';

      if (!tagStats[category]) {
        tagStats[category] = { correct: 0, total: 0 };
      }
      tagStats[category].total += 1;
      if (res.isCorrect) {
        tagStats[category].correct += 1;
      }
    });

    const categoriesBreakdown = Object.entries(tagStats).map(
      ([category, stat]) => {
        const accuracy =
          stat.total > 0 ? Math.round((stat.correct / stat.total) * 100) : 0;
        return {
          category,
          correct: stat.correct,
          total: stat.total,
          accuracyPercent: accuracy,
        };
      },
    );

    const strengths = categoriesBreakdown
      .filter((c) => c.accuracyPercent >= 75)
      .map((c) => c.category);
    const weaknesses = categoriesBreakdown
      .filter((c) => c.accuracyPercent < 50)
      .map((c) => c.category);

    const overallAccuracy =
      totalQuestions > 0
        ? Math.round((totalCorrect / totalQuestions) * 100)
        : 0;

    return {
      submissionId,
      quizTitle: submission.quiz.title,
      overallScore: submission.score,
      totalQuestions,
      totalCorrect,
      overallAccuracyPercent: overallAccuracy,
      categoriesBreakdown,
      results: submission.results,
      questions: submission.quiz.questions,
      strengths:
        strengths.length > 0
          ? strengths
          : ['Cần luyện tập thêm để xác định điểm mạnh'],
      weaknesses:
        weaknesses.length > 0 ? weaknesses : ['Không có điểm yếu nghiêm trọng'],
      recommendation:
        weaknesses.length > 0
          ? `Bạn nên tập trung ôn luyện lại các mảng kiến thức: ${weaknesses.join(', ')}.`
          : 'Thành tích rất tốt! Hãy tiếp tục duy trì và thử sức ở đề thi khó hơn.',
    };
  }
}
