import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Allow } from 'class-validator';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import {
  AiGenerationJobStatus,
  AiGenerationJobType,
  Prisma,
} from '@prisma/client';
import { AiService } from './ai.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SmartGeneratedContent } from './strategies/ai-evaluator.interface';
import * as crypto from 'crypto';
import * as mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

export interface AiJobStatus {
  id: string;
  status:
    'queued' | 'processing' | 'done' | 'failed' | 'approved' | 'published';
  lifecycleStatus: AiGenerationJobStatus;
  progress: number;
  message?: string;
  filename?: string;
  result?: SmartGeneratedContent;
  error?: string;
  createdAt: string;
  completedAt?: string;
  reviewedAt?: string;
  publishedAt?: string;
  generationType?: AiGenerationJobType;
  attempt?: number;
}

export class PublishContentDto {
  @Allow()
  quizTitle?: string;
  @Allow()
  quizQuestions?: Array<{
    question: string;
    options: string[];
    correctIndex: number;
    explanation: string;
  }>;
  @Allow()
  vocabTopicTitle?: string;
  @Allow()
  flashcards?: Array<{
    term: string;
    pos?: string;
    ipa?: string;
    meaning: string;
    example: string;
  }>;
  @Allow()
  assignmentTitle?: string;
  @Allow()
  assignmentDescription?: string;
  @Allow()
  targetClassId?: number;
  @Allow()
  publishQuiz?: boolean;
  @Allow()
  publishFlashcards?: boolean;
  @Allow()
  publishAssignment?: boolean;
}

@Injectable()
export class AiGeneratorService {
  private readonly logger = new Logger(AiGeneratorService.name);
  private readonly DAILY_LIMIT = 500;

  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly aiService: AiService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Lấy ngày hiện tại theo chuẩn UTC (YYYY-MM-DD) để tính Quota 24h của Google AI
   */
  private getTodayUtcKey(): string {
    return `gemini:daily_quota:${new Date().toISOString().slice(0, 10)}`;
  }

  /**
   * Lấy trạng thái Quota Gemini sử dụng trong ngày từ Redis
   */
  async getQuotaStatus() {
    const key = this.getTodayUtcKey();
    const rawCount = await this.redis.get(key);
    const used = rawCount ? parseInt(rawCount, 10) : 0;
    const remaining = Math.max(0, this.DAILY_LIMIT - used);
    const percentage = Math.min(
      100,
      Math.round((used / this.DAILY_LIMIT) * 100),
    );

    return {
      date: new Date().toISOString().slice(0, 10),
      used,
      limit: this.DAILY_LIMIT,
      remaining,
      percentage,
      isNearLimit: used >= 400,
      modelName: process.env.GEMINI_MODEL_NAME || 'gemini-3.1-flash-lite',
    };
  }

  /**
   * Tăng bộ đếm quota trong Redis và đặt TTL 48h
   */
  private async incrementQuota(): Promise<number> {
    const key = this.getTodayUtcKey();
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, 86400 * 2);
    }
    return count;
  }

  /**
   * Trích xuất văn bản từ File buffer (PDF, DOCX, TXT)
   */
  async extractTextFromBuffer(
    buffer: Buffer,
    mimetype: string,
    filename: string,
  ): Promise<string> {
    const lowerName = filename.toLowerCase();

    try {
      if (mimetype === 'application/pdf' || lowerName.endsWith('.pdf')) {
        this.logger.log(
          `Extracting text from PDF: ${filename} (${buffer.length} bytes)`,
        );
        const parser = new PDFParse({ data: buffer });
        const result = await parser.getText();
        const text = String(result?.text || '').trim();
        await parser.destroy().catch(() => {});
        if (!text) {
          throw new BadRequestException(
            'File PDF không có nội dung văn bản (có thể là file scan hoặc ảnh).',
          );
        }
        return text;
      }

      if (
        mimetype ===
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        lowerName.endsWith('.docx')
      ) {
        this.logger.log(`Extracting text from DOCX: ${filename}`);
        const result = await mammoth.extractRawText({ buffer });
        return String(result?.value || '').trim();
      }

      // Default plain text
      return buffer.toString('utf-8').trim();
    } catch (error: any) {
      this.logger.error(
        `Error extracting text from file ${filename}: ${error.message}`,
      );
      throw new BadRequestException(
        `Không thể trích xuất văn bản từ file: ${error.message}`,
      );
    }
  }

  private jobStatusLabel(status: AiGenerationJobStatus): AiJobStatus['status'] {
    switch (status) {
      case AiGenerationJobStatus.GENERATED:
        return 'done';
      case AiGenerationJobStatus.APPROVED:
        return 'approved';
      case AiGenerationJobStatus.PUBLISHED:
        return 'published';
      case AiGenerationJobStatus.PROCESSING:
        return 'processing';
      case AiGenerationJobStatus.FAILED:
        return 'failed';
      default:
        return 'queued';
    }
  }

  private async mirrorJob(jobId: string, updates: Partial<AiJobStatus>) {
    const existing = await this.redis.get(`ai_job:${jobId}`);
    const current = existing
      ? (JSON.parse(existing) as AiJobStatus)
      : { id: jobId };
    await this.redis.set(
      `ai_job:${jobId}`,
      JSON.stringify({ ...current, ...updates }),
      'EX',
      86400,
    );
  }

  private async durableStatus(jobId: string): Promise<AiJobStatus> {
    const job = await this.prisma.aiGenerationJob.findUnique({
      where: { id: jobId },
    });
    if (!job)
      throw new NotFoundException(
        `Không tìm thấy tiến trình với jobId: ${jobId}`,
      );
    return {
      id: job.id,
      status: this.jobStatusLabel(job.status),
      lifecycleStatus: job.status,
      progress:
        job.status === AiGenerationJobStatus.QUEUED
          ? 10
          : job.status === AiGenerationJobStatus.PROCESSING
            ? 35
            : 100,
      message:
        job.errorSummary ??
        (job.status === AiGenerationJobStatus.GENERATED
          ? 'Đã sinh bản nháp, chờ quản trị viên xem duyệt.'
          : undefined),
      filename:
        typeof job.requestSnapshot === 'object' &&
        job.requestSnapshot !== null &&
        'filename' in job.requestSnapshot
          ? String(
              (job.requestSnapshot as Record<string, unknown>).filename ?? '',
            )
          : undefined,
      error: job.errorSummary ?? undefined,
      createdAt: job.createdAt.toISOString(),
      completedAt: job.completedAt?.toISOString(),
      reviewedAt: job.reviewedAt?.toISOString(),
      publishedAt: job.publishedAt?.toISOString(),
      generationType: job.generationType,
      attempt: job.attempt,
    };
  }

  async startGenerationJob(
    file: Express.Multer.File | undefined,
    rawText: string | undefined,
    options: { quizCount?: number; flashcardCount?: number } | undefined,
    createdByAdminId: number,
    idempotencyKey?: string,
  ): Promise<{
    jobId: string;
    status: string;
    lifecycleStatus: string;
    message: string;
  }> {
    let documentText = '';
    const filename = file?.originalname ?? 'Direct Text Input';
    if (file) {
      documentText = await this.extractTextFromBuffer(
        file.buffer,
        file.mimetype,
        file.originalname,
      );
    } else if (rawText?.trim()) {
      documentText = rawText.trim();
    } else {
      throw new BadRequestException(
        'Vui lòng cung cấp file (PDF/DOCX) hoặc nhập văn bản tài liệu.',
      );
    }
    if (documentText.length < 50) {
      throw new BadRequestException(
        'Nội dung tài liệu quá ngắn (tối thiểu 50 ký tự) để AI có thể sinh câu hỏi.',
      );
    }
    const quota = await this.getQuotaStatus();
    if (quota.used >= this.DAILY_LIMIT) {
      throw new BadRequestException(
        `Hệ thống đã đạt giới hạn an toàn ${this.DAILY_LIMIT} requests Gemini hôm nay.`,
      );
    }
    if (idempotencyKey) {
      const existing = await this.prisma.aiGenerationJob.findUnique({
        where: { idempotencyKey },
      });
      if (existing)
        return {
          jobId: existing.id,
          status: this.jobStatusLabel(existing.status),
          lifecycleStatus: existing.status,
          message:
            'Yêu cầu trùng idempotency key; dùng lại tiến trình hiện có.',
        };
    }
    const jobId = crypto.randomUUID();
    try {
      await this.prisma.aiGenerationJob.create({
        data: {
          id: jobId,
          createdByAdminId,
          generationType: AiGenerationJobType.SMART_CONTENT,
          status: AiGenerationJobStatus.QUEUED,
          idempotencyKey,
          requestSnapshot: {
            filename,
            sourceText: documentText.slice(0, 200000),
            options: options ?? {},
          },
          provider: 'gemini',
          model: process.env.GEMINI_MODEL_NAME || 'gemini-3.1-flash-lite',
          generatorVersion: 'phase5-smart-generator-v1',
          promptVersion: 'smart-content-v1',
        },
      });
    } catch (error) {
      if (
        idempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.prisma.aiGenerationJob.findUnique({
          where: { idempotencyKey },
        });
        if (existing) {
          return {
            jobId: existing.id,
            status: this.jobStatusLabel(existing.status),
            lifecycleStatus: existing.status,
            message:
              'Yêu cầu trùng idempotency key; dùng lại tiến trình hiện có.',
          };
        }
      }
      throw error;
    }
    await this.mirrorJob(jobId, {
      id: jobId,
      status: 'queued',
      lifecycleStatus: AiGenerationJobStatus.QUEUED,
      progress: 10,
      filename,
      message: 'Đang xếp hàng xử lý tài liệu...',
      createdAt: new Date().toISOString(),
    });
    this.processJob(jobId, documentText, options).catch((err: Error) =>
      this.logger.error(
        `Job ${jobId} failed with unhandled error: ${err.message}`,
      ),
    );
    return {
      jobId,
      status: 'queued',
      lifecycleStatus: AiGenerationJobStatus.QUEUED,
      message:
        'Đã tạo tiến trình AI bền vững; bản nháp sẽ chờ quản trị viên xem duyệt.',
    };
  }

  private async processJob(
    jobId: string,
    documentText: string,
    options?: { quizCount?: number; flashcardCount?: number },
  ) {
    this.logger.log(`Starting background processing for Job ${jobId}...`);
    await this.prisma.aiGenerationJob.update({
      where: { id: jobId },
      data: { status: AiGenerationJobStatus.PROCESSING, startedAt: new Date() },
    });
    await this.mirrorJob(jobId, {
      status: 'processing',
      lifecycleStatus: AiGenerationJobStatus.PROCESSING,
      progress: 35,
      message: 'Đang phân tích tài liệu và khởi tạo mô hình Gemini AI...',
    });
    try {
      const result = await this.aiService.generateSmartContentFromDocument(
        documentText,
        options,
      );
      const newUsed = await this.incrementQuota();
      await this.prisma.aiGenerationJob.update({
        where: { id: jobId },
        data: {
          status: AiGenerationJobStatus.GENERATED,
          resultSnapshot: result as unknown as Prisma.InputJsonValue,
          completedAt: new Date(),
          providerUsage: { requests: 1, dailyQuotaUsed: newUsed },
        },
      });
      await this.mirrorJob(jobId, {
        status: 'done',
        lifecycleStatus: AiGenerationJobStatus.GENERATED,
        progress: 100,
        message:
          'Đã sinh bản nháp; cần quản trị viên xem duyệt trước khi xuất bản.',
        result,
        completedAt: new Date().toISOString(),
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Lỗi không xác định khi gọi AI';
      this.logger.error(`Error processing job ${jobId}: ${message}`);
      await this.prisma.aiGenerationJob.update({
        where: { id: jobId },
        data: {
          status: AiGenerationJobStatus.FAILED,
          errorSummary: message.slice(0, 1000),
          completedAt: new Date(),
        },
      });
      await this.mirrorJob(jobId, {
        status: 'failed',
        lifecycleStatus: AiGenerationJobStatus.FAILED,
        progress: 100,
        error: message,
        message: `Xử lý thất bại: ${message}`,
        completedAt: new Date().toISOString(),
      });
    }
  }

  async getJobStatus(jobId: string): Promise<AiJobStatus> {
    const status = await this.durableStatus(jobId);
    await this.mirrorJob(jobId, status);
    return status;
  }

  async getJobResult(jobId: string) {
    const job = await this.prisma.aiGenerationJob.findUnique({
      where: { id: jobId },
    });
    if (!job || !job.resultSnapshot)
      throw new NotFoundException(
        `Không tìm thấy bản nháp với jobId: ${jobId}`,
      );
    if (
      job.status !== AiGenerationJobStatus.GENERATED &&
      job.status !== AiGenerationJobStatus.APPROVED &&
      job.status !== AiGenerationJobStatus.PUBLISHED
    ) {
      throw new BadRequestException(
        `Tiến trình chưa có bản nháp để xem (Trạng thái: ${job.status}).`,
      );
    }
    return job.draftSnapshot ?? job.resultSnapshot;
  }

  async listJobs(page = 1, limit = 20) {
    const safePage = Math.max(1, Math.floor(page));
    const safeLimit = Math.min(50, Math.max(1, Math.floor(limit)));
    const [items, total] = await this.prisma.$transaction([
      this.prisma.aiGenerationJob.findMany({
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          generationType: true,
          status: true,
          provider: true,
          model: true,
          createdAt: true,
          completedAt: true,
          reviewedAt: true,
          publishedAt: true,
          publishedResources: true,
          errorSummary: true,
        },
      }),
      this.prisma.aiGenerationJob.count(),
    ]);
    return {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit),
      items,
    };
  }

  async getJobDetail(jobId: string) {
    const job = await this.prisma.aiGenerationJob.findUnique({
      where: { id: jobId },
    });
    if (!job)
      throw new NotFoundException(
        `Không tìm thấy tiến trình với jobId: ${jobId}`,
      );
    return job;
  }

  async updateDraft(jobId: string, payload: PublishContentDto) {
    this.validatePayload(payload);
    const job = await this.prisma.aiGenerationJob.findUnique({
      where: { id: jobId },
    });
    if (!job) throw new NotFoundException('Không tìm thấy tiến trình AI.');
    if (
      job.status !== AiGenerationJobStatus.GENERATED &&
      job.status !== AiGenerationJobStatus.APPROVED
    )
      throw new ConflictException(
        'Chỉ có thể chỉnh sửa bản nháp đang chờ duyệt.',
      );
    await this.prisma.aiGenerationJob.update({
      where: { id: jobId },
      data: {
        draftSnapshot: payload as unknown as Prisma.InputJsonValue,
        status: AiGenerationJobStatus.GENERATED,
        reviewedAt: null,
        reviewedByAdminId: null,
      },
    });
    return {
      success: true,
      status: AiGenerationJobStatus.GENERATED,
      draft: payload,
    };
  }

  async approveDraft(
    jobId: string,
    payload: PublishContentDto,
    adminId: number,
  ) {
    this.validatePayload(payload);
    const job = await this.prisma.aiGenerationJob.findUnique({
      where: { id: jobId },
    });
    if (!job) throw new NotFoundException('Không tìm thấy tiến trình AI.');
    if (
      job.status !== AiGenerationJobStatus.GENERATED &&
      job.status !== AiGenerationJobStatus.APPROVED
    )
      throw new ConflictException(
        'Tiến trình không ở trạng thái có thể phê duyệt.',
      );
    const approved = await this.prisma.aiGenerationJob.update({
      where: { id: jobId },
      data: {
        status: AiGenerationJobStatus.APPROVED,
        approvedSnapshot: payload as unknown as Prisma.InputJsonValue,
        draftSnapshot: payload as unknown as Prisma.InputJsonValue,
        reviewedAt: new Date(),
        reviewedByAdminId: adminId,
      },
    });
    return {
      success: true,
      jobId,
      status: approved.status,
      reviewedAt: approved.reviewedAt,
    };
  }

  private validatePayload(payload: PublishContentDto) {
    if (payload.publishQuiz !== false) {
      if (!payload.quizQuestions?.length)
        throw new BadRequestException(
          'Bản nháp phải có ít nhất một câu hỏi hoặc bỏ chọn lưu đề.',
        );
      for (const [index, question] of payload.quizQuestions.entries()) {
        if (
          !question.question?.trim() ||
          !Array.isArray(question.options) ||
          question.options.length < 2 ||
          !Number.isInteger(question.correctIndex) ||
          question.correctIndex < 0 ||
          question.correctIndex >= question.options.length ||
          question.options.some((option) => !option?.trim())
        )
          throw new BadRequestException(`Câu hỏi ${index + 1} không hợp lệ.`);
      }
    }
    if (payload.publishFlashcards !== false) {
      if (!payload.flashcards?.length)
        throw new BadRequestException(
          'Bản nháp phải có ít nhất một flashcard hoặc bỏ chọn lưu flashcard.',
        );
      if (
        payload.flashcards.some(
          (card) => !card.term?.trim() || !card.meaning?.trim(),
        )
      )
        throw new BadRequestException('Flashcard không hợp lệ.');
    }
    if (
      payload.publishAssignment !== false &&
      payload.targetClassId &&
      !payload.assignmentTitle?.trim()
    )
      throw new BadRequestException('Bài tập phải có tiêu đề.');
  }

  async publishContent(
    jobId: string,
    payload: PublishContentDto,
    adminId: number,
  ) {
    const job = await this.prisma.aiGenerationJob.findUnique({
      where: { id: jobId },
    });
    if (!job) throw new NotFoundException('Không tìm thấy tiến trình AI.');
    if (job.status === AiGenerationJobStatus.PUBLISHED)
      return {
        success: true,
        ...((job.publishedResources as Record<string, unknown>) ?? {}),
        status: job.status,
        idempotent: true,
      };
    if (job.status !== AiGenerationJobStatus.APPROVED || !job.approvedSnapshot)
      throw new ConflictException('Cần phê duyệt bản nháp trước khi xuất bản.');
    const approved = job.approvedSnapshot as unknown as PublishContentDto;
    this.validatePayload(approved);
    const resources = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.aiGenerationJob.updateMany({
        where: { id: jobId, status: AiGenerationJobStatus.APPROVED },
        data: { status: AiGenerationJobStatus.PUBLISHING },
      });
      if (claim.count !== 1) {
        throw new ConflictException(
          'Một yêu cầu xuất bản khác đang được xử lý. Vui lòng tải lại lịch sử job.',
        );
      }
      let quizId: number | null = null;
      let vocabTopicId: number | null = null;
      let assignmentId: number | null = null;
      if (approved.publishQuiz !== false && approved.quizQuestions?.length) {
        const quiz = await tx.quiz.create({
          data: {
            title:
              approved.quizTitle ||
              `Đề Trắc Nghiệm AI: ${new Date().toLocaleDateString('vi-VN')}`,
            description: `Bản nháp AI đã được quản trị viên duyệt (${approved.quizQuestions.length} câu hỏi).`,
            type: 'TOEIC',
            publicationStatus: 'PUBLISHED',
            publishedAt: new Date(),
            timeLimit: Math.max(10, approved.quizQuestions.length * 2),
            questions: {
              create: approved.quizQuestions.map((q, idx) => ({
                type: 'MULTIPLE_CHOICE',
                order: idx + 1,
                content: {
                  text: q.question,
                  options: q.options,
                  correctAnswer: q.options[q.correctIndex],
                  explanation: q.explanation || '',
                },
              })),
            },
          },
        });
        quizId = quiz.id;
      }
      if (approved.publishFlashcards !== false && approved.flashcards?.length) {
        const topic = await tx.vocabTopic.create({
          data: {
            title:
              approved.vocabTopicTitle ||
              `Từ Vựng AI: ${new Date().toLocaleDateString('vi-VN')}`,
            categoryName: 'GENERAL ENGLISH',
            iconUrl: '💡',
            totalWords: approved.flashcards.length,
            isPro: false,
            words: {
              create: approved.flashcards.map((fc) => ({
                word: fc.term,
                pos: fc.pos || 'noun',
                meaning: fc.meaning,
                ipaUs: fc.ipa || '',
                exampleEn: fc.example || '',
                exampleVi: fc.meaning,
                audioUs: `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(fc.term)}&type=2`,
              })),
            },
          },
        });
        vocabTopicId = topic.id;
      }
      if (
        approved.publishAssignment !== false &&
        approved.targetClassId &&
        approved.assignmentTitle
      ) {
        const assignment = await tx.assignment.create({
          data: {
            classId: approved.targetClassId,
            title: approved.assignmentTitle,
            description: approved.assignmentDescription || '',
            type: 'ESSAY',
            dueDate: new Date(Date.now() + 86400000 * 7),
          },
        });
        assignmentId = assignment.id;
      }
      await tx.aiGenerationJob.update({
        where: { id: jobId },
        data: {
          status: AiGenerationJobStatus.PUBLISHED,
          publishedByAdminId: adminId,
          publishedAt: new Date(),
          publishedResources: { quizId, vocabTopicId, assignmentId },
        },
      });
      return { quizId, vocabTopicId, assignmentId };
    });
    this.logger.log(
      `AI authoring job ${jobId} published resources ${JSON.stringify(resources)}`,
    );
    return {
      success: true,
      ...resources,
      status: AiGenerationJobStatus.PUBLISHED,
      message: 'Đã phê duyệt và xuất bản nội dung an toàn.',
    };
  }

  async retryJob(jobId: string, adminId: number) {
    const job = await this.prisma.aiGenerationJob.findUnique({
      where: { id: jobId },
    });
    if (!job) throw new NotFoundException('Không tìm thấy tiến trình AI.');
    if (job.status !== AiGenerationJobStatus.FAILED)
      throw new ConflictException('Chỉ có thể thử lại tiến trình thất bại.');
    const request = job.requestSnapshot as Record<string, unknown>;
    const sourceText =
      typeof request.sourceText === 'string' ? request.sourceText : '';
    const options =
      request.options && typeof request.options === 'object'
        ? (request.options as { quizCount?: number; flashcardCount?: number })
        : undefined;
    await this.prisma.aiGenerationJob.update({
      where: { id: jobId },
      data: {
        status: AiGenerationJobStatus.QUEUED,
        errorSummary: null,
        failureHistory: [
          ...(Array.isArray(job.failureHistory) ? job.failureHistory : []),
          { error: job.errorSummary, at: new Date().toISOString() },
        ],
        attempt: { increment: 1 },
      },
    });
    await this.mirrorJob(jobId, {
      status: 'queued',
      lifecycleStatus: AiGenerationJobStatus.QUEUED,
      progress: 10,
      message: 'Đang xếp hàng thử lại...',
    });
    this.processJob(jobId, sourceText, options).catch((err: Error) =>
      this.logger.error(`Retry ${jobId} failed: ${err.message}`),
    );
    return {
      jobId,
      status: 'queued',
      lifecycleStatus: AiGenerationJobStatus.QUEUED,
      retriedBy: adminId,
    };
  }
}
