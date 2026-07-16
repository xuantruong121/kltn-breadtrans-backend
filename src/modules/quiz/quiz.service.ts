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
        const question = quiz.questions.find((q: any) => q.id === ans.questionId);
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
}
