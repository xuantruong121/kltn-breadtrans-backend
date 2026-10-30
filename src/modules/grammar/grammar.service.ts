import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, QuizPublicationStatus, Role } from '@prisma/client';
import { GamificationService } from '../gamification/gamification.service';
import {
  CreateGrammarTopicDto,
  UpdateGrammarTopicDto,
  CreateGrammarQuestionDto,
  UpdateGrammarQuestionDto,
} from './dto';
import { ListQuery, pageOf, wantsPage } from '../../common/paging/list-page';
import {
  filterGrammarTopics,
  grammarTopicFacets,
  normalizeOptionExplanations,
  questionProblems,
} from './grammar-question.logic';

@Injectable()
export class GrammarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly gamificationService: GamificationService,
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

    // Staff see whether learners already answered this topic: the graded
    // parts of its questions are then locked.
    const learnerAttemptCount = isStaff ? await this.learnerAttempts(id) : 0;
    return {
      ...topic,
      questions: sanitizedQuestions,
      latestAttempt,
      ...(isStaff && {
        learnerAttemptCount,
        locked: learnerAttemptCount > 0,
      }),
    };
  }

  /** Attempts by learners; an admin trying a topic does not lock it. */
  private learnerAttempts(topicId: number) {
    return this.prisma.grammarAttempt.count({
      where: { topicId, user: { role: Role.STUDENT } },
    });
  }

  /** The admin topic list: all, or with `query.page` one filtered page. */
  async getAdminTopics(query: ListQuery = {}) {
    const [topics, attempts] = await Promise.all([
      this.prisma.grammarTopic.findMany({
        include: { _count: { select: { questions: true } } },
        orderBy: { id: 'desc' },
      }),
      this.prisma.grammarAttempt.groupBy({
        by: ['topicId'],
        where: { user: { role: Role.STUDENT } },
        _count: { _all: true },
      }),
    ]);
    const attemptsByTopic = new Map(
      attempts.map((row) => [row.topicId, row._count._all]),
    );
    const rows = topics.map(({ _count, ...topic }) => ({
      ...topic,
      totalQuestions: _count.questions,
      learnerAttemptCount: attemptsByTopic.get(topic.id) ?? 0,
    }));
    if (!wantsPage(query)) return rows;
    return {
      ...pageOf(filterGrammarTopics(rows, query), query),
      facets: grammarTopicFacets(rows),
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
        optionExplanations: q.optionExplanations ?? null,
      };
    });

    const totalQuestions = topic.questions.length || 1;
    const score = Math.round((correctCount / totalQuestions) * 100);

    const rewardBanh = 0;
    const rewardXP = 0;
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
        // Owner policy: grammar outside the four skill-practice pages earns
        // no Bánh mì or XP; the first completion is still recorded.
      }

      return created;
    });

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
    const ordered = [...topic.questions].sort((a, b) => a.order - b.order);
    ordered.forEach((q, index) => {
      const problems = questionProblems(q);
      if (problems.length)
        throw new BadRequestException(
          `Câu ${index + 1}: ${problems.join('; ')}`,
        );
    });
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
    if (await this.learnerAttempts(id)) {
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
    const problems = questionProblems(dto);
    if (problems.length) throw new BadRequestException(problems.join('; '));
    return this.prisma.grammarQuestion.create({
      data: this.questionData(topicId, dto, dto.order || 0),
    });
  }

  /**
   * Adds several questions after the last one, all or nothing: one invalid
   * question rejects the batch and names it, so a paste or AI batch never
   * lands half-way.
   */
  async createQuestions(topicId: number, dtos: CreateGrammarQuestionDto[]) {
    const topic = await this.prisma.grammarTopic.findUnique({
      where: { id: topicId },
    });
    if (!topic)
      throw new NotFoundException(`Grammar topic with ID ${topicId} not found`);
    if (!dtos.length) throw new BadRequestException('Chưa có câu hỏi nào');
    const errors = dtos
      .map((dto, index) => ({ index, problems: questionProblems(dto) }))
      .filter((row) => row.problems.length);
    if (errors.length)
      throw new BadRequestException({
        message: errors
          .map((row) => `Câu ${row.index + 1}: ${row.problems.join('; ')}`)
          .join(' | '),
        errors,
      });
    const last = await this.prisma.grammarQuestion.aggregate({
      where: { topicId },
      _max: { order: true },
    });
    const start = (last._max.order ?? -1) + 1;
    return this.prisma.$transaction(
      dtos.map((dto, index) =>
        this.prisma.grammarQuestion.create({
          data: this.questionData(topicId, dto, start + index),
        }),
      ),
    );
  }

  private questionData(
    topicId: number,
    dto: CreateGrammarQuestionDto,
    order: number,
  ): Prisma.GrammarQuestionUncheckedCreateInput {
    const notes = normalizeOptionExplanations(
      dto.optionExplanations,
      dto.correctIndex,
    );
    return {
      topicId,
      question: dto.question.trim(),
      options: dto.options.map((option) => String(option).trim()),
      correctIndex: dto.correctIndex,
      explanation: dto.explanation?.trim() || null,
      optionExplanations: notes ?? Prisma.DbNull,
      order,
    };
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
    // History safety guard: once learners attempted the topic, the prompt,
    // options and answer stay as graded; the explanation may still be fixed.
    const changesGradedContent =
      (dto.question !== undefined && dto.question !== question.question) ||
      (dto.options !== undefined &&
        JSON.stringify(dto.options) !== JSON.stringify(question.options)) ||
      (dto.correctIndex !== undefined &&
        dto.correctIndex !== question.correctIndex);
    if (changesGradedContent && (await this.learnerAttempts(topicId))) {
      throw new ConflictException(
        'Chủ đề ngữ pháp đã có bài làm của học viên, không thể chỉnh sửa cấu trúc câu hỏi',
      );
    }
    const final = {
      question: dto.question ?? question.question,
      options: dto.options ?? question.options,
      correctIndex: dto.correctIndex ?? question.correctIndex,
      optionExplanations:
        dto.optionExplanations !== undefined
          ? dto.optionExplanations
          : question.optionExplanations,
    };
    const problems = questionProblems(final);
    if (problems.length) throw new BadRequestException(problems.join('; '));
    // The why-wrong notes follow the answer: re-aligned whenever either changes.
    const touchesNotes =
      dto.optionExplanations !== undefined || dto.correctIndex !== undefined;
    const notes = normalizeOptionExplanations(
      final.optionExplanations,
      final.correctIndex,
    );
    return this.prisma.grammarQuestion.update({
      where: { id: questionId },
      data: {
        ...(dto.question !== undefined && { question: dto.question.trim() }),
        ...(dto.options !== undefined && {
          options: dto.options.map((option) => String(option).trim()),
        }),
        ...(dto.correctIndex !== undefined && {
          correctIndex: dto.correctIndex,
        }),
        ...(dto.explanation !== undefined && {
          explanation: dto.explanation.trim() || null,
        }),
        ...(touchesNotes && { optionExplanations: notes ?? Prisma.DbNull }),
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
    if (await this.learnerAttempts(topicId)) {
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
