import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { UploadService } from '../upload/upload.service';
import { CreateExerciseDto } from './dto/create-exercise.dto';
import * as streamifier from 'streamifier';

@Injectable()
export class SpeakingService {
  private readonly logger = new Logger(SpeakingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
    private readonly uploadService: UploadService,
  ) { }

  async findAllExercises(category?: string) {
    return this.prisma.speakingExercise.findMany({
      where: category ? { category } : {},
      orderBy: { createdAt: 'desc' },
    });
  }

  async findExerciseById(id: number) {
    const exercise = await this.prisma.speakingExercise.findUnique({
      where: { id },
    });
    if (!exercise) {
      throw new NotFoundException(`Speaking exercise #${id} not found`);
    }
    return exercise;
  }

  async createExercise(dto: CreateExerciseDto) {
    return this.prisma.speakingExercise.create({
      data: {
        title: dto.title,
        targetText: dto.targetText,
        difficulty: dto.difficulty || 'BEGINNER',
        category: dto.category || 'GENERAL',
      },
    });
  }

  async submitAudio(
    exerciseId: number,
    userId: number,
    audioFile: Express.Multer.File,
  ) {
    // 1. Kiểm tra giới hạn (Rate Limit) để bảo vệ chi phí Azure (VD: Tối đa 10 lần/ngày/user)
    const DAILY_LIMIT = 10;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const submissionsToday = await this.prisma.speakingSubmission.count({
      where: {
        userId,
        submittedAt: {
          gte: startOfDay,
        },
      },
    });

    if (submissionsToday >= DAILY_LIMIT) {
      throw new BadRequestException(
        `Bạn đã đạt giới hạn chấm điểm phát âm hôm nay (${DAILY_LIMIT} lần). Vui lòng quay lại vào ngày mai để luyện tập tiếp nhé!`,
      );
    }

    // 2. Kiểm tra exercise có tồn tại không
    const exercise = await this.findExerciseById(exerciseId);

    // 3. Upload file audio lên Cloudinary để lưu trữ
    this.logger.log(`Uploading audio for exercise #${exerciseId} by user #${userId}`);
    const uploadResult = await this.uploadService.uploadStream(
      audioFile.buffer,
      {
        folder: 'speaking_audio',
        resource_type: 'video',
      },
    );
    const audioUrl = uploadResult.secure_url;

    // 3. Đánh giá phát âm qua Azure + Gemini
    this.logger.log('Sending audio to AI Evaluator (Azure+Gemini)...');
    const aiFeedback = await this.aiService.assessPronunciation(
      exercise.targetText,
      audioFile.buffer,
    );

    // 4. Lưu kết quả vào database
    const submission = await this.prisma.speakingSubmission.create({
      data: {
        exerciseId,
        userId,
        audioUrl,
        overallScore: aiFeedback.overallScore,
        aiFeedback: aiFeedback as any,
      },
    });

    return {
      submissionId: submission.id,
      audioUrl,
      assessment: aiFeedback,
    };
  }

  async getMySubmissions(userId: number) {
    return this.prisma.speakingSubmission.findMany({
      where: { userId },
      include: { exercise: true },
      orderBy: { submittedAt: 'desc' },
    });
  }
}
