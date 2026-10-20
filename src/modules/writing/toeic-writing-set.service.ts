import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { QuizPublicationStatus, QuizType } from '@prisma/client';
import { isAcceptedContentImageReference } from '../upload/content-image-validation';
import {
  isToeicWritingTaskKind,
  validateToeicWritingStructure,
} from './toeic-writing-set.contract';
import {
  CreateToeicWritingSetDto,
  CreateToeicWritingSetItemDto,
  UpdateToeicWritingSetDto,
  UpdateToeicWritingSetItemDto,
} from './toeic-writing-set.dto';

type WritingTaskSource = {
  id: number;
  title: string;
  description: string | null;
  type: QuizType;
  publicationStatus: QuizPublicationStatus;
  questions: Array<{ id: number; content: unknown }>;
};

type WritingSetItemRecord = {
  id: number;
  writingSetId: number;
  order: number;
  taskKind: string;
  writingQuizId: number;
  writingQuiz?: WritingTaskSource;
};

type WritingSetRecord = {
  id: number;
  title: string;
  description: string | null;
  publicationStatus: QuizPublicationStatus;
  version: number;
  createdBy: number | null;
  createdAt: Date;
  updatedAt: Date;
  items: WritingSetItemRecord[];
};

type WritingSubmissionRecord = {
  id: number;
  quizId: number;
  score: number | null;
  submittedAt: Date;
  results: Array<{ id: number; score: number | null }>;
};

const PICTURE_TASK_TYPES = new Set(['SENTENCE', 'PICTURE_SENTENCE']);
const REQUEST_TASK_TYPES = new Set([
  'EMAIL',
  'WRITTEN_REQUEST',
  'REQUEST',
  'INFORMATION_REQUEST',
]);
const ESSAY_TASK_TYPES = new Set([
  'OPINION',
  'ESSAY',
  'OPINION_ESSAY',
  'ARGUMENT',
  'PROPOSAL',
  'ANALYTICAL_RESPONSE',
]);

@Injectable()
export class ToeicWritingSetService {
  constructor(private readonly prisma: PrismaService) {}

  // The running owner process may still hold the pre-migration generated
  // client. Runtime uses the generated model after the owner restarts.
  private get db(): any {
    return this.prisma as any;
  }

  async listAdmin() {
    const sets = await this.db.toeicWritingSet.findMany({
      include: {
        items: {
          orderBy: { order: 'asc' },
          include: {
            writingQuiz: {
              select: {
                id: true,
                title: true,
                type: true,
                publicationStatus: true,
                questions: {
                  orderBy: { order: 'asc' },
                  take: 1,
                  select: { id: true, content: true },
                },
              },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return sets.map((set: WritingSetRecord) => this.projectAdminSet(set));
  }

  async getAdmin(id: number) {
    return this.projectAdminSet(await this.findSet(id));
  }

  create(dto: CreateToeicWritingSetDto, createdBy?: number) {
    return this.db.toeicWritingSet.create({
      data: {
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        createdBy,
      },
    });
  }

  async update(id: number, dto: UpdateToeicWritingSetDto) {
    await this.findSet(id);
    return this.db.toeicWritingSet.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title.trim() }),
        ...(dto.description !== undefined && {
          description: dto.description.trim() || null,
        }),
      },
    });
  }

  async addItem(id: number, dto: CreateToeicWritingSetItemDto) {
    const set = await this.findSet(id);
    this.assertDraft(set.publicationStatus);
    const source = await this.findWritingSource(dto.writingQuizId);
    this.assertTaskCompatibility(dto.taskKind, source);
    return this.db.toeicWritingSetItem.create({
      data: {
        writingSetId: id,
        order: dto.order,
        taskKind: dto.taskKind,
        writingQuizId: dto.writingQuizId,
      },
    });
  }

  async updateItem(
    setId: number,
    itemId: number,
    dto: UpdateToeicWritingSetItemDto,
  ) {
    const set = await this.findSet(setId);
    this.assertDraft(set.publicationStatus);
    const item = set.items.find(
      (candidate: WritingSetItemRecord) => candidate.id === itemId,
    );
    if (!item) throw new NotFoundException('Không tìm thấy item Writing');
    const taskKind = dto.taskKind ?? item.taskKind;
    const writingQuizId = dto.writingQuizId ?? item.writingQuizId;
    if (!isToeicWritingTaskKind(taskKind))
      throw new BadRequestException('Task kind TOEIC Writing không hợp lệ');
    const source = await this.findWritingSource(writingQuizId);
    this.assertTaskCompatibility(taskKind, source);
    return this.db.toeicWritingSetItem.update({
      where: { id: itemId },
      data: {
        ...(dto.order !== undefined && { order: dto.order }),
        taskKind,
        writingQuizId,
      },
    });
  }

  async deleteItem(setId: number, itemId: number) {
    const set = await this.findSet(setId);
    this.assertDraft(set.publicationStatus);
    if (!set.items.some((item: WritingSetItemRecord) => item.id === itemId))
      throw new NotFoundException('Không tìm thấy item Writing');
    return this.db.toeicWritingSetItem.delete({ where: { id: itemId } });
  }

  async publish(id: number) {
    const set = await this.findSet(id);
    const readiness = await this.getReadiness(set);
    if (!readiness.valid) {
      throw new BadRequestException({
        message: 'TOEIC Writing Set chưa đủ điều kiện xuất bản',
        issues: readiness.issues,
      });
    }
    return this.db.toeicWritingSet.update({
      where: { id },
      data: { publicationStatus: QuizPublicationStatus.PUBLISHED },
    });
  }

  async unpublish(id: number) {
    await this.findSet(id);
    return this.db.toeicWritingSet.update({
      where: { id },
      data: { publicationStatus: QuizPublicationStatus.DRAFT },
    });
  }

  async getLearnerDetail(id: number) {
    const set = await this.db.toeicWritingSet.findFirst({
      where: { id, publicationStatus: QuizPublicationStatus.PUBLISHED },
      include: {
        items: {
          orderBy: { order: 'asc' },
          include: {
            writingQuiz: {
              select: {
                id: true,
                title: true,
                description: true,
                type: true,
                questions: {
                  orderBy: { order: 'asc' },
                  take: 1,
                  select: { id: true, content: true },
                },
              },
            },
          },
        },
      },
    });
    if (!set) throw new NotFoundException('TOEIC Writing Set không tồn tại');
    return {
      id: set.id,
      title: set.title,
      description: set.description,
      version: set.version,
      items: set.items.map((item: WritingSetItemRecord) => {
        if (!item.writingQuiz)
          throw new NotFoundException('Writing task của item không tồn tại');
        return {
          id: item.id,
          order: item.order,
          taskKind: item.taskKind,
          writingQuizId: item.writingQuiz.id,
          task: this.safeTaskMetadata(item.writingQuiz),
        };
      }),
      structure: validateToeicWritingStructure(set.items),
    };
  }

  async getCompletion(id: number, userId: number) {
    const set = await this.getPublishedSetForCompletion(id);
    const submissions = (await this.db.submission.findMany({
      where: {
        userId,
        quizId: {
          in: set.items.map((item: WritingSetItemRecord) => item.writingQuizId),
        },
      },
      orderBy: { submittedAt: 'desc' },
      select: {
        id: true,
        quizId: true,
        score: true,
        submittedAt: true,
        results: { select: { id: true, score: true } },
      },
    })) as WritingSubmissionRecord[];
    const latest = new Map<number, WritingSubmissionRecord>();
    for (const submission of submissions) {
      if (!latest.has(submission.quizId))
        latest.set(submission.quizId, submission);
    }
    const items = set.items.map((item: WritingSetItemRecord) => {
      const submission = latest.get(item.writingQuizId);
      const completed = Boolean(
        submission &&
        (submission.score !== null ||
          submission.results.some(
            (result: { id: number; score: number | null }) =>
              result.score !== null,
          )),
      );
      return {
        itemId: item.id,
        order: item.order,
        taskKind: item.taskKind,
        writingQuizId: item.writingQuizId,
        completed,
        submissionId: completed ? (submission?.id ?? null) : null,
      };
    });
    return {
      writingSetId: set.id,
      completed:
        items.length === 8 &&
        items.every((item: { completed: boolean }) => item.completed),
      completedCount: items.filter(
        (item: { completed: boolean }) => item.completed,
      ).length,
      totalCount: items.length,
      items,
    };
  }

  private async getPublishedSetForCompletion(
    id: number,
  ): Promise<WritingSetRecord> {
    const set = await this.db.toeicWritingSet.findFirst({
      where: { id, publicationStatus: QuizPublicationStatus.PUBLISHED },
      include: { items: { orderBy: { order: 'asc' } } },
    });
    if (!set) throw new NotFoundException('TOEIC Writing Set không tồn tại');
    return set as WritingSetRecord;
  }

  private async findSet(id: number): Promise<WritingSetRecord> {
    const set = await this.db.toeicWritingSet.findUnique({
      where: { id },
      include: {
        items: {
          orderBy: { order: 'asc' },
          include: {
            writingQuiz: {
              select: {
                id: true,
                title: true,
                description: true,
                type: true,
                publicationStatus: true,
                questions: {
                  orderBy: { order: 'asc' },
                  take: 1,
                  select: { id: true, content: true },
                },
              },
            },
          },
        },
      },
    });
    if (!set) throw new NotFoundException('TOEIC Writing Set không tồn tại');
    return set as WritingSetRecord;
  }

  private async findWritingSource(id: number): Promise<WritingTaskSource> {
    const source = await this.db.quiz.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        description: true,
        type: true,
        publicationStatus: true,
        questions: {
          orderBy: { order: 'asc' },
          select: { id: true, content: true },
        },
      },
    });
    if (!source) throw new NotFoundException('Không tìm thấy bài Writing');
    return source;
  }

  private assertDraft(status: QuizPublicationStatus) {
    if (status === QuizPublicationStatus.PUBLISHED)
      throw new ConflictException(
        'Không thể sửa cấu trúc TOEIC Writing Set đã xuất bản',
      );
  }

  private assertTaskCompatibility(taskKind: string, source: WritingTaskSource) {
    if (!isToeicWritingTaskKind(taskKind))
      throw new BadRequestException('Task kind TOEIC Writing không hợp lệ');
    if (source.questions.length !== 1) {
      throw new BadRequestException(
        'Mỗi item TOEIC Writing phải tham chiếu đúng một Writing task',
      );
    }
    const content = this.contentOf(source);
    const sourceTaskType = String(content.taskType ?? '').toUpperCase();
    const compatible =
      taskKind === 'PICTURE_SENTENCE'
        ? source.type === QuizType.WRITING_PICTURE &&
          isAcceptedContentImageReference(content.imageUrl) &&
          PICTURE_TASK_TYPES.has(sourceTaskType)
        : taskKind === 'WRITTEN_REQUEST'
          ? source.type === QuizType.WRITING_EMAIL &&
            REQUEST_TASK_TYPES.has(sourceTaskType)
          : source.type === QuizType.WRITING_EMAIL &&
            ESSAY_TASK_TYPES.has(sourceTaskType);
    if (!compatible) {
      throw new BadRequestException(
        `Bài Writing #${source.id} không tương thích với slot ${taskKind}`,
      );
    }
  }

  private async getReadiness(set: Awaited<ReturnType<typeof this.findSet>>) {
    const structure = validateToeicWritingStructure(set.items);
    if (!structure.valid) {
      return {
        valid: false,
        issues: structure.issues,
        structure,
        sourceStatuses: [],
      };
    }
    const sourceIssues: string[] = [];
    const sourceStatuses = await Promise.all(
      set.items.map(async (item: WritingSetItemRecord) => {
        try {
          const source = await this.findWritingSource(item.writingQuizId);
          this.assertTaskCompatibility(item.taskKind, source);
          if (source.publicationStatus !== QuizPublicationStatus.PUBLISHED) {
            sourceIssues.push(
              `Item ${item.order}: bài Writing #${source.id} chưa Published`,
            );
            return 'DRAFT';
          }
          return 'READY';
        } catch (error) {
          sourceIssues.push(
            `Item ${item.order}: ${error instanceof Error ? error.message : 'source không hợp lệ'}`,
          );
          return 'INVALID';
        }
      }),
    );
    return {
      valid: structure.valid && sourceIssues.length === 0,
      issues: [...structure.issues, ...sourceIssues],
      structure,
      sourceStatuses,
    };
  }

  private projectAdminSet(set: any) {
    const structure = validateToeicWritingStructure(set.items);
    return {
      id: set.id,
      title: set.title,
      description: set.description,
      publicationStatus: set.publicationStatus,
      version: set.version,
      createdBy: set.createdBy,
      createdAt: set.createdAt,
      updatedAt: set.updatedAt,
      items: set.items.map((item: any) => ({
        id: item.id,
        order: item.order,
        taskKind: item.taskKind,
        writingQuizId: item.writingQuizId,
        source: item.writingQuiz
          ? this.safeTaskMetadata(item.writingQuiz)
          : null,
      })),
      structure,
    };
  }

  private safeTaskMetadata(source: {
    id: number;
    title: string;
    description?: string | null;
    type: QuizType;
    publicationStatus?: QuizPublicationStatus;
    questions: Array<{ id: number; content: unknown }>;
  }) {
    const content = this.contentOf(source);
    return {
      id: source.id,
      title: source.title,
      description: source.description ?? null,
      type: source.type,
      publicationStatus: source.publicationStatus,
      questionId: source.questions[0]?.id ?? null,
      taskType: content.taskType ?? null,
      imageUrl: content.imageUrl ?? null,
      prompt: content.prompt ?? null,
    };
  }

  private contentOf(source: { questions: Array<{ content: unknown }> }) {
    const content = source.questions[0]?.content;
    return content && typeof content === 'object' && !Array.isArray(content)
      ? (content as Record<string, unknown>)
      : {};
  }
}
