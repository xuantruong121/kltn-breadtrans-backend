import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { UploadService } from '../upload/upload.service';
import { CreateExerciseDto } from './dto/create-exercise.dto';

@Injectable()
export class SpeakingService {
  private readonly logger = new Logger(SpeakingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
    private readonly uploadService: UploadService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async findAllExercises(category: string | undefined, userId?: number) {
    const exercises = await this.prisma.speakingExercise.findMany({
      where: category ? { category } : {},
      orderBy: { createdAt: 'desc' },
    });

    const userSubmissions = userId
      ? await this.prisma.speakingSubmission.findMany({
          where: {
            userId,
            exerciseId: { in: exercises.map((e) => e.id) },
          },
          select: { exerciseId: true },
        })
      : [];

    const completedExerciseIds = new Set(
      userSubmissions.map((s) => s.exerciseId),
    );

    return exercises.map((exercise) => ({
      ...exercise,
      isCompleted: completedExerciseIds.has(exercise.id),
    }));
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

    // 3. Upload file audio lên Cloudflare R2 để lưu trữ
    this.logger.log(
      `Uploading audio for exercise #${exerciseId} by user #${userId}`,
    );
    const uploadResult = await this.uploadService.uploadRawBuffer(
      audioFile.buffer,
      audioFile.mimetype || 'audio/mpeg',
      'speaking_audio',
    );
    const audioUrl = uploadResult.url;

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

    // 5. Bắn event gamification để cập nhật nhiệm vụ ngày DO_SPEAKING & cộng điểm thưởng
    try {
      await this.eventEmitter.emitAsync('speaking.submitted', {
        userId,
        exerciseId,
        overallScore: aiFeedback.overallScore,
        isSilentOrNoSpeech: aiFeedback.isSilentOrNoSpeech,
      });
    } catch (e) {
      this.logger.error('Failed to emit speaking.submitted event', e);
    }

    return {
      submissionId: submission.id,
      audioUrl,
      assessment: aiFeedback,
    };
  }

  async evaluateSpeakingPart3To5(promptText: string, studentResponse: string) {
    return this.aiService.evaluateSpeakingPart3To5(promptText, studentResponse);
  }

  async getMySubmissions(userId: number) {
    return this.prisma.speakingSubmission.findMany({
      where: { userId },
      include: { exercise: true },
      orderBy: { submittedAt: 'desc' },
    });
  }
}
