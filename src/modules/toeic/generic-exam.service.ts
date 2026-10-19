import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  QuizPublicationStatus,
  SpeakingPracticeScope,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { validateToeicExam } from './toeic.validation';
import {
  EXAM_TEMPLATES,
  ExamTemplate,
  resolveExamTemplate,
  resolveTemplateByKey,
} from './exam-template.registry';
import { CreateGenericExamDto, UpdateGenericExamDto } from './generic-exam.dto';
import {
  TOEIC_SPEAKING_TASK_SEQUENCE,
  toeicSpeakingContractErrors,
} from '../speaking/toeic-speaking-contract';
import { SkillCmsService } from '../content/skill-cms.service';
import {
  SpeakingExerciseDto,
  SpeakingExerciseReorderDto,
} from '../content/skill-cms.dto';
import { SpeakingStimulusDto } from '../content/speaking-stimulus.dto';

type ProductRecord = any;

@Injectable()
export class GenericExamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly skillCms: SkillCmsService,
  ) {}

  listTemplates() {
    return EXAM_TEMPLATES.map(
      ({
        key,
        familyCode,
        variantCode,
        displayName,
        authoringEnabled,
        sections,
      }) => ({
        key,
        familyCode,
        variantCode,
        displayName,
        authoringEnabled,
        sections,
      }),
    );
  }

  private include = {
    toeicExamSet: {
      include: {
        groups: {
          include: { questions: true },
          orderBy: { groupOrder: 'asc' },
        },
        _count: { select: { attempts: true } },
      },
    },
    toeicAssessment: {
      include: {
        components: {
          orderBy: { order: 'asc' },
          include: {
            lrExamSet: {
              include: { groups: { include: { questions: true } } },
            },
            speakingPracticeSet: {
              include: { exercises: { include: { stimulus: true } } },
            },
            writingSet: {
              include: { items: { include: { writingQuiz: true } } },
            },
          },
        },
        _count: { select: { attempts: true } },
      },
    },
  } satisfies Prisma.ExamInclude;

  private resolveRequestedVariant(dto: CreateGenericExamDto) {
    const familyCode = (dto.familyCode ?? dto.family ?? 'TOEIC').toUpperCase();
    const variantCode = (
      dto.variantCode ??
      dto.variant ??
      (dto.type === 'FULL_TEST' || dto.type === 'PRACTICE_BY_PART'
        ? 'TOEIC_LR'
        : undefined) ??
      'TOEIC_LR'
    ).toUpperCase();
    return { familyCode, variantCode };
  }

  private async findExam(id: number) {
    const exam = await this.prisma.exam.findUnique({
      where: { id },
      include: this.include,
    });
    if (!exam) throw new NotFoundException(`Exam với ID ${id} không tồn tại`);
    return exam as ProductRecord;
  }

  async resolveToeicExamId(id: number) {
    const root = await this.prisma.exam.findUnique({
      where: { id },
      select: { toeicExamSet: { select: { id: true } } },
    });
    if (root?.toeicExamSet) return root.toeicExamSet.id;
    const direct = await this.prisma.toeicExamSet.findUnique({
      where: { id },
      select: { id: true },
    });
    if (direct) return direct.id;
    throw new NotFoundException(`Đề TOEIC với ID ${id} không tồn tại`);
  }

  private speakingReady(source: any, template: ExamTemplate) {
    const tasks =
      template.sections.find((section) => section.code === 'SPEAKING')?.tasks ??
      TOEIC_SPEAKING_TASK_SEQUENCE;
    const exercises = [...(source?.exercises ?? [])].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0),
    );
    if (
      !source ||
      source.scope !== SpeakingPracticeScope.EXAM_INTERNAL ||
      source.publicationStatus !== QuizPublicationStatus.PUBLISHED ||
      exercises.length !== 11
    )
      return false;
    return (
      exercises.every(
        (exercise, index) =>
          exercise.publicationStatus === QuizPublicationStatus.PUBLISHED &&
          exercise.taskType === tasks[index],
      ) && toeicSpeakingContractErrors(source).length === 0
    );
  }

  private writingReady(source: any) {
    return Boolean(
      source &&
      source.publicationStatus === QuizPublicationStatus.PUBLISHED &&
      source.items?.length === 8 &&
      source.items.every(
        (item: any) =>
          item.writingQuiz?.publicationStatus ===
          QuizPublicationStatus.PUBLISHED,
      ),
    );
  }

  private lrSource(exam: ProductRecord) {
    const assessmentSource = exam.toeicAssessment?.components?.find(
      (component: any) => component.kind === 'LISTENING_READING',
    )?.lrExamSet;
    return exam.variantCode === 'TOEIC_4_SKILLS'
      ? (assessmentSource ?? exam.toeicExamSet)
      : (exam.toeicExamSet ?? assessmentSource);
  }

  private productReadiness(exam: ProductRecord) {
    const template = resolveTemplateByKey(exam.templateKey);
    const lr = this.lrSource(exam);
    const lrValidation = lr
      ? validateToeicExam(lr)
      : {
          learnerReady: false,
          issues: [
            {
              code: 'MISSING_LR',
              message: 'Chưa có nguồn Listening & Reading',
            },
          ],
          counts: { total: 0, listening: 0, reading: 0, groups: 0 },
        };
    const components = exam.toeicAssessment?.components ?? [];
    const speaking = components.find(
      (component: any) => component.kind === 'SPEAKING',
    )?.speakingPracticeSet;
    const writing = components.find(
      (component: any) => component.kind === 'WRITING',
    )?.writingSet;
    const hasLr =
      template.variantCode === 'TOEIC_LR' ||
      template.variantCode === 'TOEIC_4_SKILLS';
    const hasSpeaking =
      template.variantCode === 'TOEIC_SW' ||
      template.variantCode === 'TOEIC_4_SKILLS';
    const hasWriting = hasSpeaking;
    const readiness = {
      listeningReading: hasLr
        ? lrValidation.learnerReady &&
          lr?.publicationStatus === QuizPublicationStatus.PUBLISHED
        : undefined,
      speaking: hasSpeaking
        ? this.speakingReady(speaking, template)
        : undefined,
      writing: hasWriting ? this.writingReady(writing) : undefined,
    };
    const learnerReady = Object.values(readiness).every(
      (value) => value !== false,
    );
    return {
      template,
      readiness,
      learnerReady,
      lrValidation,
      speakingCount: speaking?.exercises?.length ?? 0,
      writingCount: writing?.items?.length ?? 0,
    };
  }

  private project(exam: ProductRecord) {
    const readiness = this.productReadiness(exam);
    const child = this.lrSource(exam);
    const assessment = exam.toeicAssessment;
    return {
      id: exam.id,
      title: exam.title,
      description: exam.description,
      familyCode: exam.familyCode,
      variantCode: exam.variantCode,
      family: exam.familyCode,
      variant: exam.variantCode,
      templateKey: exam.templateKey,
      publicationStatus: exam.publicationStatus,
      createdAt: exam.createdAt,
      updatedAt: exam.updatedAt,
      childId: child?.id ?? assessment?.id ?? null,
      runtimeId: child?.id ?? assessment?.id ?? null,
      type: child?.type,
      difficulty: child?.difficulty,
      durationSeconds: child?.durationSeconds,
      groups: child?.groups ?? [],
      totalGroups: child?.groups?.length ?? 0,
      totalQuestions:
        child?.groups?.reduce(
          (total: number, group: any) => total + (group.questions?.length ?? 0),
          0,
        ) ?? 0,
      questionsCount:
        child?.groups?.reduce(
          (total: number, group: any) => total + (group.questions?.length ?? 0),
          0,
        ) ?? 0,
      bilingualContent: {
        examFormat: exam.variantCode,
        examSetId: child?.id ?? null,
      },
      attemptsCount:
        child?._count?.attempts ?? assessment?._count?.attempts ?? 0,
      learnerReady: readiness.learnerReady,
      validation: readiness.lrValidation,
      readiness: {
        ...readiness.readiness,
        speakingCount: readiness.speakingCount,
        speakingExpected:
          readiness.template.variantCode === 'TOEIC_LR' ? 0 : 11,
        writingCount: readiness.writingCount,
        writingExpected: readiness.template.variantCode === 'TOEIC_LR' ? 0 : 8,
      },
      assessment: assessment
        ? {
            id: assessment.id,
            productFamily: assessment.productFamily,
            components: assessment.components.map((component: any) => ({
              id: component.id,
              kind: component.kind,
              order: component.order,
              required: component.required,
              sourceId:
                component.lrExamSetId ??
                component.speakingPracticeSetId ??
                component.writingSetId ??
                null,
            })),
          }
        : null,
    };
  }

  async listAdmin() {
    const exams = await this.prisma.exam.findMany({
      include: this.include,
      orderBy: { updatedAt: 'desc' },
    });
    return exams.map((exam) => this.project(exam));
  }

  async listLearner() {
    const exams = await this.prisma.exam.findMany({
      where: { publicationStatus: QuizPublicationStatus.PUBLISHED },
      include: this.include,
      orderBy: { updatedAt: 'desc' },
    });
    return exams
      .map((exam) => this.project(exam))
      .filter((exam) => exam.learnerReady);
  }

  async getAdmin(id: number) {
    return this.project(await this.findExam(id));
  }

  private async speakingContext(id: number) {
    const exam = await this.prisma.exam.findUnique({
      where: { id },
      select: {
        id: true,
        variantCode: true,
        toeicAssessment: {
          select: {
            components: {
              where: { kind: 'SPEAKING' },
              select: { speakingPracticeSetId: true },
            },
          },
        },
      },
    });
    if (!exam) throw new NotFoundException(`Exam với ID ${id} không tồn tại`);
    if (!['TOEIC_SW', 'TOEIC_4_SKILLS'].includes(exam.variantCode)) {
      throw new BadRequestException(
        'Exam này không có nguồn Speaking contextual',
      );
    }
    const setId = exam.toeicAssessment?.components[0]?.speakingPracticeSetId;
    if (!setId) throw new NotFoundException('Exam chưa có nguồn Speaking');
    const set = await this.prisma.speakingPracticeSet.findUnique({
      where: { id: setId },
      select: { id: true, scope: true },
    });
    if (!set || set.scope !== SpeakingPracticeScope.EXAM_INTERNAL) {
      throw new NotFoundException('Nguồn Speaking Exam không tồn tại');
    }
    return { exam, setId };
  }

  async getSpeakingAuthoring(id: number, user: { id: number; role: any }) {
    const { setId } = await this.speakingContext(id);
    return this.skillCms.get('speaking', setId, user, true);
  }

  async listSpeakingStimuli(id: number, user: { id: number; role: any }) {
    await this.speakingContext(id);
    return this.skillCms.listSpeakingStimuli(user);
  }

  async createSpeakingStimulus(
    id: number,
    dto: SpeakingStimulusDto,
    user: { id: number; role: any },
  ) {
    await this.speakingContext(id);
    return this.skillCms.createSpeakingStimulus(dto, user);
  }

  async createSpeakingExercise(
    id: number,
    dto: SpeakingExerciseDto,
    user: { id: number; role: any },
  ) {
    const { setId } = await this.speakingContext(id);
    return this.skillCms.addSpeakingExercise('speaking', setId, dto, user);
  }

  async updateSpeakingExercise(
    id: number,
    exerciseId: number,
    dto: SpeakingExerciseDto,
    user: { id: number; role: any },
  ) {
    const { setId } = await this.speakingContext(id);
    return this.skillCms.updateSpeakingExercise(
      'speaking',
      setId,
      String(exerciseId),
      dto,
      user,
    );
  }

  async reorderSpeakingExercises(
    id: number,
    dto: SpeakingExerciseReorderDto,
    user: { id: number; role: any },
  ) {
    const { setId } = await this.speakingContext(id);
    return this.skillCms.reorderSpeakingExercises('speaking', setId, dto, user);
  }

  async deleteSpeakingExercise(
    id: number,
    exerciseId: number,
    user: { id: number; role: any },
  ) {
    const { setId } = await this.speakingContext(id);
    return this.skillCms.deleteSpeakingExercise(
      'speaking',
      setId,
      String(exerciseId),
      user,
    );
  }

  async publishSpeakingSource(id: number, user: { id: number; role: any }) {
    const { setId } = await this.speakingContext(id);
    return this.skillCms.publish(
      'speaking',
      setId,
      QuizPublicationStatus.PUBLISHED,
      user,
    );
  }

  async getLearner(id: number) {
    const exam = await this.findExam(id);
    const projected = this.project(exam);
    if (
      exam.publicationStatus !== QuizPublicationStatus.PUBLISHED ||
      !projected.learnerReady
    ) {
      throw new NotFoundException('Exam chưa sẵn sàng cho học viên');
    }
    return projected;
  }

  async createDraft(dto: CreateGenericExamDto, createdBy?: number) {
    const { familyCode, variantCode } = this.resolveRequestedVariant(dto);
    const template = resolveExamTemplate(familyCode, variantCode);
    const title = dto.title.trim();

    return this.prisma.$transaction(async (tx) => {
      const exam = await tx.exam.create({
        data: {
          title,
          description: dto.description,
          familyCode,
          variantCode,
          templateKey: template.key,
          createdBy,
          publicationStatus: QuizPublicationStatus.DRAFT,
        },
      });

      const createLr =
        variantCode === 'TOEIC_LR' || variantCode === 'TOEIC_4_SKILLS';
      let lr: any = null;
      if (createLr) {
        lr = await tx.toeicExamSet.create({
          data: {
            title,
            description: dto.description,
            type: dto.type === 'FULL_TEST' ? 'FULL_TEST' : 'PRACTICE_BY_PART',
            difficulty: dto.difficulty ?? 'medium',
            durationSeconds: dto.durationSeconds ?? 7200,
            createdBy,
            examId: exam.id,
            publicationStatus: QuizPublicationStatus.DRAFT,
          },
        });
      }

      if (variantCode === 'TOEIC_SW' || variantCode === 'TOEIC_4_SKILLS') {
        const category = await tx.speakingCategory.findFirst({
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
        });
        if (!category)
          throw new ConflictException(
            'Chưa có taxonomy Speaking để tạo nguồn nội bộ',
          );
        const speaking = await tx.speakingPracticeSet.create({
          data: {
            id: `exam-${exam.id}-speaking`,
            title: `${title} — Speaking`,
            description:
              'Nguồn Speaking nội bộ của đề thi; chưa có câu hỏi production.',
            category: category.code,
            categoryId: category.id,
            level: 'B1-C1',
            scope: SpeakingPracticeScope.EXAM_INTERNAL,
            publicationStatus: QuizPublicationStatus.DRAFT,
          },
        });
        const writing = await tx.toeicWritingSet.create({
          data: {
            title: `${title} — Writing`,
            description:
              'Nguồn Writing nội bộ của đề thi; chưa có câu hỏi production.',
            createdBy,
            publicationStatus: QuizPublicationStatus.DRAFT,
          },
        });
        const components: Prisma.ToeicAssessmentComponentCreateManyInput[] = [
          ...(lr
            ? [
                {
                  kind: 'LISTENING_READING' as const,
                  order: 1,
                  required: true,
                  assessmentId: 0,
                  lrExamSetId: lr.id,
                },
              ]
            : []),
          {
            kind: 'SPEAKING',
            order: lr ? 2 : 1,
            required: true,
            assessmentId: 0,
            speakingPracticeSetId: speaking.id,
          },
          {
            kind: 'WRITING',
            order: lr ? 3 : 2,
            required: true,
            assessmentId: 0,
            writingSetId: writing.id,
          },
        ];
        const assessment = await tx.toeicAssessment.create({
          data: {
            title,
            description: dto.description,
            productFamily:
              variantCode === 'TOEIC_SW' ? 'TOEIC_SW' : 'TOEIC_4_SKILLS',
            createdBy,
            examId: exam.id,
            publicationStatus: QuizPublicationStatus.DRAFT,
            components: {
              create: components.map((component) => {
                const { assessmentId, ...withoutAssessmentId } = component;
                void assessmentId;
                return withoutAssessmentId;
              }),
            },
          },
          include: { components: true },
        });
        return {
          ...this.project({
            ...exam,
            toeicExamSet: lr,
            toeicAssessment: assessment,
          }),
          id: exam.id,
        };
      }
      return this.project({ ...exam, toeicExamSet: lr, toeicAssessment: null });
    });
  }

  async update(id: number, dto: UpdateGenericExamDto) {
    const exam = await this.findExam(id);
    const child = exam.toeicExamSet;
    const updated = await this.prisma.exam.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
      },
      include: this.include,
    });
    if (child) {
      await this.prisma.toeicExamSet.update({
        where: { id: child.id },
        data: {
          ...(dto.title !== undefined && { title: dto.title }),
          ...(dto.description !== undefined && {
            description: dto.description,
          }),
          ...(dto.type !== undefined && { type: dto.type as any }),
          ...(dto.difficulty !== undefined && { difficulty: dto.difficulty }),
          ...(dto.durationSeconds !== undefined && {
            durationSeconds: dto.durationSeconds,
          }),
        },
      });
    }
    return this.project(updated);
  }

  async publish(id: number) {
    const exam = await this.findExam(id);
    const readiness = this.productReadiness(exam);
    if (!readiness.learnerReady) {
      throw new BadRequestException({
        message: 'Exam chưa đủ điều kiện xuất bản',
        issues: readiness.lrValidation.issues,
        readiness: readiness.readiness,
      });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.exam.update({
        where: { id },
        data: { publicationStatus: QuizPublicationStatus.PUBLISHED },
      });
      if (exam.toeicExamSet && this.lrSource(exam)?.id === exam.toeicExamSet.id)
        await tx.toeicExamSet.update({
          where: { id: exam.toeicExamSet.id },
          data: { publicationStatus: QuizPublicationStatus.PUBLISHED },
        });
      if (exam.toeicAssessment)
        await tx.toeicAssessment.update({
          where: { id: exam.toeicAssessment.id },
          data: { publicationStatus: QuizPublicationStatus.PUBLISHED },
        });
    });
    return this.getAdmin(id);
  }

  async unpublish(id: number) {
    const exam = await this.findExam(id);
    await this.prisma.$transaction([
      this.prisma.exam.update({
        where: { id },
        data: { publicationStatus: QuizPublicationStatus.DRAFT },
      }),
      ...(exam.toeicExamSet && this.lrSource(exam)?.id === exam.toeicExamSet.id
        ? [
            this.prisma.toeicExamSet.update({
              where: { id: exam.toeicExamSet.id },
              data: { publicationStatus: QuizPublicationStatus.DRAFT },
            }),
          ]
        : []),
      ...(exam.toeicAssessment
        ? [
            this.prisma.toeicAssessment.update({
              where: { id: exam.toeicAssessment.id },
              data: { publicationStatus: QuizPublicationStatus.DRAFT },
            }),
          ]
        : []),
    ]);
    return this.getAdmin(id);
  }

  async delete(id: number) {
    const exam = await this.findExam(id);
    if (exam.toeicExamSet) {
      const attempt = await this.prisma.toeicAttempt.findFirst({
        where: { examId: exam.toeicExamSet.id },
        select: { id: true },
      });
      if (attempt) {
        throw new ConflictException(
          'Exam đã có lịch sử làm bài, không thể xóa sản phẩm',
        );
      }
    }
    if (exam.toeicAssessment) {
      const attempt = await this.prisma.toeicAssessmentAttempt.findFirst({
        where: { assessmentId: exam.toeicAssessment.id },
        select: { id: true },
      });
      if (attempt) {
        throw new ConflictException(
          'Exam đã có lịch sử làm bài, không thể xóa sản phẩm',
        );
      }
    }
    await this.prisma.$transaction(async (tx) => {
      if (exam.toeicAssessment) {
        await tx.toeicAssessment.delete({
          where: { id: exam.toeicAssessment.id },
        });
      }
      if (exam.toeicExamSet) {
        await tx.toeicExamSet.delete({ where: { id: exam.toeicExamSet.id } });
      }
      await tx.exam.delete({ where: { id } });
    });
    return { success: true, id };
  }
}
