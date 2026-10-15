import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { QuizPublicationStatus } from '@prisma/client';
import {
  CreateGrammarTopicDto,
  UpdateGrammarTopicDto,
  CreateGrammarQuestionDto,
  UpdateGrammarQuestionDto,
} from './dto';

@Injectable()
export class GrammarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async getTopics(userId?: number, isStaff = false) {
    const topics = await this.prisma.grammarTopic.findMany({
      where: isStaff
        ? {}
        : { publicationStatus: QuizPublicationStatus.PUBLISHED },
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
      publicationStatus: t.publicationStatus,
      totalQuestions: t._count.questions,
      isCompleted: !!userAttemptsMap[t.id],
      lastScore: userAttemptsMap[t.id]?.lastScore ?? null,
      attemptCount: userAttemptsMap[t.id]?.count ?? 0,
    }));
  }

  async getTopicDetail(id: number, userId?: number, isStaff = false) {
    const topic = await this.prisma.grammarTopic.findUnique({
      where: { id },
      include: {
        questions: isStaff
          ? { orderBy: { order: 'asc' } }
          : {
              select: {
                id: true,
                topicId: true,
                question: true,
                options: true,
                order: true,
                createdAt: true,
              },
              orderBy: { order: 'asc' },
            },
      },
    });

    if (
      !topic ||
      (!isStaff && topic.publicationStatus !== QuizPublicationStatus.PUBLISHED)
    ) {
      throw new NotFoundException(`Grammar topic with ID ${id} not found`);
    }

    let latestAttempt: any = null;
    if (userId) {
      latestAttempt = await this.prisma.grammarAttempt.findFirst({
        where: { topicId: id, userId },
        orderBy: { createdAt: 'desc' },
      });
    }

    const sanitizedQuestions = isStaff
      ? topic.questions
      : topic.questions?.map((q: any) => {
          const rest = { ...q };
          delete rest.correctIndex;
          delete rest.explanation;
          return rest;
        });

    return {
      ...topic,
      questions: sanitizedQuestions,
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
    if (topic.publicationStatus !== QuizPublicationStatus.PUBLISHED) {
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

    let rewardBanh = 0;
    let rewardXP = 0;
    let isFirstCompletion = false;

    // Attempt, first-completion guard, wallet and immutable ledger must commit
    // together. The advisory lock makes the read-then-create guard safe even
    // when two submissions arrive at the same time.
    const attempt = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`grammar:reward:${userId}:${topicId}`}, 0))`;

      const created = await tx.grammarAttempt.create({
        data: {
          userId,
          topicId,
          score,
          answers: answers as any,
        },
      });

      const existingReward = await tx.userGrammarReward.findUnique({
        where: { userId_topicId: { userId, topicId } },
      });

      if (!existingReward) {
        await tx.userGrammarReward.create({ data: { userId, topicId } });
        isFirstCompletion = true;
        rewardBanh = Math.max(5, Math.floor(score / 10));
        rewardXP = score;

        const updatedStats = await tx.userStats.upsert({
          where: { userId },
          update: { totalBanhRan: { increment: rewardBanh } },
          create: { userId, totalBanhRan: rewardBanh },
        });

        await tx.banhTransaction.create({
          data: {
            userId,
            amount: rewardBanh,
            source: 'GRAMMAR_COMPLETION',
            reference: `grammar:topic:${topicId}`,
            dateKey: this.getVietnamDateKey(),
            isCapped: false,
            balanceAfter: updatedStats.totalBanhRan,
            metadata: { topicId, attemptId: created.id, score } as any,
          },
        });

        await tx.pointHistory.create({
          data: {
            userId,
            points: rewardBanh,
            reason: `Hoàn thành bài Ngữ pháp lần đầu: ${topic.title} (${score}%)`,
          },
        });
      }

      return created;
    });

    if (isFirstCompletion) {
      this.eventEmitter.emit('gamification.xp_earned', {
        userId,
        points: rewardXP,
      });
    }

    return {
      attemptId: attempt.id,
      score,
      correctCount,
      totalQuestions,
      rewardBanh,
      rewardXP,
      isFirstCompletion,
      questionsResult,
    };
  }

  private getVietnamDateKey() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
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

  // ============== ADMIN GRAMMAR APIS (PHASE 4 CMS) ==============
  async createTopic(dto: CreateGrammarTopicDto) {
    return this.prisma.grammarTopic.create({
      data: {
        title: dto.title,
        level: dto.level || 'BEGINNER',
        description: dto.description,
        videoYoutubeId: dto.videoYoutubeId,
        keyFormula: dto.keyFormula,
        order: dto.order || 0,
        publicationStatus: QuizPublicationStatus.DRAFT,
      },
    });
  }

  async updateTopic(id: number, dto: UpdateGrammarTopicDto) {
    const topic = await this.prisma.grammarTopic.findUnique({ where: { id } });
    if (!topic)
      throw new NotFoundException(`Grammar topic with ID ${id} not found`);
    return this.prisma.grammarTopic.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.level !== undefined && { level: dto.level }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.videoYoutubeId !== undefined && {
          videoYoutubeId: dto.videoYoutubeId,
        }),
        ...(dto.keyFormula !== undefined && { keyFormula: dto.keyFormula }),
        ...(dto.order !== undefined && { order: dto.order }),
      },
    });
  }

  async publishTopic(id: number) {
    const topic = await this.prisma.grammarTopic.findUnique({
      where: { id },
      include: { questions: true },
    });
    if (!topic)
      throw new NotFoundException(`Grammar topic with ID ${id} not found`);
    if (!topic.questions || topic.questions.length === 0) {
      throw new BadRequestException(
        'Chủ đề ngữ pháp phải có ít nhất 1 câu hỏi trước khi xuất bản',
      );
    }
    for (const q of topic.questions) {
      if (!q.question?.trim()) {
        throw new BadRequestException(`Câu hỏi ID ${q.id} không có nội dung`);
      }
      const opts = Array.isArray(q.options) ? q.options : [];
      if (opts.length < 2) {
        throw new BadRequestException(
          `Câu hỏi ID ${q.id} phải có ít nhất 2 đáp án lựa chọn`,
        );
      }
      if (q.correctIndex < 0 || q.correctIndex >= opts.length) {
        throw new BadRequestException(
          `Đáp án đúng của câu hỏi ID ${q.id} không hợp lệ`,
        );
      }
    }
    return this.prisma.grammarTopic.update({
      where: { id },
      data: { publicationStatus: QuizPublicationStatus.PUBLISHED },
    });
  }

  async unpublishTopic(id: number) {
    const topic = await this.prisma.grammarTopic.findUnique({ where: { id } });
    if (!topic)
      throw new NotFoundException(`Grammar topic with ID ${id} not found`);
    return this.prisma.grammarTopic.update({
      where: { id },
      data: { publicationStatus: QuizPublicationStatus.DRAFT },
    });
  }

  async deleteTopic(id: number) {
    const topic = await this.prisma.grammarTopic.findUnique({ where: { id } });
    if (!topic)
      throw new NotFoundException(`Grammar topic with ID ${id} not found`);
    // History safety guard
    const hasAttempts = await this.prisma.grammarAttempt.findFirst({
      where: { topicId: id },
    });
    if (hasAttempts) {
      throw new ConflictException(
        'Chủ đề ngữ pháp đã có bài làm của học viên, không thể xóa',
      );
    }
    return this.prisma.grammarTopic.delete({ where: { id } });
  }

  async createQuestion(topicId: number, dto: CreateGrammarQuestionDto) {
    const topic = await this.prisma.grammarTopic.findUnique({
      where: { id: topicId },
    });
    if (!topic)
      throw new NotFoundException(`Grammar topic with ID ${topicId} not found`);
    if (!Array.isArray(dto.options) || dto.options.length < 2) {
      throw new BadRequestException('Câu hỏi phải có ít nhất 2 đáp án');
    }
    if (dto.correctIndex < 0 || dto.correctIndex >= dto.options.length) {
      throw new BadRequestException(
        'Chỉ số đáp án đúng (correctIndex) nằm ngoài danh sách đáp án',
      );
    }
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

  async updateQuestion(
    topicId: number,
    questionId: number,
    dto: UpdateGrammarQuestionDto,
  ) {
    const question = await this.prisma.grammarQuestion.findUnique({
      where: { id: questionId },
    });
    if (!question || question.topicId !== topicId) {
      throw new NotFoundException(
        'Câu hỏi không tồn tại trong chủ đề ngữ pháp này',
      );
    }
    // History safety guard: if attempts exist, block changing options/answers
    const hasAttempts = await this.prisma.grammarAttempt.findFirst({
      where: { topicId },
    });
    if (hasAttempts) {
      throw new ConflictException(
        'Chủ đề ngữ pháp đã có bài làm của học viên, không thể chỉnh sửa cấu trúc câu hỏi',
      );
    }
    const finalOptions = dto.options ?? (question.options as string[]);
    const finalCorrectIndex = dto.correctIndex ?? question.correctIndex;
    if (
      Array.isArray(finalOptions) &&
      (finalCorrectIndex < 0 || finalCorrectIndex >= finalOptions.length)
    ) {
      throw new BadRequestException(
        'Chỉ số đáp án đúng (correctIndex) nằm ngoài danh sách đáp án',
      );
    }
    return this.prisma.grammarQuestion.update({
      where: { id: questionId },
      data: {
        ...(dto.question !== undefined && { question: dto.question }),
        ...(dto.options !== undefined && { options: dto.options }),
        ...(dto.correctIndex !== undefined && {
          correctIndex: dto.correctIndex,
        }),
        ...(dto.explanation !== undefined && { explanation: dto.explanation }),
        ...(dto.order !== undefined && { order: dto.order }),
      },
    });
  }

  async deleteQuestion(topicId: number, questionId: number) {
    const question = await this.prisma.grammarQuestion.findUnique({
      where: { id: questionId },
    });
    if (!question || question.topicId !== topicId) {
      throw new NotFoundException(
        'Câu hỏi không tồn tại trong chủ đề ngữ pháp này',
      );
    }
    // History safety guard
    const hasAttempts = await this.prisma.grammarAttempt.findFirst({
      where: { topicId },
    });
    if (hasAttempts) {
      throw new ConflictException(
        'Chủ đề ngữ pháp đã có bài làm của học viên, không thể xóa câu hỏi',
      );
    }
    return this.prisma.grammarQuestion.delete({ where: { id: questionId } });
  }

  async reorderQuestions(topicId: number, questionIds: number[]) {
    const topic = await this.prisma.grammarTopic.findUnique({
      where: { id: topicId },
      include: { questions: { select: { id: true } } },
    });
    if (!topic)
      throw new NotFoundException(`Grammar topic with ID ${topicId} not found`);
    const existingIds = new Set(topic.questions.map((q) => q.id));
    for (const qid of questionIds) {
      if (!existingIds.has(qid)) {
        throw new BadRequestException(
          `Câu hỏi ID ${qid} không thuộc chủ đề này`,
        );
      }
    }
    await this.prisma.$transaction(
      questionIds.map((id, index) =>
        this.prisma.grammarQuestion.update({
          where: { id },
          data: { order: index },
        }),
      ),
    );
    return { success: true };
  }

  async deleteQuestionById(id: number) {
    const question = await this.prisma.grammarQuestion.findUnique({
      where: { id },
    });
    if (!question) throw new NotFoundException('Câu hỏi không tồn tại');
    return this.deleteQuestion(question.topicId, id);
  }
}
