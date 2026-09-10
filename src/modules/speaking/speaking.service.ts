import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { UploadService } from '../upload/upload.service';
import { CreateExerciseDto } from './dto/create-exercise.dto';
import { validateSpeakingAudio } from './speaking-audio-validator';
import { SpeakingWorkerService } from './speaking-worker.service';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import * as crypto from 'crypto';

export interface SubmitSpeakingResponse {
  submissionId: number;
  status: string;
  pollUrl: string;
  acceptedAt: string;
}

const ALLOWED_TTS_RATES = [0.5, 0.75, 1, 1.25, 1.5];
const VOICE_MAPPING = {
  US: { voice: 'en-US-JennyNeural', lang: 'en-US' },
  UK: { voice: 'en-GB-SoniaNeural', lang: 'en-GB' },
} as const;

@Injectable()
export class SpeakingService {
  private readonly logger = new Logger(SpeakingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
    private readonly uploadService: UploadService,
    private readonly speakingWorkerService: SpeakingWorkerService,
    @Optional() @InjectRedis() private readonly redis?: Redis,
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
            status: 'COMPLETED',
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

  /**
   * Phase 1.3: Asynchronous pronunciation submission with Idempotency-Key support.
   * Returns HTTP 202 Accepted immediately with pollUrl.
   */
  async submitAudio(
    exerciseId: number,
    userId: number,
    audioFile: Express.Multer.File,
    idempotencyKey?: string,
  ): Promise<SubmitSpeakingResponse> {
    // 1. Validate Idempotency-Key
    if (
      !idempotencyKey ||
      typeof idempotencyKey !== 'string' ||
      idempotencyKey.trim().length === 0
    ) {
      throw new BadRequestException(
        'Header "Idempotency-Key" is required and must be a valid non-empty string',
      );
    }
    const cleanIdempotencyKey = idempotencyKey.trim();

    // 2. Check for duplicate idempotent submission
    const existingSubmission = await this.prisma.speakingSubmission.findUnique({
      where: {
        userId_idempotencyKey: {
          userId,
          idempotencyKey: cleanIdempotencyKey,
        },
      },
    });

    if (existingSubmission) {
      this.logger.log(
        `Idempotent duplicate detected for user #${userId} with key "${cleanIdempotencyKey}". Returning existing submission #${existingSubmission.id}.`,
      );
      return {
        submissionId: existingSubmission.id,
        status: existingSubmission.status,
        pollUrl: `/speaking/submissions/${existingSubmission.id}`,
        acceptedAt: existingSubmission.submittedAt.toISOString(),
      };
    }

    // 3. Verify exercise exists
    const exercise = await this.findExerciseById(exerciseId);

    // 4. Byte-level audio validation
    if (!audioFile || !audioFile.buffer) {
      throw new BadRequestException('Audio file is empty');
    }
    const audioValidation = validateSpeakingAudio(
      audioFile.buffer,
      audioFile.mimetype || undefined,
    );

    // 5. Upload original audio to R2 storage
    this.logger.log(
      `Uploading audio for exercise #${exerciseId} by user #${userId} (${audioValidation.durationMs}ms)`,
    );
    const uploadResult = await this.uploadService.uploadRawBuffer(
      audioFile.buffer,
      audioValidation.audioMimeType,
      'speaking_audio',
    );

    // 6. Count and create under a per-user/day PostgreSQL advisory lock.
    // This keeps the quota atomic without a schema migration.
    const DAILY_LIMIT = 10;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    let submission;
    try {
      submission = await this.prisma.$transaction(async (tx) => {
        // pg_advisory_xact_lock returns PostgreSQL `void`; use executeRaw so
        // Prisma does not try to deserialize a result row from the lock call.
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtext(${`speaking-quota:${userId}:${startOfDay.toISOString().slice(0, 10)}`})
          );
        `;

        const submissionsToday = await tx.speakingSubmission.count({
          where: { userId, submittedAt: { gte: startOfDay } },
        });
        if (submissionsToday >= DAILY_LIMIT) {
          throw new BadRequestException(
            `Bạn đã đạt giới hạn chấm điểm phát âm hôm nay (${DAILY_LIMIT} lần). Vui lòng quay lại vào ngày mai để luyện tập tiếp nhé!`,
          );
        }

        return tx.speakingSubmission.create({
          data: {
            exerciseId: exercise.id,
            userId,
            status: 'PENDING',
            audioKey: uploadResult.key,
            audioUrl: uploadResult.url,
            audioMimeType: audioValidation.audioMimeType,
            durationMs: audioValidation.durationMs,
            audioQuality: audioValidation.quality as any,
            idempotencyKey: cleanIdempotencyKey,
            provider: 'azure',
            scoreVersion: 'v1',
          },
        });
      });
    } catch (error) {
      try {
        await this.uploadService.deleteFile(uploadResult.key);
      } catch (cleanupError) {
        this.logger.warn(
          `Failed to clean up rejected speaking audio: ${cleanupError}`,
        );
      }
      throw error;
    }

    // 8. Trigger background worker immediately
    this.speakingWorkerService.triggerProcessing();

    // 9. Return HTTP 202 Accepted payload
    return {
      submissionId: submission.id,
      status: 'PENDING',
      pollUrl: `/speaking/submissions/${submission.id}`,
      acceptedAt: submission.submittedAt.toISOString(),
    };
  }

  /**
   * Phase 1.3: Get submission status and assessment results with ownership protection.
   */
  async getSubmission(
    submissionId: number,
    currentUser: { id: number; role?: string },
  ) {
    const submission = await this.prisma.speakingSubmission.findUnique({
      where: { id: submissionId },
      include: { exercise: true },
    });

    if (!submission) {
      throw new NotFoundException(
        `Speaking submission #${submissionId} not found`,
      );
    }

    // Ownership check
    if (submission.userId !== currentUser.id && currentUser.role !== 'ADMIN') {
      throw new ForbiddenException(
        'You do not have permission to access this pronunciation submission',
      );
    }

    // Provide safe short-lived presigned audio URL if audioKey exists
    let safeAudioUrl: string | null = null;
    if (submission.audioKey) {
      try {
        safeAudioUrl = await this.uploadService.getPresignedDownloadUrl(
          submission.audioKey,
          3600,
        );
      } catch (err) {
        this.logger.warn(`Could not generate presigned audio URL: ${err}`);
      }
    }

    return {
      id: submission.id,
      exerciseId: submission.exerciseId,
      userId: submission.userId,
      status: submission.status,
      overallScore: submission.overallScore,
      transcript: submission.transcript,
      aiFeedback: submission.aiFeedback,
      durationMs: submission.durationMs,
      audioQuality: submission.audioQuality,
      audioUrl: safeAudioUrl,
      submittedAt: submission.submittedAt,
      processedAt: submission.processedAt,
      lastErrorCode: submission.lastErrorCode,
      exercise: submission.exercise,
    };
  }

  /**
   * Phase 1.3: Protected audio endpoint returning short-lived signed URL.
   */
  async getAudioSignedUrl(
    submissionId: number,
    currentUser: { id: number; role?: string },
  ): Promise<{ audioUrl: string }> {
    const submission = await this.prisma.speakingSubmission.findUnique({
      where: { id: submissionId },
      select: { id: true, userId: true, audioKey: true, audioUrl: true },
    });

    if (!submission) {
      throw new NotFoundException(
        `Speaking submission #${submissionId} not found`,
      );
    }

    if (submission.userId !== currentUser.id && currentUser.role !== 'ADMIN') {
      throw new ForbiddenException(
        'You do not have permission to access this audio',
      );
    }

    let signedUrl = '';
    if (submission.audioKey) {
      try {
        signedUrl = await this.uploadService.getPresignedDownloadUrl(
          submission.audioKey,
          3600,
        );
      } catch (err) {
        this.logger.warn(`Presigned download URL generation failed: ${err}`);
      }
    }

    return { audioUrl: signedUrl };
  }

  /**
   * Phase 1.3: List user's sanitized submission history.
   */
  async getMySubmissions(userId: number) {
    const submissions = await this.prisma.speakingSubmission.findMany({
      where: { userId },
      include: { exercise: true },
      orderBy: { submittedAt: 'desc' },
    });

    return submissions.map((s) => ({
      id: s.id,
      exerciseId: s.exerciseId,
      status: s.status,
      overallScore: s.overallScore,
      transcript: s.transcript,
      durationMs: s.durationMs,
      submittedAt: s.submittedAt,
      processedAt: s.processedAt,
      lastErrorCode: s.lastErrorCode,
      exerciseTitle: s.exercise?.title,
      targetText: s.exercise?.targetText,
    }));
  }

  async evaluateSpeakingPart3To5(promptText: string, studentResponse: string) {
    return this.aiService.evaluateSpeakingPart3To5(promptText, studentResponse);
  }

  /**
   * Phase 5: Neural TTS playback with whitelisted accents (US/UK), speed rates,
   * XML/SSML escaping, Redis caching, and audio/mpeg response.
   */
  async generateTts(
    text: string,
    accent: 'US' | 'UK',
    rate: number,
  ): Promise<Buffer> {
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      throw new BadRequestException('Text is required for TTS synthesis');
    }

    const trimmedText = text.trim();
    if (trimmedText.length > 500) {
      throw new BadRequestException(
        'Text exceeds maximum length of 500 characters',
      );
    }

    if (!['US', 'UK'].includes(accent)) {
      throw new BadRequestException(
        `Invalid accent "${accent}". Allowed accents: US, UK`,
      );
    }

    if (!ALLOWED_TTS_RATES.includes(rate)) {
      throw new BadRequestException(
        `Invalid playback rate ${rate}. Allowed rates: ${ALLOWED_TTS_RATES.join(', ')}`,
      );
    }

    // 1. Prefer stored audioUs/audioUk for exact single vocabulary words if rate == 1
    if (rate === 1.0 && !trimmedText.includes(' ')) {
      const vocabWord = await this.prisma.vocabWord.findFirst({
        where: {
          word: { equals: trimmedText.toLowerCase(), mode: 'insensitive' },
        },
        select: { audioUs: true, audioUk: true },
      });
      const storedUrl =
        accent === 'US' ? vocabWord?.audioUs : vocabWord?.audioUk;
      if (storedUrl && storedUrl.startsWith('http')) {
        try {
          const res = await fetch(storedUrl);
          if (res.ok) {
            const arrBuffer = await res.arrayBuffer();
            return Buffer.from(arrBuffer);
          }
        } catch (fetchErr) {
          this.logger.warn(`Failed to fetch stored vocab audio: ${fetchErr}`);
        }
      }
    }

    // 2. Check deterministic Redis cache
    const hash = crypto
      .createHash('md5')
      .update(`${accent}:${rate}:${trimmedText.toLowerCase()}`)
      .digest('hex');
    const cacheKey = `tts:${accent}:${rate}:${hash}`;

    if (this.redis) {
      try {
        const cachedBase64 = await this.redis.get(cacheKey);
        if (cachedBase64) {
          return Buffer.from(cachedBase64, 'base64');
        }
      } catch (cacheErr) {
        this.logger.warn(`TTS Redis cache get failed: ${cacheErr}`);
      }
    }

    // 3. Synthesize via Azure Neural TTS
    const azureKey = process.env.AZURE_SPEECH_KEY;
    const azureRegion = process.env.AZURE_SPEECH_REGION;

    // Provider configuration is required; never synthesize fake audio.
    if (!azureKey || !azureRegion) {
      throw new ServiceUnavailableException(
        'Dịch vụ phát âm mẫu hiện chưa được cấu hình.',
      );
    }

    const { voice, lang } = VOICE_MAPPING[accent];
    const escapedText = this.escapeSsml(trimmedText);

    // Apply speed through SSML prosody rate
    const prosodyRate =
      rate === 1.0
        ? '1.0'
        : rate > 1.0
          ? `+${Math.round((rate - 1.0) * 100)}%`
          : `${Math.round((rate - 1.0) * 100)}%`;

    const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'>
  <voice name='${voice}'>
    <prosody rate='${prosodyRate}'>${escapedText}</prosody>
  </voice>
</speak>`;

    const endpoint = `https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': azureKey,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
        'User-Agent': 'BreadtransKLTN',
      },
      body: ssml,
    });

    if (!response.ok) {
      const errBody = await response.text();
      this.logger.error(`Azure TTS failed (${response.status}): ${errBody}`);
      throw new BadRequestException('TTS synthesis failed at provider');
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);

    // 4. Cache in Redis for 7 days
    if (this.redis) {
      try {
        await this.redis.set(
          cacheKey,
          audioBuffer.toString('base64'),
          'EX',
          7 * 24 * 60 * 60,
        );
      } catch (cacheErr) {
        this.logger.warn(`TTS Redis cache set failed: ${cacheErr}`);
      }
    }

    return audioBuffer;
  }

  /**
   * Escapes special characters to prevent SSML injection.
   */
  escapeSsml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
