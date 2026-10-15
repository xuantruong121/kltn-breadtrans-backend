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
  WritingQuestionDto,
} from './skill-cms.dto';
import { QuizService } from '../quiz/quiz.service';
import { ListeningAudioAuthoringService } from '../quiz/listening-audio-authoring.service';
import { normalizeDialogueSegments } from '../quiz/listening-dialogue.contract';

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
        orderBy: { updatedAt: 'desc' },
        include: {
          exercises: {
            orderBy: { id: 'asc' },
            include: { _count: { select: { submissions: true } } },
          },
        },
      });
    }
    return this.prisma.quiz.findMany({
      where: this.contentTypeWhere(domain),
      orderBy: { id: 'desc' },
      include: { _count: { select: { questions: true, submissions: true } } },
    });
  }

  async get(rawDomain: string, rawId: string, user: Admin) {
    this.admin(user);
    const domain = this.domain(rawDomain);
    if (domain === 'speaking') {
      const set = await this.prisma.speakingPracticeSet.findUnique({
        where: { id: rawId },
        include: { exercises: { orderBy: { id: 'asc' } } },
      });
      if (!set) throw new NotFoundException('Speaking practice set not found');
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
      const title = dto.title.trim();
      const id = `speaking-${randomUUID()}`;
      return this.prisma.speakingPracticeSet.create({
        data: {
          id,
          title,
          description: dto.description?.trim() ?? '',
          category: dto.category?.trim() || 'GENERAL',
          level: dto.level?.trim() || 'BEGINNER',
          publicationStatus: QuizPublicationStatus.DRAFT,
        },
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
      const set = await this.prisma.speakingPracticeSet.findUnique({
        where: { id: rawId },
      });
      if (!set) throw new NotFoundException('Speaking practice set not found');
      await this.assertNoSpeakingHistory(rawId);
      return this.prisma.speakingPracticeSet.update({
        where: { id: rawId },
        data: {
          title: dto.title?.trim(),
          description: dto.description?.trim(),
          category: dto.category?.trim(),
          level: dto.level?.trim(),
        },
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
    return this.prisma.question.update({
      where: { id: questionId },
      data: {
        type: dto.type,
        content: asJson(dto.content),
        order: dto.order,
      },
    });
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
    return this.prisma.speakingExercise.create({
      data: {
        title: dto.title.trim(),
        targetText: dto.targetText.trim(),
        category: dto.category?.trim() || set.category,
        difficulty: dto.difficulty || set.level,
        imageUrl: dto.imageUrl,
        audioUrl: dto.audioUrl,
        isPremiumContent: dto.isPremiumContent ?? false,
        practiceSetId: rawSetId,
        publicationStatus: QuizPublicationStatus.DRAFT,
      },
    });
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
        practiceSet: { select: { category: true } },
      },
    });
    if (!exercise) throw new NotFoundException('Speaking exercise not found');
    await this.assertNoSpeakingHistory(rawSetId);
    return this.prisma.speakingExercise.update({
      where: { id: exerciseId },
      data: {
        title: dto.title?.trim(),
        targetText: dto.targetText?.trim(),
        category:
          dto.category?.trim() ||
          exercise.practiceSet?.category ||
          exercise.category,
        difficulty: dto.difficulty,
        imageUrl: dto.imageUrl,
        audioUrl: dto.audioUrl,
        isPremiumContent: dto.isPremiumContent,
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
    return this.prisma.speakingExercise.delete({ where: { id: exerciseId } });
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
      questions: Array<{ type: string; content: unknown }>;
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
        (typeof content.imageUrl !== 'string' || !content.imageUrl.trim())
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
    await this.assertNoHistory(quizId);
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
      include: { exercises: true },
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
    ].filter((value): value is string => Boolean(value));
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
