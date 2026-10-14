import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { QuizPublicationStatus } from '@prisma/client';
import { validateToeicExam } from './toeic.validation';
import {
  CreateExamSetDto,
  UpdateExamSetDto,
  CreateExamGroupDto,
  UpdateExamGroupDto,
  CreateExamQuestionDto,
  UpdateExamQuestionDto,
} from './dto';

@Injectable()
export class AdminExamService {
  constructor(private readonly prisma: PrismaService) {}

  async getExams() {
    const exams = await this.prisma.toeicExamSet.findMany({
      include: {
        groups: {
          include: { questions: true },
          orderBy: { groupOrder: 'asc' },
        },
        _count: {
          select: { attempts: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return exams.map((exam) => {
      const validation = validateToeicExam(exam);
      const totalQuestions = exam.groups.reduce(
        (sum, g) => sum + g.questions.length,
        0,
      );
      return {
        id: exam.id,
        title: exam.title,
        description: exam.description,
        type: exam.type,
        difficulty: exam.difficulty,
        durationSeconds: exam.durationSeconds,
        publicationStatus: exam.publicationStatus,
        createdAt: exam.createdAt,
        updatedAt: exam.updatedAt,
        totalGroups: exam.groups.length,
        totalQuestions,
        attemptsCount: exam._count.attempts,
        learnerReady: validation.learnerReady,
        issuesCount: validation.issues.length,
        validation: { counts: validation.counts, issues: validation.issues },
      };
    });
  }

  async getExamDetail(id: number) {
    const exam = await this.prisma.toeicExamSet.findUnique({
      where: { id },
      include: {
        groups: {
          include: {
            questions: {
              orderBy: { questionNumber: 'asc' },
            },
          },
          orderBy: { groupOrder: 'asc' },
        },
        _count: {
          select: { attempts: true },
        },
      },
    });

    if (!exam) {
      throw new NotFoundException(`Đề thi với ID ${id} không tồn tại`);
    }

    const validation = validateToeicExam(exam);
    const totalQuestions = exam.groups.reduce(
      (sum, g) => sum + g.questions.length,
      0,
    );

    return {
      ...exam,
      totalGroups: exam.groups.length,
      totalQuestions,
      attemptsCount: exam._count.attempts,
      learnerReady: validation.learnerReady,
      validation,
    };
  }

  async createExam(dto: CreateExamSetDto, createdBy?: number) {
    return this.prisma.toeicExamSet.create({
      data: {
        title: dto.title,
        description: dto.description,
        type: dto.type,
        difficulty: dto.difficulty || 'medium',
        durationSeconds: dto.durationSeconds ?? 7200,
        createdBy,
        publicationStatus: QuizPublicationStatus.DRAFT,
      },
    });
  }

  async updateExam(id: number, dto: UpdateExamSetDto) {
    const exam = await this.prisma.toeicExamSet.findUnique({ where: { id } });
    if (!exam) throw new NotFoundException(`Đề thi với ID ${id} không tồn tại`);

    return this.prisma.toeicExamSet.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.difficulty !== undefined && { difficulty: dto.difficulty }),
        ...(dto.durationSeconds !== undefined && {
          durationSeconds: dto.durationSeconds,
        }),
      },
    });
  }

  async publishExam(id: number) {
    const exam = await this.prisma.toeicExamSet.findUnique({
      where: { id },
      include: {
        groups: {
          include: { questions: true },
          orderBy: { groupOrder: 'asc' },
        },
      },
    });

    if (!exam) throw new NotFoundException(`Đề thi với ID ${id} không tồn tại`);

    const groups = exam.groups ?? [];
    const questions = groups.flatMap((g) => g.questions ?? []);
    if (questions.length === 0) {
      throw new BadRequestException('Đề thi phải có ít nhất 1 câu hỏi để xuất bản');
    }

    const validation = validateToeicExam(exam);
    if (exam.type === 'FULL_TEST' && !validation.learnerReady) {
      throw new BadRequestException({
        message: 'Đề Full Test chưa đủ điều kiện xuất bản (cần 200 câu theo chuẩn cấu trúc TOEIC)',
        issues: validation.issues,
      });
    }

    if (validation.issues.length > 0) {
      throw new BadRequestException({
        message: 'Đề thi chưa đủ điều kiện xuất bản cho học viên',
        issues: validation.issues,
      });
    }

    return this.prisma.toeicExamSet.update({
      where: { id },
      data: { publicationStatus: QuizPublicationStatus.PUBLISHED },
    });
  }

  async unpublishExam(id: number) {
    const exam = await this.prisma.toeicExamSet.findUnique({ where: { id } });
    if (!exam) throw new NotFoundException(`Đề thi với ID ${id} không tồn tại`);

    return this.prisma.toeicExamSet.update({
      where: { id },
      data: { publicationStatus: QuizPublicationStatus.DRAFT },
    });
  }

  async deleteExam(id: number) {
    const exam = await this.prisma.toeicExamSet.findUnique({ where: { id } });
    if (!exam) throw new NotFoundException(`Đề thi với ID ${id} không tồn tại`);

    // History safety guard: cannot delete exam if attempts exist
    const hasAttempts = await this.prisma.toeicAttempt.findFirst({
      where: { examId: id },
    });
    if (hasAttempts) {
      throw new ConflictException(
        'Bộ đề thi đã có lượt làm bài của học viên, không thể xóa',
      );
    }

    return this.prisma.toeicExamSet.delete({ where: { id } });
  }

  // ============== GROUP MANAGEMENT ==============
  async addGroup(examId: number, dto: CreateExamGroupDto) {
    const exam = await this.prisma.toeicExamSet.findUnique({
      where: { id: examId },
    });
    if (!exam)
      throw new NotFoundException(`Đề thi với ID ${examId} không tồn tại`);

    // History guard: if attempts exist, block modifying exam structure
    const hasAttempts = await this.prisma.toeicAttempt.findFirst({
      where: { examId },
    });
    if (hasAttempts) {
      throw new ConflictException(
        'Bộ đề thi đã có lượt làm bài của học viên, không thể thêm nhóm câu hỏi mới',
      );
    }

    return this.prisma.toeicQuestionGroup.create({
      data: {
        examId,
        part: dto.part,
        canonicalAccent: dto.canonicalAccent || 'US',
        audioUrl: dto.audioUrl,
        imageUrl: dto.imageUrl,
        passageText: dto.passageText,
        groupOrder: dto.groupOrder ?? 0,
      },
    });
  }

  async updateGroup(
    examId: number,
    groupId: number,
    dto: UpdateExamGroupDto,
  ) {
    const group = await this.prisma.toeicQuestionGroup.findUnique({
      where: { id: groupId },
    });
    if (!group || group.examId !== examId) {
      throw new NotFoundException(
        'Nhóm câu hỏi không tồn tại trong bộ đề thi này',
      );
    }

    // History guard: if attempts exist, block structural changes
    const hasAttempts = await this.prisma.toeicAttempt.findFirst({
      where: { examId },
    });
    if (hasAttempts) {
      throw new ConflictException(
        'Bộ đề thi đã có lượt làm bài của học viên, không thể sửa nhóm câu hỏi',
      );
    }

    return this.prisma.toeicQuestionGroup.update({
      where: { id: groupId },
      data: {
        ...(dto.part !== undefined && { part: dto.part }),
        ...(dto.canonicalAccent !== undefined && {
          canonicalAccent: dto.canonicalAccent,
        }),
        ...(dto.audioUrl !== undefined && { audioUrl: dto.audioUrl }),
        ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl }),
        ...(dto.passageText !== undefined && {
          passageText: dto.passageText,
        }),
        ...(dto.groupOrder !== undefined && {
          groupOrder: dto.groupOrder,
        }),
      },
    });
  }

  async deleteGroup(examId: number, groupId: number) {
    const group = await this.prisma.toeicQuestionGroup.findUnique({
      where: { id: groupId },
    });
    if (!group || group.examId !== examId) {
      throw new NotFoundException(
        'Nhóm câu hỏi không tồn tại trong bộ đề thi này',
      );
    }

    // History guard
    const hasAttempts = await this.prisma.toeicAttempt.findFirst({
      where: { examId },
    });
    if (hasAttempts) {
      throw new ConflictException(
        'Bộ đề thi đã có lượt làm bài của học viên, không thể xóa nhóm câu hỏi',
      );
    }

    return this.prisma.toeicQuestionGroup.delete({ where: { id: groupId } });
  }

  async reorderGroups(examId: number, groupIds: number[]) {
    const exam = await this.prisma.toeicExamSet.findUnique({
      where: { id: examId },
      include: { groups: { select: { id: true } } },
    });
    if (!exam)
      throw new NotFoundException(`Đề thi với ID ${examId} không tồn tại`);

    const existingIds = new Set(exam.groups.map((g) => g.id));
    for (const gid of groupIds) {
      if (!existingIds.has(gid)) {
        throw new BadRequestException(
          `Nhóm câu hỏi ID ${gid} không thuộc bộ đề thi này`,
        );
      }
    }

    await this.prisma.$transaction(
      groupIds.map((id, index) =>
        this.prisma.toeicQuestionGroup.update({
          where: { id },
          data: { groupOrder: index },
        }),
      ),
    );
    return { success: true };
  }

  // ============== QUESTION MANAGEMENT ==============
  async addQuestion(
    examId: number,
    groupId: number,
    dto: CreateExamQuestionDto,
  ) {
    const group = await this.prisma.toeicQuestionGroup.findUnique({
      where: { id: groupId },
    });
    if (!group || group.examId !== examId) {
      throw new NotFoundException(
        'Nhóm câu hỏi không tồn tại trong bộ đề thi này',
      );
    }

    // History guard
    const hasAttempts = await this.prisma.toeicAttempt.findFirst({
      where: { examId },
    });
    if (hasAttempts) {
      throw new ConflictException(
        'Bộ đề thi đã có lượt làm bài của học viên, không thể thêm câu hỏi mới',
      );
    }

    const expectedOptions = group.part === 2 ? 3 : 4;
    if (!Array.isArray(dto.options) || dto.options.length < expectedOptions) {
      throw new BadRequestException(
        `Part ${group.part} yêu cầu ít nhất ${expectedOptions} đáp án lựa chọn`,
      );
    }

    if (dto.correctIndex < 0 || dto.correctIndex >= dto.options.length) {
      throw new BadRequestException(
        'Chỉ số đáp án đúng (correctIndex) nằm ngoài danh sách đáp án',
      );
    }

    return this.prisma.toeicQuestion.create({
      data: {
        groupId,
        questionNumber: dto.questionNumber,
        text: dto.text,
        options: dto.options,
        correctIndex: dto.correctIndex,
        explanation: dto.explanation,
      },
    });
  }

  async updateQuestion(
    examId: number,
    groupId: number,
    questionId: number,
    dto: UpdateExamQuestionDto,
  ) {
    const question = await this.prisma.toeicQuestion.findUnique({
      where: { id: questionId },
      include: { group: true },
    });

    if (
      !question ||
      question.groupId !== groupId ||
      question.group.examId !== examId
    ) {
      throw new NotFoundException(
        'Câu hỏi không tồn tại trong nhóm và đề thi này',
      );
    }

    // History guard
    const hasAttempts = await this.prisma.toeicAttempt.findFirst({
      where: { examId },
    });
    if (hasAttempts) {
      throw new ConflictException(
        'Bộ đề thi đã có lượt làm bài của học viên, không thể chỉnh sửa câu hỏi',
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

    return this.prisma.toeicQuestion.update({
      where: { id: questionId },
      data: {
        ...(dto.questionNumber !== undefined && {
          questionNumber: dto.questionNumber,
        }),
        ...(dto.text !== undefined && { text: dto.text }),
        ...(dto.options !== undefined && { options: dto.options }),
        ...(dto.correctIndex !== undefined && {
          correctIndex: dto.correctIndex,
        }),
        ...(dto.explanation !== undefined && {
          explanation: dto.explanation,
        }),
      },
    });
  }

  async deleteQuestion(
    examId: number,
    groupId: number,
    questionId: number,
  ) {
    const question = await this.prisma.toeicQuestion.findUnique({
      where: { id: questionId },
      include: { group: true },
    });

    if (
      !question ||
      question.groupId !== groupId ||
      question.group.examId !== examId
    ) {
      throw new NotFoundException(
        'Câu hỏi không tồn tại trong nhóm và đề thi này',
      );
    }

    // History guard
    const hasAttempts = await this.prisma.toeicAttempt.findFirst({
      where: { examId },
    });
    if (hasAttempts) {
      throw new ConflictException(
        'Bộ đề thi đã có lượt làm bài của học viên, không thể xóa câu hỏi',
      );
    }

    return this.prisma.toeicQuestion.delete({ where: { id: questionId } });
  }
}
