import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { AiService } from './ai.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { SmartGeneratedContent } from './strategies/ai-evaluator.interface';
import * as crypto from 'crypto';
import * as mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

export interface AiJobStatus {
  id: string;
  status: 'queued' | 'processing' | 'done' | 'failed';
  progress: number;
  message?: string;
  filename?: string;
  result?: SmartGeneratedContent;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

export class PublishContentDto {
  quizTitle?: string;
  quizQuestions?: Array<{
    question: string;
    options: string[];
    correctIndex: number;
    explanation: string;
  }>;
  vocabTopicTitle?: string;
  flashcards?: Array<{
    term: string;
    pos?: string;
    ipa?: string;
    meaning: string;
    example: string;
  }>;
  assignmentTitle?: string;
  assignmentDescription?: string;
  targetClassId?: number;
  publishQuiz?: boolean;
  publishFlashcards?: boolean;
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

  /**
   * Khởi tạo Job sinh nội dung bất đồng bộ và lưu vào Redis
   */
  async startGenerationJob(
    file?: Express.Multer.File,
    rawText?: string,
    options?: { quizCount?: number; flashcardCount?: number },
  ): Promise<{ jobId: string; status: string; message: string }> {
    let documentText = '';
    let filename = 'Direct Text Input';

    if (file) {
      filename = file.originalname;
      documentText = await this.extractTextFromBuffer(
        file.buffer,
        file.mimetype,
        file.originalname,
      );
    } else if (rawText && rawText.trim()) {
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

    // Kiểm tra quota trước khi tạo Job
    const quota = await this.getQuotaStatus();
    if (quota.used >= this.DAILY_LIMIT) {
      throw new BadRequestException(
        `Hệ thống đã đạt giới hạn an toàn ${this.DAILY_LIMIT} requests Gemini hôm nay. Vui lòng quay lại vào ngày mai!`,
      );
    }

    const jobId = crypto.randomUUID();
    const initialJob: AiJobStatus = {
      id: jobId,
      status: 'queued',
      progress: 10,
      filename,
      message: 'Đang xếp hàng xử lý tài liệu...',
      createdAt: new Date().toISOString(),
    };

    await this.redis.set(
      `ai_job:${jobId}`,
      JSON.stringify(initialJob),
      'EX',
      86400,
    );

    // Chạy bất đồng bộ không chặn request
    this.processJob(jobId, documentText, options).catch((err) => {
      this.logger.error(
        `Job ${jobId} failed with unhandled error: ${err.message}`,
      );
    });

    return {
      jobId,
      status: 'queued',
      message:
        'Đã tạo tiến trình xử lý AI. Vui lòng kiểm tra tiến độ qua jobId.',
    };
  }

  /**
   * Tiến trình xử lý nền (Background Worker)
   */
  private async processJob(
    jobId: string,
    documentText: string,
    options?: { quizCount?: number; flashcardCount?: number },
  ) {
    this.logger.log(`Starting background processing for Job ${jobId}...`);

    try {
      // Update status to processing
      await this.updateJobStatus(jobId, {
        status: 'processing',
        progress: 35,
        message: 'Đang phân tích tài liệu và khởi tạo mô hình Gemini AI...',
      });

      // Call AI Service
      const result = await this.aiService.generateSmartContentFromDocument(
        documentText,
        options,
      );

      // Increment Redis Quota Counter
      const newUsed = await this.incrementQuota();
      this.logger.log(
        `Job ${jobId} finished successfully. Daily Gemini Quota: ${newUsed}/${this.DAILY_LIMIT}`,
      );

      // Save Done state
      await this.updateJobStatus(jobId, {
        status: 'done',
        progress: 100,
        message: 'Đã sinh thành công bộ trắc nghiệm, flashcard và bài tập!',
        result,
        completedAt: new Date().toISOString(),
      });
    } catch (error: any) {
      this.logger.error(`Error processing job ${jobId}: ${error.message}`);
      await this.updateJobStatus(jobId, {
        status: 'failed',
        progress: 100,
        error: error.message || 'Lỗi không xác định khi gọi AI',
        message: `Xử lý thất bại: ${error.message}`,
        completedAt: new Date().toISOString(),
      });
    }
  }

  private async updateJobStatus(jobId: string, updates: Partial<AiJobStatus>) {
    const raw = await this.redis.get(`ai_job:${jobId}`);
    if (!raw) return;
    const current: AiJobStatus = JSON.parse(raw);
    const updated = { ...current, ...updates };
    await this.redis.set(
      `ai_job:${jobId}`,
      JSON.stringify(updated),
      'EX',
      86400,
    );
  }

  /**
   * Lấy trạng thái chi tiết của Job
   */
  async getJobStatus(jobId: string): Promise<AiJobStatus> {
    const raw = await this.redis.get(`ai_job:${jobId}`);
    if (!raw) {
      throw new NotFoundException(
        `Không tìm thấy tiến trình với jobId: ${jobId}`,
      );
    }
    return JSON.parse(raw) as AiJobStatus;
  }

  /**
   * Lấy kết quả JSON của Job để Review
   */
  async getJobResult(jobId: string) {
    const job = await this.getJobStatus(jobId);
    if (job.status !== 'done' || !job.result) {
      throw new BadRequestException(
        `Tiến trình chưa hoàn tất (Trạng thái: ${job.status}).`,
      );
    }
    return job.result;
  }

  /**
   * Duyệt và Phê duyệt (Review & Publish) lưu dữ liệu vào PostgreSQL chính thức
   */
  async publishContent(jobId: string, payload: PublishContentDto) {
    this.logger.log(`Publishing approved AI content for Job ${jobId}...`);

    let createdQuizId: number | null = null;
    let createdVocabTopicId: number | null = null;
    let createdAssignmentId: number | null = null;

    // 1. Phê duyệt & Lưu Bộ Câu Hỏi Trắc Nghiệm vào Quiz & Question
    if (
      payload.publishQuiz !== false &&
      payload.quizQuestions &&
      payload.quizQuestions.length > 0
    ) {
      const quiz = await this.prisma.quiz.create({
        data: {
          title:
            payload.quizTitle ||
            `Đề Trắc Nghiệm AI: ${new Date().toLocaleDateString('vi-VN')}`,
          description: `Được tạo tự động bởi AI Smart Generator từ tài liệu giáo trình (${payload.quizQuestions.length} câu hỏi).`,
          type: 'TOEIC',
          timeLimit: Math.max(10, payload.quizQuestions.length * 2),
          questions: {
            create: payload.quizQuestions.map((q, idx) => ({
              type: 'MULTIPLE_CHOICE',
              order: idx + 1,
              content: {
                text: q.question,
                options: q.options,
                correctAnswer: q.options[q.correctIndex] || q.options[0],
                explanation: q.explanation || '',
              },
            })),
          },
        },
      });
      createdQuizId = quiz.id;
      this.logger.log(
        `Created Quiz #${createdQuizId} with ${payload.quizQuestions.length} questions`,
      );
    }

    // 2. Phê duyệt & Lưu Bộ Flashcard vào VocabTopic & VocabWord
    if (
      payload.publishFlashcards !== false &&
      payload.flashcards &&
      payload.flashcards.length > 0
    ) {
      const topic = await this.prisma.vocabTopic.create({
        data: {
          title:
            payload.vocabTopicTitle ||
            `Từ Vựng AI: ${new Date().toLocaleDateString('vi-VN')}`,
          categoryName: 'GENERAL ENGLISH',
          iconUrl: '💡',
          totalWords: payload.flashcards.length,
          isPro: false,
          words: {
            create: payload.flashcards.map((fc) => ({
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
      createdVocabTopicId = topic.id;
      this.logger.log(
        `Created VocabTopic #${createdVocabTopicId} with ${payload.flashcards.length} flashcards`,
      );
    }

    // 3. Phê duyệt & Giao Bài Tập Về Nhà vào Assignment cho Lớp học
    if (
      payload.publishAssignment !== false &&
      payload.targetClassId &&
      payload.assignmentTitle
    ) {
      const assignment = await this.prisma.assignment.create({
        data: {
          classId: payload.targetClassId,
          title: payload.assignmentTitle,
          description: payload.assignmentDescription || '',
          type: 'ESSAY',
          dueDate: new Date(Date.now() + 86400000 * 7), // 7 ngày sau
        },
      });
      createdAssignmentId = assignment.id;
      this.logger.log(
        `Created Assignment #${createdAssignmentId} for Class #${payload.targetClassId}`,
      );
    }

    return {
      success: true,
      message:
        'Đã phê duyệt và xuất bản toàn bộ nội dung học tập vào hệ thống thành công!',
      quizId: createdQuizId,
      vocabTopicId: createdVocabTopicId,
      assignmentId: createdAssignmentId,
    };
  }
}
