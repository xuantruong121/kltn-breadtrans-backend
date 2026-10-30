import {
  mergeListeningContent,
  spokenTextChanged,
} from './listening-question-merge';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  Prisma,
  QuizPublicationStatus,
  QuizType,
  Role,
  TopicCategory,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  SkillContentDto,
  ListeningQuestionDto,
  SkillQuestionDto,
  SpeakingExerciseDto,
  SpeakingExerciseReorderDto,
  WritingQuestionDto,
} from './skill-cms.dto';
import { SpeakingStimulusDto } from './speaking-stimulus.dto';
import { isAcceptedContentImageReference } from '../upload/content-image-validation';
import { QuizService } from '../quiz/quiz.service';
import { ListeningAudioAuthoringService } from '../quiz/listening-audio-authoring.service';
import { normalizeDialogueSegments } from '../quiz/listening-dialogue.contract';
import { SPEAKING_SET_LEVELS } from '../speaking/speaking-contract';
import { SpeakingCategoryService } from './speaking-category.service';
import { taskTypeValidationErrors } from '../speaking/speaking-task-validation';
import { toeicSpeakingContractErrors } from '../speaking/toeic-speaking-contract';
import { SpeakingService } from '../speaking/speaking.service';
import { UploadService } from '../upload/upload.service';

type Domain = 'listening' | 'reading' | 'writing' | 'speaking';
type Admin = { id: number; role: Role };

const QUIZ_DOMAINS: Record<Exclude<Domain, 'speaking'>, QuizType> = {
  listening: QuizType.LISTENING_PRACTICE,
  reading: QuizType.BILINGUAL_READING,
  writing: QuizType.WRITING_EMAIL,
};

const PICTURE_WRITING_TASK_TYPES = new Set([
  'SENTENCE',
  'PICTURE_SENTENCE',
  'DESCRIBE_PICTURE',
]);

function asJson(value: unknown): Prisma.InputJsonValue {
  return value ?? {};
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

@Injectable()
export class SkillCmsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly listeningAudioAuthoring?: ListeningAudioAuthoringService,
    @Optional()
    private readonly quizService?: QuizService,
    @Optional()
    private readonly speakingCategoryService?: SpeakingCategoryService,
    @Optional()
    private readonly speakingService?: SpeakingService,
    @Optional()
    private readonly uploadService?: UploadService,
  ) {}

  private admin(user: Admin) {
    if (user.role !== Role.ADMIN) throw new ForbiddenException('Admin only');
  }

  private domain(value: string): Domain {
    if (!['listening', 'reading', 'writing', 'speaking'].includes(value)) {
      throw new NotFoundException('Skill CMS domain not found');
    }
    return value as Domain;
  }

  private quizType(domain: Domain) {
    if (domain === 'speaking')
      throw new BadRequestException('Speaking uses practice sets');
    return QUIZ_DOMAINS[domain];
  }

  private assertSpeakingSetContract(dto: SkillContentDto) {
    if (
      dto.level &&
      !SPEAKING_SET_LEVELS.some((level) => level === dto.level)
    ) {
      throw new BadRequestException(
        `SpeakingPracticeSet.level phải là một trong: ${SPEAKING_SET_LEVELS.join(', ')}`,
      );
    }
  }

  private async speakingCategory(
    code: string,
    scope: 'practiceSet' | 'exercise',
  ) {
    return this.speakingCategoryService?.getByCode(code, scope);
  }

  private contentTypeWhere(domain: Exclude<Domain, 'speaking'>) {
    // Writing CMS owns both picture and email formats.
    return domain === 'writing'
      ? { type: { in: [QuizType.WRITING_EMAIL, QuizType.WRITING_PICTURE] } }
      : { type: this.quizType(domain) };
  }

  private async practiceTopicId(
    domain: Exclude<Domain, 'speaking'>,
    type: QuizType,
    level?: string,
  ) {
    const category =
      domain === 'reading'
        ? TopicCategory.BILINGUAL_LEVEL
        : type === QuizType.WRITING_PICTURE
          ? TopicCategory.WRITING_PART1
          : TopicCategory.WRITING_PART2;
    if (!this.prisma.practiceTopic?.findMany) return undefined;
    const topics = await this.prisma.practiceTopic.findMany({
      where: { category },
      select: { id: true, name: true },
      orderBy: { order: 'asc' },
    });
    if (!topics.length) return undefined;
    if (domain !== 'reading') return topics[0].id;
    const normalizedLevel = level?.trim().toUpperCase() ?? '';
    const marker = normalizedLevel.includes('C1')
      ? 'C1'
      : normalizedLevel.includes('B1') || normalizedLevel.includes('B2')
        ? 'B1'
        : 'A1';
    return (
      topics.find((topic) => topic.name.toUpperCase().includes(marker))?.id ??
      topics[0].id
    );
  }

  async list(rawDomain: string, user: Admin) {
    this.admin(user);
    const domain = this.domain(rawDomain);
    if (domain === 'speaking') {
      return this.prisma.speakingPracticeSet.findMany({
        where: { scope: 'SKILL_PRACTICE' },
        orderBy: { updatedAt: 'desc' },
        include: {
          exercises: {
            orderBy: [{ order: 'asc' }, { id: 'asc' }],
            include: {
              categoryTaxonomy: true,
              stimulus: true,
              _count: { select: { submissions: true } },
            },
          },
          categoryTaxonomy: true,
        },
      });
    }
    const quizzes = await this.prisma.quiz.findMany({
      where: this.contentTypeWhere(domain),
      orderBy: { id: 'desc' },
      include: {
        _count: { select: { questions: true, submissions: true } },
        // The list card shows the newest recording's state; whether it still
        // matches the transcript is decided in the editor.
        ...(domain === 'listening'
          ? {
              listeningAudioArtifacts: {
                orderBy: { version: 'desc' as const },
                take: 1,
                select: { version: true, status: true, durationMs: true },
              },
            }
          : {}),
      },
    });
    if (domain !== 'listening' || !quizzes.length) return quizzes;
    // Comprehension and dictation play one clip per question: count them.
    const withAudio = await this.prisma.question.groupBy({
      by: ['quizId'],
      where: {
        quizId: { in: quizzes.map((quiz) => quiz.id) },
        audioAssets: { some: { isActive: true } },
      },
      _count: { _all: true },
    });
    const counts = new Map(
      withAudio.map((row) => [row.quizId, row._count._all]),
    );
    return quizzes.map((quiz) => ({
      ...quiz,
      questionsWithAudio: counts.get(quiz.id) ?? 0,
    }));
  }

  async get(
    rawDomain: string,
    rawId: string,
    user: Admin,
    allowExamInternal = false,
  ) {
    this.admin(user);
    const domain = this.domain(rawDomain);
    if (domain === 'speaking') {
      const set = await this.prisma.speakingPracticeSet.findUnique({
        where: { id: rawId },
        include: {
          categoryTaxonomy: true,
          exercises: {
            orderBy: [{ order: 'asc' }, { id: 'asc' }],
            include: { categoryTaxonomy: true, stimulus: true },
          },
        },
      });
      if (!set) throw new NotFoundException('Speaking practice set not found');
      if (set.scope === 'EXAM_INTERNAL' && !allowExamInternal)
        throw new NotFoundException('Speaking practice set not found');
      return set;
    }
    const id = this.id(rawId);
    const quiz = await this.prisma.quiz.findFirst({
      where: { id, ...this.contentTypeWhere(domain) },
      include: {
        questions: {
          orderBy: { order: 'asc' },
          ...(domain === 'listening'
            ? { include: { audioAssets: { orderBy: { version: 'desc' } } } }
            : {}),
        },
        listeningAudioArtifacts: domain === 'listening',
        _count: { select: { submissions: true } },
      },
    });
    if (!quiz) throw new NotFoundException('Skill content not found');
    return { ...quiz, passage: quiz.theoryContent };
  }

  async create(rawDomain: string, dto: SkillContentDto, user: Admin) {
    this.admin(user);
    const domain = this.domain(rawDomain);
    if (domain === 'speaking') {
      this.assertSpeakingSetContract(dto);
      const categoryCode =
        dto.category?.trim() ||
        (this.speakingCategoryService
          ? (await this.speakingCategoryService.getDefault('practiceSet')).code
          : 'GENERAL');
      const category = await this.speakingCategory(categoryCode, 'practiceSet');
      const title = dto.title.trim();
      const id = `speaking-${randomUUID()}`;
      const data: any = {
        id,
        title,
        description: dto.description?.trim() ?? '',
        category: category?.code || categoryCode,
        level: dto.level?.trim() || 'A1-B1',
        publicationStatus: QuizPublicationStatus.DRAFT,
      };
      if (category) data.categoryId = category.id;
      return this.prisma.speakingPracticeSet.create({
        data,
      });
    }
    const type = this.quizType(domain);
    const writingType =
      domain === 'writing' && dto.type === 'WRITING_PICTURE'
        ? QuizType.WRITING_PICTURE
        : type;
    const practiceTopicId = await this.practiceTopicId(
      domain,
      writingType,
      dto.level,
    );
    return this.prisma.quiz.create({
      data: {
        title: dto.title.trim(),
        description: dto.description?.trim(),
        theoryContent: dto.passage,
        bilingualContent: dto.bilingualContent
          ? asJson(dto.bilingualContent)
          : undefined,
        type: writingType,
        timeLimit: dto.timeLimit,
        isPremiumContent: dto.isPremiumContent ?? false,
        publicationStatus: QuizPublicationStatus.DRAFT,
        practiceTopicId,
      },
    });
  }

  async update(
    rawDomain: string,
    rawId: string,
    dto: SkillContentDto,
    user: Admin,
  ) {
    this.admin(user);
    const domain = this.domain(rawDomain);
    if (domain === 'speaking') {
      this.assertSpeakingSetContract(dto);
      const set = await this.prisma.speakingPracticeSet.findUnique({
        where: { id: rawId },
      });
      if (!set) throw new NotFoundException('Speaking practice set not found');
      await this.assertNoSpeakingHistory(rawId);
      const category = dto.category
        ? await this.speakingCategory(dto.category.trim(), 'practiceSet')
        : undefined;
      const data: any = {
        title: dto.title?.trim(),
        description: dto.description?.trim(),
        category: category?.code || dto.category?.trim(),
        level: dto.level?.trim(),
      };
      if (category) data.categoryId = category.id;
      return this.prisma.speakingPracticeSet.update({
        where: { id: rawId },
        data,
      });
    }
    const id = this.id(rawId);
    const quiz = await this.prisma.quiz.findFirst({
      where: { id, ...this.contentTypeWhere(domain) },
    });
    if (!quiz) throw new NotFoundException('Skill content not found');
    await this.assertNoHistory(id);
    const type =
      domain === 'writing' &&
      (dto.type === 'WRITING_PICTURE' || dto.type === 'WRITING_EMAIL')
        ? dto.type === 'WRITING_PICTURE'
          ? QuizType.WRITING_PICTURE
          : QuizType.WRITING_EMAIL
        : undefined;
    return this.prisma.quiz.update({
      where: { id },
      data: {
        title: dto.title?.trim(),
        description: dto.description?.trim(),
        theoryContent: dto.passage,
        bilingualContent: dto.bilingualContent
          ? asJson(dto.bilingualContent)
          : undefined,
        timeLimit: dto.timeLimit,
        type,
        isPremiumContent: dto.isPremiumContent,
      },
    });
  }

  async addQuestion(
    rawDomain: string,
    rawId: string,
    dto: SkillQuestionDto,
    user: Admin,
  ) {
    this.admin(user);
    const domain = this.domain(rawDomain);
    if (domain === 'speaking')
      throw new BadRequestException('Speaking questions are exercises');
    const quizId = this.id(rawId);
    const quiz = await this.prisma.quiz.findFirst({
      where: { id: quizId, ...this.contentTypeWhere(domain) },
    });
    if (!quiz) throw new NotFoundException('Skill content not found');
    await this.assertNoHistory(quizId);
    const last = await this.prisma.question.findFirst({
      where: { quizId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    return this.prisma.question.create({
      data: {
        quizId,
        type: dto.type,
        content: asJson(dto.content),
        order: dto.order ?? (last?.order ?? -1) + 1,
      },
    });
  }

  async addWritingQuestion(
    rawQuizId: string,
    dto: WritingQuestionDto,
    user: Admin,
  ) {
    this.admin(user);
    const quizId = this.id(rawQuizId);
    const quiz = await this.prisma.quiz.findFirst({
      where: {
        id: quizId,
        type: { in: [QuizType.WRITING_EMAIL, QuizType.WRITING_PICTURE] },
      },
    });
    if (!quiz) throw new NotFoundException('Writing content not found');
    this.assertWritingTaskType(quiz.type, dto.taskType);
    await this.assertNoHistory(quizId);
    const last = await this.prisma.question.findFirst({
      where: { quizId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    return this.prisma.question.create({
      data: {
        quizId,
        type: dto.type,
        content: this.writingContent(dto),
        order: dto.order ?? (last?.order ?? -1) + 1,
      },
    });
  }

  async addListeningQuestion(
    rawQuizId: string,
    dto: ListeningQuestionDto,
    user: Admin,
  ) {
    this.admin(user);
    const quizId = this.id(rawQuizId);
    const quiz = await this.prisma.quiz.findFirst({
      where: { id: quizId, type: QuizType.LISTENING_PRACTICE },
    });
    if (!quiz) throw new NotFoundException('Listening content not found');
    await this.assertNoHistory(quizId);
    const last = await this.prisma.question.findFirst({
      where: { quizId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    return this.prisma.question.create({
      data: {
        quizId,
        type: dto.type,
        content: asJson(dto.content),
        order: dto.order ?? (last?.order ?? -1) + 1,
      },
    });
  }

  async updateListeningQuestion(
    rawQuizId: string,
    rawQuestionId: string,
    dto: ListeningQuestionDto,
    user: Admin,
  ) {
    this.admin(user);
    const quizId = this.id(rawQuizId);
    const questionId = this.id(rawQuestionId);
    const question = await this.prisma.question.findFirst({
      where: {
        id: questionId,
        quizId,
        quiz: { type: QuizType.LISTENING_PRACTICE },
      },
    });
    if (!question)
      throw new NotFoundException(
        'Question does not belong to Listening content',
      );
    await this.assertNoHistory(quizId);
    // Same type: merge, so fields the form does not show survive the edit.
    const content =
      dto.type === question.type
        ? mergeListeningContent(
            question.content,
            dto.content as unknown as Record<string, unknown>,
          )
        : dto.content;
    const updated = await this.prisma.question.update({
      where: { id: questionId },
      data: {
        type: dto.type,
        content: asJson(content),
        order: dto.order,
      },
    });
    // A clip that reads the old sentence is retired; the CMS asks for a new one.
    if (spokenTextChanged(question.content, content))
      await this.prisma.quizAudioAsset.updateMany({
        where: { questionId, isActive: true },
        data: { isActive: false },
      });
    return updated;
  }

  async updateWritingQuestion(
    rawQuizId: string,
    rawQuestionId: string,
    dto: WritingQuestionDto,
    user: Admin,
  ) {
    this.admin(user);
    const quizId = this.id(rawQuizId);
    const questionId = this.id(rawQuestionId);
    const question = await this.prisma.question.findFirst({
      where: {
        id: questionId,
        quizId,
        quiz: {
          type: { in: [QuizType.WRITING_EMAIL, QuizType.WRITING_PICTURE] },
        },
      },
      include: { quiz: { select: { type: true } } },
    });
    if (!question)
      throw new NotFoundException(
        'Question does not belong to Writing content',
      );
    this.assertWritingTaskType(question.quiz?.type, dto.taskType);
    await this.assertNoHistory(quizId);
    return this.prisma.question.update({
      where: { id: questionId },
      data: {
        type: dto.type,
        content: this.writingContent(dto),
        order: dto.order,
      },
    });
  }

  async addSpeakingExercise(
    rawDomain: string,
    rawSetId: string,
    dto: SpeakingExerciseDto,
    user: Admin,
  ) {
    this.admin(user);
    if (this.domain(rawDomain) !== 'speaking')
      throw new BadRequestException('Exercises chỉ dùng cho Speaking');
    const set = await this.prisma.speakingPracticeSet.findUnique({
      where: { id: rawSetId },
    });
    if (!set) throw new NotFoundException('Speaking practice set not found');
    if (!dto.taskType) {
      throw new BadRequestException('Câu Speaking mới phải có loại bài');
    }
    const stimulus = dto.stimulusId
      ? await this.prisma.speakingStimulus.findUnique({
          where: { id: dto.stimulusId },
        })
      : null;
    if (dto.stimulusId && !stimulus) {
      throw new NotFoundException('Không tìm thấy Speaking stimulus');
    }
    const semanticErrors = taskTypeValidationErrors({
      taskType: dto.taskType as any,
      targetText: dto.targetText,
      imageUrl: dto.imageUrl,
      stimulusId: dto.stimulusId,
      stimulus,
    });
    if (semanticErrors.length) throw new BadRequestException(semanticErrors);
    const category = dto.category
      ? await this.speakingCategory(dto.category.trim(), 'exercise')
      : undefined;
    const data: any = {
      title: dto.title.trim(),
      targetText: dto.targetText.trim(),
      category: category?.code || set.category,
      difficulty: dto.difficulty || set.level,
      imageUrl: dto.imageUrl,
      audioUrl: dto.audioUrl,
      isPremiumContent: dto.isPremiumContent ?? false,
      taskType: dto.taskType,
      stimulusId: dto.stimulusId,
      order: null,
      practiceSetId: rawSetId,
      publicationStatus: QuizPublicationStatus.DRAFT,
    };
    if (this.speakingCategoryService) data.categoryId = category?.id ?? null;
    return this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.speakingExercise.findMany({
          where: { practiceSetId: rawSetId },
          orderBy: [{ order: 'asc' }, { id: 'asc' }],
          select: { id: true, order: true },
        });
        const requestedOrder = dto.order ?? existing.length + 1;
        if (requestedOrder > existing.length + 1) {
          throw new BadRequestException(
            `Vị trí câu phải nằm trong khoảng 1-${existing.length + 1}`,
          );
        }

        const created = await tx.speakingExercise.create({
          data: { ...data, order: null },
        });
        const orderedIds = existing.map((item) => item.id);
        orderedIds.splice(requestedOrder - 1, 0, created.id);
        await tx.speakingExercise.updateMany({
          where: { practiceSetId: rawSetId },
          data: { order: null },
        });
        for (const [index, id] of orderedIds.entries()) {
          await tx.speakingExercise.update({
            where: { id },
            data: { order: index + 1 },
          });
        }
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async updateSpeakingExercise(
    rawDomain: string,
    rawSetId: string,
    rawExerciseId: string,
    dto: SpeakingExerciseDto,
    user: Admin,
  ) {
    this.admin(user);
    if (this.domain(rawDomain) !== 'speaking')
      throw new BadRequestException('Exercises chỉ dùng cho Speaking');
    const exerciseId = this.id(rawExerciseId);
    const exercise = await this.prisma.speakingExercise.findFirst({
      where: { id: exerciseId, practiceSetId: rawSetId },
      include: {
        categoryTaxonomy: true,
        practiceSet: { select: { category: true, categoryId: true } },
        stimulus: true,
      },
    });
    if (!exercise) throw new NotFoundException('Speaking exercise not found');
    if (dto.order !== undefined) {
      throw new BadRequestException(
        'Dùng API reorder để thay đổi thứ tự câu trong bộ luyện',
      );
    }
    await this.assertNoSpeakingHistory(rawSetId);
    const taskType = dto.taskType ?? exercise.taskType;
    const stimulus = dto.stimulusId
      ? await this.prisma.speakingStimulus.findUnique({
          where: { id: dto.stimulusId },
        })
      : dto.stimulusId === null
        ? null
        : exercise.stimulus;
    if (dto.stimulusId && !stimulus) {
      throw new NotFoundException('Không tìm thấy Speaking stimulus');
    }
    const semanticErrors = taskType
      ? taskTypeValidationErrors({
          taskType: taskType as any,
          targetText: dto.targetText ?? exercise.targetText,
          imageUrl: dto.imageUrl ?? exercise.imageUrl,
          stimulusId: dto.stimulusId ?? exercise.stimulusId,
          stimulus,
        })
      : [];
    if (semanticErrors.length) throw new BadRequestException(semanticErrors);
    const hasCategoryInput = dto.category !== undefined;
    const category =
      hasCategoryInput && dto.category
        ? await this.speakingCategory(dto.category.trim(), 'exercise')
        : undefined;
    const data: any = {
      title: dto.title?.trim(),
      targetText: dto.targetText?.trim(),
      category:
        category?.code || exercise.practiceSet?.category || exercise.category,
      difficulty: dto.difficulty,
      imageUrl: dto.imageUrl,
      // A new sample sentence retires the clip that reads the old one; the
      // CMS then offers to make a new reference audio.
      audioUrl:
        dto.audioUrl !== undefined
          ? dto.audioUrl
          : dto.targetText !== undefined &&
              dto.targetText.trim() !== (exercise.targetText ?? '').trim()
            ? null
            : undefined,
      isPremiumContent: dto.isPremiumContent,
      taskType,
      stimulusId: dto.stimulusId === null ? null : stimulus?.id,
    };
    if (hasCategoryInput && this.speakingCategoryService) {
      data.categoryId = category?.id ?? null;
    }
    return this.prisma.speakingExercise.update({
      where: { id: exerciseId },
      data,
    });
  }

  /**
   * Reads the sample sentence with Azure TTS and makes it the exercise's
   * reference audio. A new key per run, so no cache serves the old clip.
   */
  async generateSpeakingReferenceAudio(
    rawSetId: string,
    rawExerciseId: string,
    user: Admin,
  ) {
    this.admin(user);
    if (!this.speakingService || !this.uploadService)
      throw new ServiceUnavailableException('Speaking audio is unavailable');
    const exerciseId = this.id(rawExerciseId);
    const exercise = await this.prisma.speakingExercise.findFirst({
      where: { id: exerciseId, practiceSetId: rawSetId },
    });
    if (!exercise) throw new NotFoundException('Speaking exercise not found');
    const text = exercise.targetText.trim();
    if (!text) throw new BadRequestException('Câu luyện chưa có câu mẫu.');
    if (
      exercise.isPremiumContent &&
      !this.uploadService.isPrivateStorageConfigured()
    )
      throw new ServiceUnavailableException(
        'Protected Speaking media storage is not configured',
      );
    const audio = await this.speakingService.generateTts(text, 'US', 1);
    const file = `${exerciseId}.r${Date.now()}.mp3`;
    let audioUrl: string;
    if (exercise.isPremiumContent) {
      audioUrl = `premium/speaking/reference/${file}`;
      await this.uploadService.putPrivateObjectAtKey(
        audioUrl,
        audio,
        'audio/mpeg',
      );
    } else {
      audioUrl = (
        await this.uploadService.putObjectAtKey(
          `catalog/speaking/reference/${file}`,
          audio,
          'audio/mpeg',
        )
      ).url;
    }
    return this.prisma.speakingExercise.update({
      where: { id: exerciseId },
      data: { audioUrl },
    });
  }

  async listSpeakingStimuli(user: Admin) {
    this.admin(user);
    return this.prisma.speakingStimulus.findMany({
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      include: { _count: { select: { exercises: true } } },
    });
  }

  async createSpeakingStimulus(dto: SpeakingStimulusDto, user: Admin) {
    this.admin(user);
    if (!dto.kind) {
      throw new BadRequestException('Stimulus cần có kind hợp lệ');
    }
    if (dto.kind === 'INFORMATION' && !dto.content?.trim()) {
      throw new BadRequestException('INFORMATION stimulus cần nội dung');
    }
    if (dto.kind === 'IMAGE' && !dto.imageUrl?.trim()) {
      throw new BadRequestException('IMAGE stimulus cần imageUrl');
    }
    return this.prisma.speakingStimulus.create({
      data: {
        kind: dto.kind,
        title: dto.title?.trim() || null,
        content: dto.content?.trim() || null,
        imageUrl: dto.imageUrl?.trim() || null,
      },
    });
  }

  async updateSpeakingStimulus(
    rawId: string,
    dto: SpeakingStimulusDto,
    user: Admin,
  ) {
    this.admin(user);
    const id = this.id(rawId);
    const existing = await this.prisma.speakingStimulus.findUnique({
      where: { id },
    });
    if (!existing)
      throw new NotFoundException('Không tìm thấy Speaking stimulus');
    const kind = dto.kind ?? existing.kind;
    const content = dto.content === undefined ? existing.content : dto.content;
    const imageUrl =
      dto.imageUrl === undefined ? existing.imageUrl : dto.imageUrl;
    if (kind === 'INFORMATION' && !content?.trim()) {
      throw new BadRequestException('INFORMATION stimulus cần nội dung');
    }
    if (kind === 'IMAGE' && !imageUrl?.trim()) {
      throw new BadRequestException('IMAGE stimulus cần imageUrl');
    }
    return this.prisma.speakingStimulus.update({
      where: { id },
      data: {
        kind,
        title: dto.title === undefined ? existing.title : dto.title.trim(),
        content: content?.trim() || null,
        imageUrl: imageUrl?.trim() || null,
      },
    });
  }

  async deleteSpeakingExercise(
    rawDomain: string,
    rawSetId: string,
    rawExerciseId: string,
    user: Admin,
  ) {
    this.admin(user);
    if (this.domain(rawDomain) !== 'speaking')
      throw new BadRequestException('Exercises chỉ dùng cho Speaking');
    const exerciseId = this.id(rawExerciseId);
    const exercise = await this.prisma.speakingExercise.findFirst({
      where: { id: exerciseId, practiceSetId: rawSetId },
    });
    if (!exercise) throw new NotFoundException('Speaking exercise not found');
    await this.assertNoSpeakingHistory(rawSetId);
    return this.prisma.$transaction(
      async (tx) => {
        const deleted = await tx.speakingExercise.delete({
          where: { id: exerciseId },
        });
        const remaining = await tx.speakingExercise.findMany({
          where: { practiceSetId: rawSetId },
          orderBy: [{ order: 'asc' }, { id: 'asc' }],
          select: { id: true },
        });
        await tx.speakingExercise.updateMany({
          where: { practiceSetId: rawSetId },
          data: { order: null },
        });
        for (const [index, item] of remaining.entries()) {
          await tx.speakingExercise.update({
            where: { id: item.id },
            data: { order: index + 1 },
          });
        }
        return deleted;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async reorderSpeakingExercises(
    rawDomain: string,
    rawSetId: string,
    dto: SpeakingExerciseReorderDto,
    user: Admin,
  ) {
    this.admin(user);
    if (this.domain(rawDomain) !== 'speaking')
      throw new BadRequestException('Exercises chỉ dùng cho Speaking');
    const set = await this.prisma.speakingPracticeSet.findUnique({
      where: { id: rawSetId },
      select: { id: true, publicationStatus: true },
    });
    if (!set) throw new NotFoundException('Speaking practice set not found');
    if (set.publicationStatus === QuizPublicationStatus.PUBLISHED) {
      throw new ConflictException(
        'Hãy chuyển bộ luyện về bản nháp trước khi sắp xếp lại câu',
      );
    }
    await this.assertNoSpeakingHistory(rawSetId);

    const current = await this.prisma.speakingExercise.findMany({
      where: { practiceSetId: rawSetId },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    const requested = dto.exerciseIds;
    if (
      requested.length !== current.length ||
      new Set(requested).size !== requested.length ||
      requested.some((id) => !current.some((item) => item.id === id))
    ) {
      throw new BadRequestException(
        'Danh sách sắp xếp phải chứa đúng một lần toàn bộ câu trong bộ luyện',
      );
    }

    return this.prisma.$transaction(
      async (tx) => {
        await tx.speakingExercise.updateMany({
          where: { practiceSetId: rawSetId },
          data: { order: null },
        });
        for (const [index, id] of requested.entries()) {
          await tx.speakingExercise.update({
            where: { id },
            data: { order: index + 1 },
          });
        }
        return tx.speakingPracticeSet.findUnique({
          where: { id: rawSetId },
          include: {
            exercises: {
              orderBy: [{ order: 'asc' }, { id: 'asc' }],
              include: { categoryTaxonomy: true, stimulus: true },
            },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async updateQuestion(
    rawDomain: string,
    rawId: string,
    rawQuestionId: string,
    dto: SkillQuestionDto,
    user: Admin,
  ) {
    this.admin(user);
    const domain = this.domain(rawDomain);
    if (domain === 'speaking')
      throw new BadRequestException('Speaking questions are exercises');
    const quizId = this.id(rawId);
    const questionId = this.id(rawQuestionId);
    const question = await this.prisma.question.findFirst({
      where: {
        id: questionId,
        quizId,
        quiz: this.contentTypeWhere(domain),
      },
    });
    if (!question)
      throw new NotFoundException(
        'Question does not belong to this skill content',
      );
    await this.assertNoHistory(quizId);
    return this.prisma.question.update({
      where: { id: questionId },
      data: { type: dto.type, content: asJson(dto.content), order: dto.order },
    });
  }

  async deleteQuestion(
    rawDomain: string,
    rawId: string,
    rawQuestionId: string,
    user: Admin,
  ) {
    this.admin(user);
    const domain = this.domain(rawDomain);
    if (domain === 'speaking')
      throw new BadRequestException('Speaking questions are exercises');
    const quizId = this.id(rawId);
    const questionId = this.id(rawQuestionId);
    const question = await this.prisma.question.findFirst({
      where: {
        id: questionId,
        quizId,
        quiz: this.contentTypeWhere(domain),
      },
    });
    if (!question)
      throw new NotFoundException(
        'Question does not belong to this skill content',
      );
    await this.assertNoHistory(quizId);
    return this.prisma.question.delete({ where: { id: questionId } });
  }

  async validate(rawDomain: string, rawId: string, user: Admin) {
    this.admin(user);
    const domain = this.domain(rawDomain);
    if (domain === 'speaking') return this.validateSpeaking(rawId);
    const quiz = (await this.get(domain, rawId, user)) as unknown as {
      id: number;
      type?: QuizType;
      title?: string;
      questions: Array<{
        type: string;
        content: unknown;
        audioAssets?: Array<{ isActive: boolean }>;
      }>;
    };
    const errors: string[] = [];
    if (!quiz.title?.trim()) errors.push('Thiếu tiêu đề');
    if (!quiz.questions.length) errors.push('Cần ít nhất một câu hỏi');
    if (
      domain === 'listening' &&
      quiz.questions.length &&
      quiz.questions.every((q) => q.type === 'DICTATION') &&
      quiz.questions.length < 20
    )
      errors.push('Dictation cần ít nhất 20 câu');
    for (const [index, question] of quiz.questions.entries()) {
      const content = asRecord(question.content);
      if (domain === 'reading') {
        const options = content.options;
        const correctIndex = content.correctIndex as number;
        if (
          !Array.isArray(options) ||
          !Number.isInteger(correctIndex) ||
          correctIndex < 0 ||
          correctIndex >= options.length
        )
          errors.push(`Câu ${index + 1}: options/correctIndex không hợp lệ`);
      }
      if (
        domain === 'writing' &&
        (typeof (content.prompt ?? content.text) !== 'string' ||
          !String(content.prompt ?? content.text).trim())
      )
        errors.push(`Câu ${index + 1}: thiếu đề bài Writing`);
      if (domain === 'writing' && question.type !== 'WRITING')
        errors.push(`Câu ${index + 1}: loại câu phải là WRITING`);
      if (
        domain === 'writing' &&
        quiz.type === QuizType.WRITING_EMAIL &&
        (typeof content.taskType !== 'string' || !content.taskType.trim())
      )
        errors.push(`Câu ${index + 1}: Writing Email cần taskType`);
      if (
        domain === 'writing' &&
        quiz.type === QuizType.WRITING_PICTURE &&
        typeof content.taskType === 'string' &&
        ['PICTURE', 'PICTURE_SENTENCE', 'DESCRIBE_PICTURE'].includes(
          content.taskType.trim().toUpperCase(),
        ) &&
        !isAcceptedContentImageReference(content.imageUrl)
      )
        errors.push(`Câu ${index + 1}: Picture task cần imageUrl`);
      if (domain === 'writing' && content.wordRange !== undefined) {
        const range = content.wordRange;
        if (
          !Array.isArray(range) ||
          range.length !== 2 ||
          !range.every((value) => Number.isInteger(value) && value > 0) ||
          range[0] > range[1]
        )
          errors.push(`Câu ${index + 1}: wordRange không hợp lệ`);
      }
      if (
        domain === 'listening' &&
        question.type === 'DICTATION' &&
        ![
          content.correctAnswer,
          content.audioText,
          content.text,
          content.prompt,
        ].some((value) => typeof value === 'string' && value.trim())
      )
        errors.push(`Câu ${index + 1}: Dictation cần target sentence`);
      if (
        domain === 'listening' &&
        question.type === 'MULTIPLE_CHOICE' &&
        (() => {
          const correctIndex = content.correctIndex;
          return (
            !Array.isArray(content.options) ||
            typeof correctIndex !== 'number' ||
            !Number.isInteger(correctIndex) ||
            correctIndex < 0 ||
            correctIndex >= content.options.length
          );
        })()
      )
        errors.push(
          `Câu ${index + 1}: Listening options/correctIndex không hợp lệ`,
        );
      if (
        domain === 'listening' &&
        question.type === 'DIALOGUE' &&
        (!Array.isArray(content.transcriptSegments) ||
          normalizeDialogueSegments(content.transcriptSegments).length < 2 ||
          new Set(
            normalizeDialogueSegments(content.transcriptSegments).map(
              (segment) => segment.speakerId ?? segment.speaker,
            ),
          ).size < 2)
      )
        errors.push(
          `Câu ${index + 1}: Dialogue cần ít nhất 2 lượt lời hợp lệ của 2 người nói`,
        );
    }
    // A learner hears either the question's own clip or, for questions that
    // share the conversation, the quiz's published recording.
    if (domain === 'listening' && quiz.questions.length) {
      const recording = this.listeningAudioAuthoring
        ? await this.listeningAudioAuthoring.getCurrentPublishedArtifact(
            quiz.id,
          )
        : null;
      for (const [index, question] of quiz.questions.entries()) {
        const content = asRecord(question.content);
        const ownClip = (question.audioAssets ?? []).some(
          (asset) => asset.isActive,
        );
        const sharesRecording =
          Boolean(recording) &&
          (typeof content.targetTurnId === 'string' ||
            (Array.isArray(content.transcriptSegments) &&
              content.transcriptSegments.length > 0));
        if (!ownClip && !sharesRecording)
          errors.push(`Câu ${index + 1}: chưa có audio cho học viên`);
      }
    }
    return { valid: errors.length === 0, errors, domain, quizId: quiz.id };
  }

  async publish(
    rawDomain: string,
    rawId: string,
    status: QuizPublicationStatus,
    user: Admin,
  ) {
    this.admin(user);
    const check = await this.validate(rawDomain, rawId, user);
    if (!check.valid && status === QuizPublicationStatus.PUBLISHED)
      throw new BadRequestException(check.errors);
    const domain = this.domain(rawDomain);
    if (domain === 'speaking') {
      const id = rawId;
      const set = await this.prisma.speakingPracticeSet.findUnique({
        where: { id },
        include: { exercises: true },
      });
      if (!set) throw new NotFoundException('Speaking practice set not found');
      return this.prisma.$transaction(async (tx) => {
        const updated = await tx.speakingPracticeSet.update({
          where: { id },
          data: { publicationStatus: status },
        });
        await tx.speakingExercise.updateMany({
          where: { practiceSetId: id },
          data: { publicationStatus: status },
        });
        return updated;
      });
    }
    const id = this.id(rawId);
    return this.prisma.quiz.update({
      where: { id },
      data: {
        publicationStatus: status,
        publishedAt:
          status === QuizPublicationStatus.PUBLISHED ? new Date() : undefined,
      },
    });
  }

  private id(raw: string) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id < 1)
      throw new BadRequestException('Invalid content id');
    return id;
  }

  private writingContent(dto: WritingQuestionDto): Prisma.InputJsonValue {
    return {
      skill: 'WRITING',
      prompt: dto.prompt.trim(),
      ...(dto.taskType?.trim() ? { taskType: dto.taskType.trim() } : {}),
      ...(dto.level?.trim() ? { level: dto.level.trim() } : {}),
      ...(dto.imageUrl?.trim() ? { imageUrl: dto.imageUrl.trim() } : {}),
      ...(dto.keywords?.length
        ? { keywords: dto.keywords.map((x) => x.trim()).filter(Boolean) }
        : {}),
      ...(dto.wordRange ? { wordRange: dto.wordRange } : {}),
      ...(dto.sampleSentences?.length
        ? {
            sampleSentences: dto.sampleSentences
              .map((x) => x.trim())
              .filter(Boolean),
          }
        : {}),
      ...(dto.explanation?.trim()
        ? { explanation: dto.explanation.trim() }
        : {}),
    };
  }

  private assertWritingTaskType(
    quizType: QuizType | undefined,
    taskType?: string,
  ) {
    const normalizedTaskType = taskType?.trim().toUpperCase();
    if (!normalizedTaskType) return;
    if (
      quizType === QuizType.WRITING_PICTURE &&
      !PICTURE_WRITING_TASK_TYPES.has(normalizedTaskType)
    ) {
      throw new BadRequestException(
        'Writing theo tranh chỉ nhận task family của dạng tranh',
      );
    }
    if (
      quizType === QuizType.WRITING_EMAIL &&
      PICTURE_WRITING_TASK_TYPES.has(normalizedTaskType)
    ) {
      throw new BadRequestException(
        'Writing Email không nhận task family của dạng tranh',
      );
    }
  }

  private requireListeningAuthoring() {
    if (!this.listeningAudioAuthoring || !this.quizService)
      throw new ServiceUnavailableException(
        'Listening authoring is unavailable',
      );
    return {
      audio: this.listeningAudioAuthoring,
      quiz: this.quizService,
    };
  }

  async validateListeningAudio(quizId: number, user: Admin) {
    this.admin(user);
    return this.requireListeningAuthoring().audio.validateContent(quizId);
  }

  async generateListeningAudioPreview(quizId: number, user: Admin) {
    this.admin(user);
    await this.assertNoHistory(quizId);
    return this.requireListeningAuthoring().audio.generatePreview(
      quizId,
      user.id,
    );
  }

  async listListeningAudio(quizId: number, user: Admin) {
    this.admin(user);
    return this.requireListeningAuthoring().audio.listArtifacts(quizId);
  }

  async approveListeningAudio(quizId: number, artifactId: number, user: Admin) {
    this.admin(user);
    return this.requireListeningAuthoring().audio.approve(
      quizId,
      artifactId,
      user.id,
    );
  }

  async publishListeningAudio(quizId: number, artifactId: number, user: Admin) {
    this.admin(user);
    return this.requireListeningAuthoring().audio.publish(
      quizId,
      artifactId,
      user.id,
    );
  }

  async previewListeningAudio(quizId: number, artifactId: number, user: Admin) {
    this.admin(user);
    return this.requireListeningAuthoring().audio.getPreviewAudio(
      quizId,
      artifactId,
    );
  }

  private async assertListeningQuestion(quizId: number, questionId: number) {
    const question = await this.prisma.question.findFirst({
      where: {
        id: questionId,
        quizId,
        quiz: { type: QuizType.LISTENING_PRACTICE },
      },
      select: { id: true },
    });
    if (!question) throw new NotFoundException('Listening question not found');
  }

  async uploadListeningQuestionAudio(
    quizId: number,
    questionId: number,
    file: Express.Multer.File,
    user: Admin,
  ) {
    this.admin(user);
    await this.assertListeningQuestion(quizId, questionId);
    await this.assertNoHistory(quizId);
    return this.requireListeningAuthoring().quiz.createAudioAsset(
      questionId,
      file,
    );
  }

  async generateListeningDialogueAudio(
    quizId: number,
    questionId: number,
    user: Admin,
  ) {
    this.admin(user);
    await this.assertListeningQuestion(quizId, questionId);
    // Re-recording the same sentence changes no answer or score, so it is
    // allowed after learners have taken the quiz.
    return this.requireListeningAuthoring().quiz.generateDialogueAudioAsset(
      questionId,
    );
  }

  private async assertNoHistory(quizId: number) {
    const count = await this.prisma.submission.count({ where: { quizId } });
    if (count > 0)
      throw new ConflictException(
        'Nội dung đã có lịch sử làm bài; tạo phiên bản mới thay vì sửa trực tiếp',
      );
  }

  private async validateSpeaking(rawId: string) {
    const set = await this.prisma.speakingPracticeSet.findUnique({
      where: { id: rawId },
      include: { exercises: { include: { stimulus: true } } },
    });
    if (!set) throw new NotFoundException('Speaking practice set not found');
    const errors = [
      !set.title.trim() ? 'Thiếu tiêu đề' : null,
      set.exercises.length === 0 ? 'Cần ít nhất một bài Speaking' : null,
      ...set.exercises.map((exercise) =>
        !exercise.title.trim() || !exercise.targetText.trim()
          ? `Exercise #${exercise.id}: thiếu tiêu đề hoặc prompt`
          : null,
      ),
      ...set.exercises.flatMap((exercise) =>
        taskTypeValidationErrors({
          taskType: exercise.taskType,
          targetText: exercise.targetText,
          imageUrl: exercise.imageUrl,
          stimulusId: exercise.stimulusId,
          stimulus: exercise.stimulus,
        }).map((error) => `Exercise #${exercise.id}: ${error}`),
      ),
    ].filter((value): value is string => Boolean(value));
    if (set.scope === 'EXAM_INTERNAL') {
      errors.push(...toeicSpeakingContractErrors(set));
    }
    return {
      valid: errors.length === 0,
      errors,
      domain: 'speaking',
      contentId: set.id,
    };
  }

  private async assertNoSpeakingHistory(setId: string) {
    const count = await this.prisma.speakingSubmission.count({
      where: { exercise: { practiceSetId: setId } },
    });
    if (count > 0)
      throw new ConflictException(
        'Nội dung Speaking đã có lịch sử làm bài; tạo phiên bản mới thay vì sửa trực tiếp',
      );
  }
}
