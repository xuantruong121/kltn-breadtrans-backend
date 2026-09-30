import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  Logger,
  Optional,
  ServiceUnavailableException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { UploadService } from '../upload/upload.service';
import { R2Service } from '../upload/r2.service';
import { CreateExerciseDto } from './dto/create-exercise.dto';
import { CreateUploadIntentDto } from './dto/create-upload-intent.dto';
import { validateSpeakingAudio } from './speaking-audio-validator';
import { SpeakingWorkerService } from './speaking-worker.service';
import { SpeakingQueueService } from './speaking-queue.service';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import * as crypto from 'crypto';
import { getSpeakingPipelineMode } from './speaking.constants';

export interface SubmitSpeakingResponse {
  submissionId: number;
  status: string;
  pollUrl: string;
  acceptedAt: string;
  traceId?: string;
}

const ALLOWED_TTS_RATES = [0.5, 0.75, 1, 1.25, 1.5];
const VOICE_MAPPING = {
  US: { voice: 'en-US-JennyNeural', lang: 'en-US' },
  UK: { voice: 'en-GB-SoniaNeural', lang: 'en-GB' },
} as const;

export interface DialogueTtsSegment {
  speaker?: string;
  speakerId?: string;
  voiceKey?: string;
  text: string;
}

function dialogueVoiceForSpeaker(
  speaker: string | undefined,
  index: number,
  accent: 'US' | 'UK',
  speakerSlots: Map<string, number>,
  requestedVoiceKey?: string,
): string {
  const normalized = (speaker ?? '').trim().toLocaleLowerCase('vi-VN');
  const normalizedVoiceKey = (requestedVoiceKey ?? '').toLowerCase();
  const explicitFemale = normalizedVoiceKey.includes('female');
  const explicitMale = !explicitFemale && normalizedVoiceKey.includes('male');
  const isAgent =
    normalized.includes('agent') ||
    normalized.includes('support') ||
    normalized.includes('nhân viên') ||
    normalized.includes('assistant') ||
    normalized.includes('staff');
  const isCustomer =
    normalized.includes('customer') ||
    normalized.includes('caller') ||
    normalized.includes('client') ||
    normalized.includes('buyer') ||
    normalized.includes('guest');
  const isMaleName =
    /\b(ben|dan|leo|mark|ethan|john|michael|david|tom|guy)\b/.test(normalized);
  const isFemaleName =
    /\b(mia|maya|nora|linh|jenny|sarah|anna|emma|susan)\b/.test(normalized);
  let slot = speakerSlots.get(normalized);
  if (
    explicitMale ||
    explicitFemale ||
    isAgent ||
    isCustomer ||
    isMaleName ||
    isFemaleName
  ) {
    slot = explicitMale || isAgent || isMaleName ? 1 : 0;
  } else if (slot === undefined) {
    slot = speakerSlots.size % 2;
  }
  if (slot !== undefined) {
    speakerSlots.set(normalized, slot);
  }
  if (accent === 'UK') {
    return slot === 1 || (!normalized && index % 2 === 1)
      ? 'en-GB-RyanNeural'
      : 'en-GB-SoniaNeural';
  }
  return slot === 1 || (!normalized && index % 2 === 1)
    ? 'en-US-GuyNeural'
    : 'en-US-JennyNeural';
}

function escapeDialogueSsml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildDialogueSsml(
  segments: DialogueTtsSegment[],
  accent: 'US' | 'UK',
  rate = 1,
): string {
  const lang = accent === 'UK' ? 'en-GB' : 'en-US';
  const prosodyRate =
    rate === 1
      ? '1.0'
      : rate > 1
        ? `+${Math.round((rate - 1) * 100)}%`
        : `${Math.round((rate - 1) * 100)}%`;
  // Azure accepts consecutive voice elements, but rejects a break between
  // sibling voice elements on some Speech regions. Punctuation in each line
  // already provides a natural boundary without risking a 400 response.
  const body = segments
    .map((segment, index, allSegments) => {
      const speakerSlots = new Map<string, number>();
      for (const prior of allSegments.slice(0, index)) {
        const key = (prior.speaker ?? '').trim().toLocaleLowerCase('vi-VN');
        if (!speakerSlots.has(key)) {
          speakerSlots.set(key, speakerSlots.size % 2);
        }
      }
      const voice = dialogueVoiceForSpeaker(
        segment.speaker,
        index,
        accent,
        speakerSlots,
        segment.voiceKey,
      );
      return `<voice name='${voice}'><prosody rate='${prosodyRate}'>${escapeDialogueSsml(segment.text)}</prosody></voice>`;
    })
    .join('');
  return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'>${body}</speak>`;
}

type SpeakingExerciseCatalogItem = {
  id: number;
  title: string;
  difficulty: string;
  category: string;
};

/**
 * Catalog-level grouping keeps the storage model backward compatible while
 * presenting a real multi-sentence practice set to learners. Each sentence
 * remains an independent SpeakingExercise for scoring and idempotency.
 */
function resolvePracticeSet(item: SpeakingExerciseCatalogItem) {
  const title = item.title.toLowerCase();
  if (title.startsWith('read aloud')) {
    return item.category.toUpperCase() === 'TOEIC'
      ? {
          key: 'read-aloud-toeic',
          title: 'Đọc thành tiếng — Ngữ cảnh TOEIC',
          description:
            'Luyện đọc các thông báo và tình huống thường gặp trong môi trường công việc.',
        }
      : {
          key: 'read-aloud-general',
          title: 'Đọc thành tiếng — Giao tiếp hằng ngày',
          description:
            'Luyện đọc các câu tiếng Anh đời sống với nhịp điệu và phát âm rõ ràng.',
        };
  }
  if (title.startsWith('pronunciation')) {
    return {
      key: 'pronunciation-foundations',
      title: 'Nền tảng phát âm',
      description:
        'Củng cố âm cuối, trọng âm, nối âm và cách đọc số liệu trong câu thực tế.',
    };
  }
  if (title.startsWith('question response')) {
    return item.category.toUpperCase() === 'BUSINESS'
      ? {
          key: 'question-response-business',
          title: 'Phản hồi câu hỏi — Công việc',
          description:
            'Luyện trả lời câu hỏi trong các tình huống họp, dịch vụ và giao tiếp công sở.',
        }
      : {
          key: 'question-response-general',
          title: 'Phản hồi câu hỏi — Đời sống',
          description:
            'Luyện phản xạ trả lời các câu hỏi quen thuộc bằng câu nói tự nhiên.',
        };
  }
  if (title.startsWith('opinion')) {
    return item.category.toUpperCase() === 'BUSINESS'
      ? {
          key: 'opinion-business',
          title: 'Trình bày quan điểm — Công việc',
          description:
            'Trình bày ý kiến có lý do và ví dụ trong các chủ đề nghề nghiệp.',
        }
      : {
          key: 'opinion-general',
          title: 'Trình bày quan điểm — Hằng ngày',
          description:
            'Luyện diễn đạt quan điểm cá nhân mạch lạc, tự nhiên và có dẫn chứng.',
        };
  }
  if (title.startsWith('toeic speaking')) {
    return {
      key: 'toeic-speaking-practice',
      title: 'Luyện nhiệm vụ TOEIC Speaking',
      description:
        'Luyện theo nhóm nhiệm vụ đọc thành tiếng, mô tả và phản hồi trong TOEIC Speaking.',
    };
  }
  return {
    key: `custom-${item.category.toLowerCase()}`,
    title: `Luyện nói — ${item.category}`,
    description: 'Một bộ câu luyện nói theo chủ đề.',
  };
}

function difficultyLabel(values: string[]) {
  const rank: Record<string, number> = {
    BEGINNER: 1,
    INTERMEDIATE: 2,
    ADVANCED: 3,
  };
  const labels: Record<string, string> = {
    BEGINNER: 'Cơ bản',
    INTERMEDIATE: 'Trung cấp',
    ADVANCED: 'Nâng cao',
  };
  const unique = [...new Set(values.map((value) => value.toUpperCase()))]
    .filter((value) => rank[value])
    .sort((a, b) => rank[a] - rank[b]);
  if (unique.length <= 1) return labels[unique[0]] ?? 'Cơ bản';
  return `${labels[unique[0]]} – ${labels[unique[unique.length - 1]]}`;
}

@Injectable()
export class SpeakingService {
  private readonly logger = new Logger(SpeakingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
    private readonly uploadService: UploadService,
    private readonly speakingWorkerService: SpeakingWorkerService,
    @Optional() private readonly speakingQueueService?: SpeakingQueueService,
    @Optional() @InjectRedis() private readonly redis?: Redis,
    @Optional() private readonly r2Service?: R2Service,
  ) {}

  private getStorage() {
    return this.r2Service ?? this.uploadService;
  }

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

    const grouped = new Map<string, Array<(typeof exercises)[number]>>();
    for (const exercise of exercises) {
      const set = resolvePracticeSet(exercise);
      const current = grouped.get(set.key) ?? [];
      current.push(exercise);
      grouped.set(set.key, current);
    }

    const setSummaries = new Map<
      string,
      {
        key: string;
        title: string;
        description: string;
        category: string;
        exerciseCount: number;
        completedCount: number;
        exerciseIds: number[];
        difficultyLabel: string;
      }
    >();

    for (const [key, items] of grouped.entries()) {
      const set = resolvePracticeSet(items[0]);
      setSummaries.set(key, {
        ...set,
        category: items[0].category,
        exerciseCount: items.length,
        completedCount: items.filter((item) =>
          completedExerciseIds.has(item.id),
        ).length,
        exerciseIds: items.map((item) => item.id),
        difficultyLabel: difficultyLabel(items.map((item) => item.difficulty)),
      });
    }

    const positions = new Map<string, number>();
    return exercises.map((exercise) => {
      const set = setSummaries.get(resolvePracticeSet(exercise).key)!;
      const setKey = set.key;
      const position = (positions.get(setKey) ?? 0) + 1;
      positions.set(setKey, position);
      return {
        ...exercise,
        isCompleted: completedExerciseIds.has(exercise.id),
        practiceSet: {
          ...set,
          position,
          isCompleted: set.completedCount === set.exerciseCount,
        },
      };
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

  /**
   * Phase 1.3: Asynchronous pronunciation submission with Idempotency-Key support.
   * Returns HTTP 202 Accepted immediately with pollUrl.
   */
  async submitAudio(
    exerciseId: number,
    userId: number,
    audioFile: Express.Multer.File,
    idempotencyKey?: string,
    traceIdHeader?: string,
  ): Promise<SubmitSpeakingResponse> {
    const traceId = traceIdHeader?.trim() || crypto.randomUUID();

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
        `Idempotent duplicate detected for user #${userId} with key "${cleanIdempotencyKey}". Returning existing submission #${existingSubmission.id}. (traceId=${traceId})`,
      );
      return {
        submissionId: existingSubmission.id,
        status: existingSubmission.status,
        pollUrl: `/speaking/submissions/${existingSubmission.id}`,
        acceptedAt: existingSubmission.submittedAt.toISOString(),
        traceId,
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

    // 5. Upload original audio to the catalog namespace in R2.
    // The submission id is created after upload, so the storage service
    // uses a stable catalog prefix plus a generated object name.
    this.logger.log(
      `Uploading audio for exercise #${exerciseId} by user #${userId} (${audioValidation.durationMs}ms, traceId=${traceId})`,
    );
    const uploadResult = await this.uploadService.uploadRawBuffer(
      audioFile.buffer,
      audioValidation.audioMimeType,
      'catalog/speaking/submissions',
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

    // 8. Pipeline dispatch: BullMQ queue vs legacy DB-polling fallback
    const pipelineMode = getSpeakingPipelineMode();
    if (pipelineMode === 'bullmq' && this.speakingQueueService) {
      try {
        await this.speakingQueueService.enqueueSubmission(
          submission.id,
          traceId,
        );
        this.logger.log(
          `[SpeakingService] Enqueued submission #${submission.id} to BullMQ queue (traceId=${traceId})`,
        );
      } catch (queueErr: any) {
        this.logger.error(
          `[SpeakingService] Failed to enqueue submission #${submission.id} to BullMQ: ${queueErr.message}. Submission remains PENDING in DB for reconciliation. (traceId=${traceId})`,
        );
      }
    } else {
      // Legacy DB polling fallback
      this.speakingWorkerService.triggerProcessing();
    }

    // 9. Return HTTP 202 Accepted payload
    return {
      submissionId: submission.id,
      status: 'PENDING',
      pollUrl: `/speaking/submissions/${submission.id}`,
      acceptedAt: submission.submittedAt.toISOString(),
      traceId,
    };
  }

  /**
   * Phase 2.1: Return speaking audio upload capabilities and rollout configuration.
   */
  getCapabilities() {
    const uploadMode = (
      process.env.SPEAKING_AUDIO_UPLOAD_MODE || 'presigned'
    ).toLowerCase();
    const rawTtl = Number(
      process.env.SPEAKING_PRESIGNED_UPLOAD_TTL_SECONDS || 600,
    );
    const uploadTtlSeconds = Math.min(
      Math.max(isNaN(rawTtl) ? 600 : rawTtl, 300),
      600,
    );

    return {
      uploadMode: uploadMode === 'proxy' ? 'proxy' : 'presigned',
      maxSizeBytes: 10 * 1024 * 1024,
      maxDurationMs: 45000,
      minDurationMs: 300,
      allowedContentTypes: ['audio/wav', 'audio/x-wav'],
      uploadTtlSeconds,
    };
  }

  /**
   * Phase 2.2: Create a secure upload intent for direct client upload to Cloudflare R2.
   * Server retains full authority over object key, quota, constraints, and expiration.
   */
  async createUploadIntent(
    exerciseId: number,
    userId: number,
    dto: CreateUploadIntentDto,
    traceIdHeader?: string,
  ) {
    const traceId =
      traceIdHeader ||
      `trace-intent-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

    // 1. Verify exercise exists
    const exercise = await this.findExerciseById(exerciseId);

    // 2. Validate declared MIME type, size, duration
    const validMimes = ['audio/wav', 'audio/x-wav'];
    if (!validMimes.includes(dto.contentType)) {
      throw new BadRequestException('Chỉ chấp nhận định dạng audio/wav');
    }
    if (dto.sizeBytes <= 0 || dto.sizeBytes > 10 * 1024 * 1024) {
      throw new BadRequestException('Dung lượng audio phải từ 1 byte đến 10MB');
    }
    if (dto.durationMs < 300 || dto.durationMs > 45000) {
      throw new BadRequestException(
        'Thời lượng audio phải từ 300ms đến 45 giây',
      );
    }

    // 3. Enforce daily speaking quota
    const DAILY_LIMIT = 10;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const submissionsToday = await this.prisma.speakingSubmission.count({
      where: { userId, submittedAt: { gte: startOfDay } },
    });
    if (submissionsToday >= DAILY_LIMIT) {
      throw new BadRequestException(
        `Bạn đã đạt giới hạn chấm điểm phát âm hôm nay (${DAILY_LIMIT} lần). Vui lòng quay lại vào ngày mai để luyện tập tiếp nhé!`,
      );
    }

    // 4. Rate-limit / bound active unexpired intents per user (Correction I)
    const MAX_ACTIVE_INTENTS_PER_USER = 3;
    const now = new Date();
    const activeIntentsCount = await this.prisma.speakingUploadIntent.count({
      where: {
        userId,
        status: { in: ['PENDING', 'FINALIZING'] },
        expiresAt: { gt: now },
      },
    });
    if (activeIntentsCount >= MAX_ACTIVE_INTENTS_PER_USER) {
      throw new BadRequestException(
        'Bạn đang có nhiều yêu cầu tải lên chưa hoàn tất. Vui lòng hoàn tất hoặc thử lại sau.',
      );
    }

    // 5. Idempotency handling (Correction E)
    const cleanIdempotencyKey = dto.idempotencyKey.trim();
    const existingIntent = await this.prisma.speakingUploadIntent.findUnique({
      where: {
        userId_idempotencyKey: {
          userId,
          idempotencyKey: cleanIdempotencyKey,
        },
      },
    });

    if (existingIntent) {
      // Check metadata exact match
      const isMetadataMatch =
        existingIntent.exerciseId === exercise.id &&
        existingIntent.expectedContentType === dto.contentType &&
        existingIntent.expectedSizeBytes === dto.sizeBytes &&
        existingIntent.expectedDurationMs === dto.durationMs;

      if (!isMetadataMatch) {
        throw new ConflictException(
          'Idempotency key reused with different upload metadata',
        );
      }

      if (
        existingIntent.status === 'FINALIZED' &&
        existingIntent.submissionId
      ) {
        const existingSubmission =
          await this.prisma.speakingSubmission.findUnique({
            where: { id: existingIntent.submissionId },
          });
        if (existingSubmission) {
          this.logger.log(
            `Upload intent with key "${cleanIdempotencyKey}" already finalized. Returning existing submission #${existingSubmission.id} (traceId=${traceId})`,
          );
          return {
            uploadIntentId: existingIntent.id,
            status: existingIntent.status,
            isAlreadyFinalized: true,
            submissionId: existingSubmission.id,
            pollUrl: `/speaking/submissions/${existingSubmission.id}`,
          };
        }
      }

      if (existingIntent.status === 'FINALIZING') {
        return {
          uploadIntentId: existingIntent.id,
          status: 'FINALIZING',
          isAlreadyFinalized: false,
          isFinalizing: true,
          message: 'Upload is currently being finalized',
        };
      }

      if (
        existingIntent.status === 'PENDING' &&
        existingIntent.expiresAt > now
      ) {
        this.logger.log(
          `Returning active upload intent ${existingIntent.id} for user #${userId} with key "${cleanIdempotencyKey}" (traceId=${traceId})`,
        );
        const remainingSecs = Math.max(
          Math.floor((existingIntent.expiresAt.getTime() - Date.now()) / 1000),
          60,
        );
        const uploadUrl = await this.getStorage().getPresignedUploadUrl(
          existingIntent.objectKey,
          existingIntent.expectedContentType,
          remainingSecs,
        );
        return {
          uploadIntentId: existingIntent.id,
          uploadUrl,
          signedHeaders: {
            'Content-Type': existingIntent.expectedContentType,
          },
          objectKey: existingIntent.objectKey,
          expiresAt: existingIntent.expiresAt.toISOString(),
          maxSizeBytes: 10 * 1024 * 1024,
          isAlreadyFinalized: false,
        };
      }

      // Expired, cancelled, or invalid intent with same key
      throw new ConflictException(
        'This idempotency key belongs to an expired or failed upload attempt. Please generate a new key.',
      );
    }

    // 6. Generate secure server-side object key & clamped TTL (Correction D)
    const rawTtl = Number(
      process.env.SPEAKING_PRESIGNED_UPLOAD_TTL_SECONDS || 600,
    );
    const ttlSeconds = Math.min(
      Math.max(isNaN(rawTtl) ? 600 : rawTtl, 300),
      600,
    );
    const uploadIntentId = crypto.randomUUID();
    const objectKey = `speaking/pending/${userId}/${uploadIntentId}.wav`;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    // 7. Generate presigned PUT URL
    const uploadUrl = await this.getStorage().getPresignedUploadUrl(
      objectKey,
      dto.contentType,
      ttlSeconds,
    );

    // 8. Persist intent
    const intent = await this.prisma.speakingUploadIntent.create({
      data: {
        id: uploadIntentId,
        userId,
        exerciseId: exercise.id,
        objectKey,
        expectedContentType: dto.contentType,
        expectedSizeBytes: dto.sizeBytes,
        expectedDurationMs: dto.durationMs,
        idempotencyKey: cleanIdempotencyKey,
        status: 'PENDING',
        expiresAt,
      },
    });

    // Redact sensitive query parameters when logging (Correction H)
    this.logger.log(
      `Created upload intent ${intent.id} for user #${userId}, exercise #${exercise.id} (objectKey=${objectKey}, traceId=${traceId})`,
    );

    return {
      uploadIntentId: intent.id,
      uploadUrl,
      signedHeaders: {
        'Content-Type': intent.expectedContentType,
      },
      objectKey: intent.objectKey,
      expiresAt: intent.expiresAt.toISOString(),
      maxSizeBytes: 10 * 1024 * 1024,
      isAlreadyFinalized: false,
    };
  }

  /**
   * Phase 2.3: Finalize a direct R2 upload with server-side validation and atomic BullMQ enqueueing.
   */
  async finalizeUpload(
    uploadIntentId: string,
    userId: number,
    traceIdHeader?: string,
  ) {
    const traceId =
      traceIdHeader ||
      `trace-finalize-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

    // 1. Initial intent load
    const intent = await this.prisma.speakingUploadIntent.findUnique({
      where: { id: uploadIntentId },
      include: { submission: true },
    });

    if (!intent) {
      throw new NotFoundException(`Upload intent ${uploadIntentId} not found`);
    }

    // 2. IDOR defense: Ownership check
    if (intent.userId !== userId) {
      this.logger.warn(
        `IDOR attempt detected: User #${userId} attempted to finalize intent ${uploadIntentId} owned by User #${intent.userId}`,
      );
      throw new ForbiddenException(
        'You do not have permission to finalize this upload intent',
      );
    }

    // 3. Idempotent return if already finalized
    if (intent.status === 'FINALIZED' && intent.submissionId) {
      const existingSub =
        intent.submission ??
        (await this.prisma.speakingSubmission.findUnique({
          where: { id: intent.submissionId },
        }));
      if (existingSub) {
        this.logger.log(
          `Idempotent duplicate finalize detected for intent ${uploadIntentId}. Returning existing submission #${existingSub.id} (traceId=${traceId})`,
        );
        return {
          submissionId: existingSub.id,
          status: existingSub.status,
          pollUrl: `/speaking/submissions/${existingSub.id}`,
          acceptedAt: existingSub.submittedAt.toISOString(),
          traceId,
        };
      }
    }

    // 4. Reject expired or cancelled intents
    const now = new Date();
    if (intent.status === 'EXPIRED' || intent.expiresAt < now) {
      if (intent.status !== 'EXPIRED') {
        await this.prisma.speakingUploadIntent
          .update({
            where: { id: intent.id },
            data: { status: 'EXPIRED' },
          })
          .catch(() => {});
      }
      throw new BadRequestException(
        'Upload intent has expired. Please request a new upload intent.',
      );
    }

    if (intent.status === 'INVALID' || intent.status === 'CANCELLED') {
      throw new BadRequestException(
        `Upload intent cannot be finalized in status: ${intent.status}`,
      );
    }

    // 5. Atomic claim: PENDING -> FINALIZING with cryptographically unique token (Correction A)
    const token = crypto.randomUUID();
    const claimResult = await this.prisma.speakingUploadIntent.updateMany({
      where: {
        id: uploadIntentId,
        userId,
        status: 'PENDING',
        expiresAt: { gt: now },
      },
      data: {
        status: 'FINALIZING',
        finalizationStartedAt: now,
        finalizationToken: token,
      },
    });

    if (claimResult.count === 0) {
      // Could not claim: either finalized by concurrent request or currently finalizing
      const freshIntent = await this.prisma.speakingUploadIntent.findUnique({
        where: { id: uploadIntentId },
        include: { submission: true },
      });

      if (freshIntent?.status === 'FINALIZED' && freshIntent.submissionId) {
        const sub =
          freshIntent.submission ??
          (await this.prisma.speakingSubmission.findUnique({
            where: { id: freshIntent.submissionId },
          }));
        if (sub) {
          return {
            submissionId: sub.id,
            status: sub.status,
            pollUrl: `/speaking/submissions/${sub.id}`,
            acceptedAt: sub.submittedAt.toISOString(),
            traceId,
          };
        }
      }

      if (freshIntent?.status === 'FINALIZING') {
        // Wait shortly and re-read (bounded retry for concurrent finalize)
        for (let attempt = 0; attempt < 3; attempt++) {
          await new Promise((r) => setTimeout(r, 200));
          const polled = await this.prisma.speakingUploadIntent.findUnique({
            where: { id: uploadIntentId },
            include: { submission: true },
          });
          if (polled?.status === 'FINALIZED' && polled.submissionId) {
            const sub =
              polled.submission ??
              (await this.prisma.speakingSubmission.findUnique({
                where: { id: polled.submissionId },
              }));
            if (sub) {
              return {
                submissionId: sub.id,
                status: sub.status,
                pollUrl: `/speaking/submissions/${sub.id}`,
                acceptedAt: sub.submittedAt.toISOString(),
                traceId,
              };
            }
          }
        }
        throw new ConflictException(
          'Upload intent is currently being finalized by another request.',
        );
      }

      throw new BadRequestException(
        `Upload intent cannot be finalized in status: ${freshIntent?.status || 'UNKNOWN'}`,
      );
    }

    // 6. We hold the FINALIZING lease with token. Authoritative R2 verification (Correction C: exact size)
    const head = await this.getStorage().headObject(intent.objectKey);
    if (!head) {
      await this.prisma.speakingUploadIntent
        .updateMany({
          where: {
            id: uploadIntentId,
            status: 'FINALIZING',
            finalizationToken: token,
          },
          data: { status: 'INVALID' },
        })
        .catch(() => {});
      throw new BadRequestException(
        'Audio file was not found in storage. Direct upload may have failed or not completed.',
      );
    }

    if (head.contentLength <= 0 || head.contentLength > 10 * 1024 * 1024) {
      const invalidation = await this.prisma.speakingUploadIntent
        .updateMany({
          where: {
            id: uploadIntentId,
            status: 'FINALIZING',
            finalizationToken: token,
          },
          data: { status: 'INVALID' },
        });
      if (invalidation.count === 1) {
        await this.getStorage().deleteFile(intent.objectKey).catch(() => {});
      }
      throw new BadRequestException(
        'Uploaded audio size is invalid or exceeds 10MB limit.',
      );
    }

    // Exact size check (Correction C: no 1024-byte tolerance)
    if (head.contentLength !== intent.expectedSizeBytes) {
      this.logger.warn(
        `Exact size mismatch for intent ${intent.id}: expected ${intent.expectedSizeBytes} bytes, R2 has ${head.contentLength} bytes`,
      );
      const invalidation = await this.prisma.speakingUploadIntent
        .updateMany({
          where: {
            id: uploadIntentId,
            status: 'FINALIZING',
            finalizationToken: token,
          },
          data: { status: 'INVALID' },
        });
      if (invalidation.count === 1) {
        await this.getStorage().deleteFile(intent.objectKey).catch(() => {});
      }
      throw new BadRequestException(
        `Uploaded audio size (${head.contentLength} bytes) does not match declared size (${intent.expectedSizeBytes} bytes).`,
      );
    }

    // 7. Atomic creation and quota enforcement under PostgreSQL advisory lock
    const DAILY_LIMIT = 10;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    let submission: any;
    try {
      submission = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtext(${`speaking-quota:${userId}:${startOfDay.toISOString().slice(0, 10)}`})
          );
        `;

        // Check daily quota
        const submissionsToday = await tx.speakingSubmission.count({
          where: { userId, submittedAt: { gte: startOfDay } },
        });
        if (submissionsToday >= DAILY_LIMIT) {
          throw new BadRequestException(
            `Bạn đã đạt giới hạn chấm điểm phát âm hôm nay (${DAILY_LIMIT} lần). Vui lòng quay lại vào ngày mai để luyện tập tiếp nhé!`,
          );
        }

        const publicUrl = this.getStorage().getPublicUrl();
        const audioUrl = publicUrl
          ? `${publicUrl}/${intent.objectKey}`
          : intent.objectKey;

        // Create submission
        const newSub = await tx.speakingSubmission.create({
          data: {
            exerciseId: intent.exerciseId,
            userId: intent.userId,
            status: 'PENDING',
            audioKey: intent.objectKey,
            audioUrl,
            audioMimeType: intent.expectedContentType,
            durationMs: intent.expectedDurationMs,
            idempotencyKey: intent.idempotencyKey,
            provider: 'azure',
            scoreVersion: 'v1',
          },
        });

        // Mark intent FINALIZED with token fencing (Correction A)
        const updateResult = await tx.speakingUploadIntent.updateMany({
          where: {
            id: uploadIntentId,
            status: 'FINALIZING',
            finalizationToken: token,
          },
          data: {
            status: 'FINALIZED',
            finalizedAt: new Date(),
            submissionId: newSub.id,
          },
        });

        if (updateResult.count === 0) {
          throw new ConflictException(
            'Finalization token expired or superseded by another worker',
          );
        }

        return newSub;
      });
    } catch (txError) {
      // Recoverable transient failure: revert FINALIZING -> PENDING with token fencing if submission was not created
      const current = await this.prisma.speakingUploadIntent.findUnique({
        where: { id: uploadIntentId },
      });
      if (
        current &&
        current.status === 'FINALIZING' &&
        current.finalizationToken === token &&
        !current.submissionId
      ) {
        await this.prisma.speakingUploadIntent
          .updateMany({
            where: {
              id: uploadIntentId,
              status: 'FINALIZING',
              finalizationToken: token,
            },
            data: {
              status: 'PENDING',
              finalizationStartedAt: null,
              finalizationToken: null,
            },
          })
          .catch(() => {});
      }
      throw txError;
    }

    if (!submission) {
      throw new InternalServerErrorException(
        'Failed to finalize speaking submission',
      );
    }

    // 8. Enqueue BullMQ job only AFTER transaction commits
    const pipelineMode = getSpeakingPipelineMode();
    if (pipelineMode === 'bullmq' && this.speakingQueueService) {
      try {
        await this.speakingQueueService.enqueueSubmission(
          submission.id,
          traceId,
        );
        this.logger.log(
          `[SpeakingService] Enqueued submission #${submission.id} from intent ${uploadIntentId} to BullMQ queue (traceId=${traceId})`,
        );
      } catch (queueErr: any) {
        this.logger.error(
          `[SpeakingService] Failed to enqueue submission #${submission.id} to BullMQ: ${queueErr.message}. Submission remains PENDING in DB for reconciliation. (traceId=${traceId})`,
        );
      }
    } else {
      this.speakingWorkerService?.triggerProcessing?.();
    }

    // 9. Return HTTP 202 Accepted payload
    return {
      submissionId: submission.id,
      status: 'PENDING',
      pollUrl: `/speaking/submissions/${submission.id}`,
      acceptedAt: submission.submittedAt.toISOString(),
      traceId,
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

  private async synthesizeSsml(
    ssml: string,
    cacheKey: string,
  ): Promise<Buffer> {
    if (this.redis) {
      try {
        const cachedBase64 = await this.redis.get(cacheKey);
        if (cachedBase64) return Buffer.from(cachedBase64, 'base64');
      } catch (cacheErr) {
        this.logger.warn(`TTS Redis cache get failed: ${cacheErr}`);
      }
    }

    const azureKey = process.env.AZURE_SPEECH_KEY;
    const azureRegion = process.env.AZURE_SPEECH_REGION;
    if (!azureKey || !azureRegion) {
      throw new ServiceUnavailableException(
        'Dịch vụ phát âm mẫu hiện chưa được cấu hình.',
      );
    }

    const response = await fetch(
      `https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`,
      {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': azureKey,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
          'User-Agent': 'BreadtransKLTN',
        },
        body: ssml,
      },
    );

    if (!response.ok) {
      const errBody = await response.text();
      this.logger.error(`Azure TTS failed (${response.status}): ${errBody}`);
      throw new BadRequestException('TTS synthesis failed at provider');
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
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

    // 2. Check deterministic Redis cache and synthesize via Azure Neural TTS.
    const hash = crypto
      .createHash('md5')
      .update(`${accent}:${rate}:${trimmedText.toLowerCase()}`)
      .digest('hex');
    const cacheKey = `tts:${accent}:${rate}:${hash}`;

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

    return this.synthesizeSsml(ssml, cacheKey);
  }

  async generateDialogueTts(
    segments: DialogueTtsSegment[],
    accent: 'US' | 'UK',
    rate: number,
  ): Promise<Buffer> {
    if (!Array.isArray(segments) || segments.length === 0) {
      throw new BadRequestException('Dialogue segments are required for TTS');
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

    const cleanSegments = segments
      .map((segment) => ({
        speaker: typeof segment.speaker === 'string' ? segment.speaker : '',
        speakerId:
          typeof segment.speakerId === 'string' ? segment.speakerId : undefined,
        voiceKey:
          typeof segment.voiceKey === 'string' ? segment.voiceKey : undefined,
        text: typeof segment.text === 'string' ? segment.text.trim() : '',
      }))
      .filter((segment) => segment.text.length > 0);
    const totalCharacters = cleanSegments.reduce(
      (total, segment) => total + segment.text.length,
      0,
    );
    if (cleanSegments.length === 0 || totalCharacters > 4000) {
      throw new BadRequestException('Dialogue text is empty or too long');
    }

    const source = JSON.stringify({ accent, rate, segments: cleanSegments });
    // v4 invalidates dialogue audio produced before the gender mapping fix.
    const cacheKey = `tts:dialogue:v4:${crypto.createHash('md5').update(source).digest('hex')}`;
    const ssml = buildDialogueSsml(cleanSegments, accent, rate);
    return this.synthesizeSsml(ssml, cacheKey);
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
