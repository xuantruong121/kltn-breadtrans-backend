import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, QuizPublicationStatus, QuizType, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SkillContentDto, SkillQuestionDto } from './skill-cms.dto';

type Domain = 'listening' | 'reading' | 'writing' | 'speaking';
type Admin = { id: number; role: Role };

const QUIZ_DOMAINS: Record<Exclude<Domain, 'speaking'>, QuizType> = {
  listening: QuizType.LISTENING_PRACTICE,
  reading: QuizType.BILINGUAL_READING,
  writing: QuizType.WRITING_EMAIL,
};

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
  constructor(private readonly prisma: PrismaService) {}

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

  async list(rawDomain: string, user: Admin) {
    this.admin(user);
    const domain = this.domain(rawDomain);
    if (domain === 'speaking') {
      throw new ConflictException(
        'CMS_SPEAKING_INCOMPLETE: Speaking schema chưa có publication status; không mở editor để tránh draft lộ learner',
      );
    }
    return this.prisma.quiz.findMany({
      where: { type: this.quizType(domain) },
      orderBy: { id: 'desc' },
      include: { _count: { select: { questions: true, submissions: true } } },
    });
  }

  async get(rawDomain: string, rawId: string, user: Admin) {
    this.admin(user);
    const domain = this.domain(rawDomain);
    if (domain === 'speaking') {
      throw new ConflictException(
        'CMS_SPEAKING_INCOMPLETE: Speaking schema chưa có publication status',
      );
    }
    const id = this.id(rawId);
    const quiz = await this.prisma.quiz.findFirst({
      where: { id, type: this.quizType(domain) },
      include: {
        questions: { orderBy: { order: 'asc' } },
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
      throw new ConflictException(
        'CMS_SPEAKING_INCOMPLETE: cần publication status additive migration trước khi tạo draft Speaking',
      );
    }
    const type = this.quizType(domain);
    const writingType =
      domain === 'writing' && dto.type === 'WRITING_PICTURE'
        ? QuizType.WRITING_PICTURE
        : type;
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
      throw new ConflictException(
        'CMS_SPEAKING_INCOMPLETE: cần publication status additive migration trước khi sửa Speaking',
      );
    }
    const id = this.id(rawId);
    const quiz = await this.prisma.quiz.findFirst({
      where: { id, type: this.quizType(domain) },
    });
    if (!quiz) throw new NotFoundException('Skill content not found');
    await this.assertNoHistory(id);
    const type =
      domain === 'writing' && dto.type === 'WRITING_PICTURE'
        ? QuizType.WRITING_PICTURE
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
      where: { id: quizId, type: this.quizType(domain) },
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
      where: { id: questionId, quizId, quiz: { type: this.quizType(domain) } },
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
      where: { id: questionId, quizId, quiz: { type: this.quizType(domain) } },
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
    if (domain === 'speaking')
      throw new ConflictException(
        'CMS_SPEAKING_INCOMPLETE: chưa thể validate Speaking draft an toàn',
      );
    const quiz = (await this.get(domain, rawId, user)) as unknown as {
      id: number;
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
        typeof (content.prompt ?? content.text) !== 'string'
      )
        errors.push(`Câu ${index + 1}: thiếu đề bài Writing`);
      if (
        domain === 'listening' &&
        question.type === 'DIALOGUE' &&
        !Array.isArray(content.transcriptSegments)
      )
        errors.push(`Câu ${index + 1}: thiếu transcriptSegments`);
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
      throw new ConflictException(
        'CMS_SPEAKING_INCOMPLETE: chưa thể publish Speaking draft an toàn',
      );
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
}
