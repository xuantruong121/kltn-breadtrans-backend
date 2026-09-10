import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { QuizType, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateQuizDto,
  CreateQuestionDto,
  SubmitQuizDto,
  CheckPracticeQuestionDto,
} from './dto/quiz.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AiService } from '../ai/ai.service';
import { SpeakingService } from '../speaking/speaking.service';

@Injectable()
export class QuizService {
  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
    private aiService: AiService,
    private speakingService: SpeakingService,
  ) {}

  async createQuiz(dto: CreateQuizDto, user?: { id: number; role: Role }) {
    if (user && user.role !== Role.ADMIN) {
      throw new ForbiddenException(
        'Chỉ Quản trị viên mới có quyền tạo bài kiểm tra',
      );
    }
    return this.prisma.quiz.create({ data: dto });
  }

  async updateQuiz(
    id: number,
    dto: Partial<CreateQuizDto>,
    user?: { id: number; role: Role },
  ) {
    const existing = await this.prisma.quiz.findUnique({
      where: { id },
      include: { course: true },
    });
    if (!existing) throw new NotFoundException('Quiz not found');

    if (user && user.role !== Role.ADMIN) {
      throw new ForbiddenException(
        'Chỉ Quản trị viên mới có quyền chỉnh sửa bài kiểm tra',
      );
    }

    return this.prisma.quiz.update({
      where: { id },
      data: dto,
    });
  }

  async deleteQuiz(id: number, user?: { id: number; role: Role }) {
    const existing = await this.prisma.quiz.findUnique({
      where: { id },
      include: { course: true },
    });
    if (!existing) throw new NotFoundException('Quiz not found');

    if (user && user.role !== Role.ADMIN) {
      throw new ForbiddenException(
        'Chỉ Quản trị viên mới có quyền xóa bài kiểm tra',
      );
    }

    return this.prisma.quiz.delete({
      where: { id },
    });
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

  async getListeningPractices(userId?: number) {
    const quizzes = await this.prisma.quiz.findMany({
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

    const toCatalogItem = (
      quiz: (typeof quizzes)[number],
      isCompleted: boolean,
    ) => {
      const metadata = (quiz.bilingualContent ?? {}) as Record<string, unknown>;
      const stringArray = (value: unknown): string[] =>
        Array.isArray(value)
          ? value.filter((item): item is string => typeof item === 'string')
          : [];
      const durationMinutes = Number(metadata.durationMinutes);

      return {
        ...quiz,
        mode: metadata.mode === 'DICTATION' ? 'DICTATION' : 'COMPREHENSION',
        track:
          metadata.track === 'TOEIC_LISTENING'
            ? 'TOEIC_LISTENING'
            : 'GENERAL_ENGLISH',
        levels: stringArray(metadata.levels),
        topics: stringArray(metadata.topics),
        accents: stringArray(metadata.accents),
        questionCount: quiz._count.questions,
        durationMinutes: Number.isFinite(durationMinutes)
          ? durationMinutes
          : quiz.timeLimit,
        isCompleted,
      };
    };

    if (!userId) return quizzes.map((quiz) => toCatalogItem(quiz, false));

    // Check user submissions to see which ones are completed
    const userSubmissions = await this.prisma.submission.findMany({
      where: {
        userId,
        quizId: { in: quizzes.map((q) => q.id) },
      },
      select: { quizId: true },
    });

    const completedQuizIds = new Set(userSubmissions.map((s) => s.quizId));

    return quizzes.map((quiz) =>
      toCatalogItem(quiz, completedQuizIds.has(quiz.id)),
    );
  }

  async getToeicPapers(userId?: number) {
    const quizzes = await this.prisma.quiz.findMany({
      where: {
        type: 'TOEIC',
        OR: [
          { bilingualContent: { path: ['examFormat'], equals: 'TWO_SKILL' } },
          { bilingualContent: { path: ['examFormat'], equals: 'FOUR_SKILL' } },
        ],
      },
      include: { _count: { select: { questions: true } } },
      orderBy: { id: 'asc' },
    });

    const completedQuizIds = new Set<number>();
    if (userId) {
      const userSubmissions = await this.prisma.submission.findMany({
        where: {
          userId,
          quizId: { in: quizzes.map((quiz) => quiz.id) },
        },
        select: { quizId: true },
      });
      userSubmissions.forEach((s) => completedQuizIds.add(s.quizId));
    }

    return quizzes.map((quiz) => {
      const metadata = (quiz.bilingualContent ?? {}) as Record<string, unknown>;
      const linkedCount = Number(metadata.totalQuestions);
      return {
        ...quiz,
        questionsCount:
          Number.isFinite(linkedCount) && linkedCount > 0
            ? linkedCount
            : quiz._count.questions,
        isBundle: metadata.isBundle === true,
        isCompleted: completedQuizIds.has(quiz.id),
      };
    });
  }

  async getQuizById(id: number, includeAnswers = false, userId?: number) {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id },
      include: { questions: { orderBy: { order: 'asc' } } },
    });
    if (!quiz) throw new NotFoundException('Quiz not found');

    if (quiz.type === QuizType.LISTENING_PRACTICE && userId === undefined) {
      throw new UnauthorizedException('Đăng nhập để bắt đầu luyện nghe');
    }

    if (!includeAnswers && quiz.questions) {
      const sanitizedQuestions = quiz.questions.map((q) => {
        if (!q.content || typeof q.content !== 'object') return q;
        const content = { ...(q.content as any) };
        delete content.correct;
        delete content.correctAnswer;
        delete content.correctIndex;
        delete content.explanation;
        if (quiz.type === QuizType.LISTENING_PRACTICE) {
          delete content.audioText;
        }
        return { ...q, content };
      });
      return { ...quiz, questions: sanitizedQuestions };
    }

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

  async updateQuestion(questionId: number, dto: Partial<CreateQuestionDto>) {
    const existing = await this.prisma.question.findUnique({
      where: { id: questionId },
    });
    if (!existing) throw new NotFoundException('Question not found');
    return this.prisma.question.update({
      where: { id: questionId },
      data: dto,
    });
  }

  async deleteQuestion(questionId: number) {
    const existing = await this.prisma.question.findUnique({
      where: { id: questionId },
    });
    if (!existing) throw new NotFoundException('Question not found');
    return this.prisma.question.delete({
      where: { id: questionId },
    });
  }

  async submitQuiz(quizId: number, userId: number, dto: SubmitQuizDto) {
    const quiz = await this.getQuizById(quizId, true, userId);

    if (quiz.type === QuizType.LISTENING_PRACTICE) {
      this.assertCompleteListeningSubmission(quiz.questions, dto.answers);
    }

    let totalScore = 0;

    const resultsData = dto.answers.map((ans) => {
      const question = quiz.questions.find((q: any) => q.id === ans.questionId);
      let isCorrect = false;
      let score = 0;

      if (question) {
        if (question.type === 'MULTIPLE_CHOICE') {
          const content = question.content;
          if (
            content.correctIndex !== undefined &&
            Array.isArray(content.options)
          ) {
            // Reading-style: options array + correctIndex
            const correctOption = content.options[content.correctIndex];
            if (correctOption === ans.answer) {
              isCorrect = true;
              score = 1;
              totalScore += score;
            }
          } else if (content.correct === ans.answer) {
            isCorrect = true;
            score = 1;
            totalScore += score;
          }
        } else if (
          question.type === 'DICTATION' ||
          question.type === 'FILL_IN_BLANK'
        ) {
          const content = question.content;
          const cleanCorrect = String(
            content.correctAnswer || content.correct || '',
          )
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
          // Sẽ gọi AI chấm bài và gom overallAiFeedback ở vòng lặp bên dưới
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
    });

    // Accumulate all AI feedback to store in the Submission
    let overallAiFeedback = '';
    // We run the map again just to combine (or we could have done it inside)
    for (const ans of dto.answers) {
      const question = quiz.questions.find((q: any) => q.id === ans.questionId);
      if (question && question.type === 'WRITING') {
        const content = question.content;
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

    // Chống farm điểm thưởng Quiz bằng UserQuizReward (Atomic @@unique([userId, quizId]))
    let isFirstSubmission = false;
    try {
      await this.prisma.userQuizReward.create({
        data: {
          userId,
          quizId,
        },
      });
      isFirstSubmission = true;
    } catch (e: any) {
      if (e.code === 'P2002') {
        isFirstSubmission = false;
      } else {
        throw e;
      }
    }

    // Phát ra sự kiện cho Gamification kèm cờ isFirstSubmission
    this.eventEmitter.emit('quiz.submitted', {
      userId,
      quizId,
      score: totalScore,
      submissionId: submission.id,
      isFirstSubmission,
    });

    return {
      ...submission,
      isFirstSubmission,
    };
  }

  async checkPracticeQuestion(
    quizId: number,
    questionId: number,
    dto: CheckPracticeQuestionDto,
  ) {
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
      include: { quiz: { select: { id: true, type: true } } },
    });
    if (!question || question.quizId !== quizId) {
      throw new NotFoundException('Câu hỏi không thuộc bài luyện này');
    }
    if (question.quiz.type !== QuizType.LISTENING_PRACTICE) {
      throw new ForbiddenException(
        'Chỉ hỗ trợ kiểm tra tức thời cho bài luyện nghe',
      );
    }

    const content = question.content as Record<string, unknown>;
    if (
      question.type !== 'MULTIPLE_CHOICE' ||
      !Array.isArray(content.options)
    ) {
      return {
        questionId,
        isCorrect: false,
        submittedAnswer: dto.answer,
        feedback: 'Loại câu hỏi này chưa được hỗ trợ kiểm tra tức thời.',
      };
    }

    const correctIndex = Number(content.correctIndex);
    const expectedAnswer = Number.isInteger(correctIndex)
      ? content.options[correctIndex]
      : content.correct;
    if (typeof expectedAnswer !== 'string') {
      throw new BadRequestException('Câu hỏi chưa có đáp án hợp lệ');
    }

    return {
      questionId,
      isCorrect: dto.answer.trim() === expectedAnswer.trim(),
      submittedAnswer: dto.answer,
      correctAnswer: expectedAnswer,
      explanation:
        typeof content.explanation === 'string' ||
        (content.explanation && typeof content.explanation === 'object')
          ? content.explanation
          : null,
      translation:
        typeof content.translation === 'string' ? content.translation : null,
    };
  }

  async streamQuestionAudio(
    quizId: number,
    questionId: number,
  ): Promise<Buffer> {
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
      include: { quiz: { select: { id: true, type: true } } },
    });
    if (!question || question.quizId !== quizId) {
      throw new NotFoundException('Câu hỏi không thuộc bài luyện này');
    }
    if (question.quiz.type !== QuizType.LISTENING_PRACTICE) {
      throw new ForbiddenException('Chỉ hỗ trợ audio cho bài luyện nghe');
    }

    const content = question.content as Record<string, unknown>;
    const audioText =
      typeof content.audioText === 'string' ? content.audioText.trim() : '';
    if (!audioText)
      throw new BadRequestException('Câu hỏi chưa có nội dung audio');
    const accent = content.accent === 'UK' ? 'UK' : 'US';
    return this.speakingService.generateTts(audioText, accent, 1);
  }

  private assertCompleteListeningSubmission(
    questions: Array<{ id: number }>,
    answers: Array<{ questionId: number; answer: unknown }>,
  ) {
    const questionIds = new Set(questions.map((question) => question.id));
    if (answers.length !== questionIds.size) {
      throw new BadRequestException(
        'Hãy trả lời đầy đủ tất cả câu hỏi trước khi nộp bài',
      );
    }

    const seenQuestionIds = new Set<number>();
    for (const answer of answers) {
      if (
        !questionIds.has(answer.questionId) ||
        seenQuestionIds.has(answer.questionId) ||
        typeof answer.answer !== 'string' ||
        answer.answer.trim().length === 0
      ) {
        throw new BadRequestException('Dữ liệu câu trả lời không hợp lệ');
      }
      seenQuestionIds.add(answer.questionId);
    }
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
  async getSubmissionAnalytics(
    submissionId: number,
    userId?: number,
    role?: Role,
  ) {
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

    if (role === Role.STUDENT && submission.userId !== userId) {
      throw new ForbiddenException(
        'Bạn không có quyền xem kết quả bài thi này',
      );
    }

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
