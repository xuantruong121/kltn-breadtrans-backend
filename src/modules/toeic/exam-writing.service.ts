import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, QuizPublicationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isAcceptedContentImageReference } from '../upload/content-image-validation';
import { validateToeicWritingStructure } from '../writing/toeic-writing-set.contract';
import {
  examWritingContent,
  examWritingProblem,
  examWritingSlot,
  type ExamWritingInput,
} from './exam-writing.logic';
import { GenericExamService } from './generic-exam.service';

const SLOT_COUNT = 8;

/**
 * The Writing section of one exam. Its tasks are created here and belong to
 * that exam, so a skill practice can never end up inside an exam.
 */
@Injectable()
export class ExamWritingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly exams: GenericExamService,
  ) {}

  private setInclude = {
    items: {
      orderBy: { order: 'asc' as const },
      include: {
        writingQuiz: {
          include: { questions: { orderBy: { order: 'asc' as const } } },
        },
      },
    },
  };

  private async context(examId: number) {
    const exam = await this.prisma.exam.findUnique({
      where: { id: examId },
      select: {
        id: true,
        publicationStatus: true,
        toeicAssessment: {
          select: {
            components: {
              where: { kind: 'WRITING' },
              select: { writingSetId: true },
            },
          },
        },
      },
    });
    if (!exam) throw new NotFoundException(`Exam ${examId} không tồn tại`);
    const setId = exam.toeicAssessment?.components[0]?.writingSetId;
    if (!setId)
      throw new BadRequestException('Đề này không có phần Writing riêng');
    const set = await this.prisma.toeicWritingSet.findUnique({
      where: { id: setId },
      include: this.setInclude,
    });
    if (!set) throw new NotFoundException('Không tìm thấy phần Writing của đề');
    return { exam, set };
  }

  private assertEditable(exam: { publicationStatus: QuizPublicationStatus }) {
    if (exam.publicationStatus !== QuizPublicationStatus.DRAFT)
      throw new ConflictException(
        'Chỉ sửa được Writing khi đề là bản nháp; đề đã xuất bản hãy nhân bản để sửa.',
      );
  }

  async get(examId: number) {
    const { exam, set } = await this.context(examId);
    const slots = Array.from({ length: SLOT_COUNT }, (_, index) => {
      const slot = examWritingSlot(index + 1)!;
      const item = set.items.find((row) => row.order === slot.order);
      const content = (item?.writingQuiz.questions[0]?.content ?? {}) as {
        prompt?: string;
        email?: string;
        imageUrl?: string;
        keywords?: string[];
      };
      return {
        order: slot.order,
        taskKind: slot.taskKind,
        filled: Boolean(item),
        title: item?.writingQuiz.title ?? '',
        prompt: content.prompt ?? '',
        email: content.email ?? '',
        imageUrl: content.imageUrl ?? '',
        keywords: content.keywords ?? [],
      };
    });
    return {
      setId: set.id,
      publicationStatus: set.publicationStatus,
      editable: exam.publicationStatus === QuizPublicationStatus.DRAFT,
      slots,
    };
  }

  async saveSlot(examId: number, order: number, input: ExamWritingInput) {
    const { exam, set } = await this.context(examId);
    this.assertEditable(exam);
    const slot = examWritingSlot(order);
    if (!slot) throw new BadRequestException('Writing chỉ có 8 câu');
    const problem = examWritingProblem(slot.taskKind, input);
    if (problem) throw new BadRequestException(problem);
    const item = set.items.find((row) => row.order === order);
    const question = item?.writingQuiz.questions[0];
    const title = input.title.trim();

    if (item && question) {
      const content = examWritingContent(
        slot.taskKind,
        input,
        question.content as Record<string, unknown>,
      );
      await this.prisma.$transaction([
        this.prisma.quiz.update({
          where: { id: item.writingQuizId },
          data: { title },
        }),
        this.prisma.question.update({
          where: { id: question.id },
          data: { content: content as Prisma.InputJsonValue },
        }),
      ]);
      return this.get(examId);
    }

    await this.prisma.$transaction(async (tx) => {
      const quiz = await tx.quiz.create({
        data: {
          title,
          type: slot.quizType,
          publicationStatus: QuizPublicationStatus.DRAFT,
          questions: {
            create: {
              type: 'WRITING',
              order: 0,
              content: examWritingContent(
                slot.taskKind,
                input,
              ) as Prisma.InputJsonValue,
            },
          },
        },
      });
      await tx.toeicWritingSetItem.create({
        data: {
          writingSetId: set.id,
          order,
          taskKind: slot.taskKind,
          writingQuizId: quiz.id,
        },
      });
    });
    return this.get(examId);
  }

  async publish(examId: number) {
    const { exam, set } = await this.context(examId);
    this.assertEditable(exam);
    const structure = validateToeicWritingStructure(set.items);
    if (!structure.valid)
      throw new BadRequestException({
        message: 'Writing của đề chưa đủ 8 câu đúng dạng',
        issues: structure.issues,
      });
    const missing = set.items.filter(
      (item) =>
        item.taskKind === 'PICTURE_SENTENCE' &&
        !isAcceptedContentImageReference(
          (item.writingQuiz.questions[0]?.content as { imageUrl?: unknown })
            ?.imageUrl,
        ),
    );
    if (missing.length)
      throw new BadRequestException(
        `Câu ${missing.map((item) => item.order).join(', ')} chưa có ảnh hợp lệ`,
      );
    await this.prisma.$transaction([
      this.prisma.quiz.updateMany({
        where: { id: { in: set.items.map((item) => item.writingQuizId) } },
        data: { publicationStatus: QuizPublicationStatus.PUBLISHED },
      }),
      this.prisma.toeicWritingSet.update({
        where: { id: set.id },
        data: { publicationStatus: QuizPublicationStatus.PUBLISHED },
      }),
    ]);
    return this.exams.getAdmin(examId);
  }
}
