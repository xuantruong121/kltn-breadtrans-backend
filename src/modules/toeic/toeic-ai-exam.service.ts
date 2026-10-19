import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  AiGenerationJobStatus,
  AiGenerationJobType,
  Prisma,
  QuizPublicationStatus,
  QuizType,
  SpeakingStimulusKind,
} from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { Job, Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { parseBuffer } from 'music-metadata';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { R2Service } from '../upload/r2.service';
import { GenericExamService } from './generic-exam.service';
import { CreateToeicAiExamDto } from './toeic-ai-exam.dto';
import { validateToeicExam } from './toeic.validation';
import { TOEIC_SPEAKING_TASK_SEQUENCE } from '../speaking/toeic-speaking-contract';
import { TOEIC_WRITING_SLOT_CONTRACT } from '../writing/toeic-writing-set.contract';

const TOEIC_AI_QUEUE = 'breadtrans-toeic-ai-exam';
const PRACTICE_DISCLAIMER =
  'Lưu ý: Đây là đề luyện tập tham khảo được xây dựng nhằm mô phỏng cấu trúc TOEIC. Nội dung không phải đề thi chính thức do ETS phát hành và không thay thế bài thi TOEIC chính thức.';

type PlannedGroup = { questionCount: number; kind?: 'SINGLE' | 'MULTIPLE' };
type JobPayload = { version: 1; jobId: string };
type RequestSnapshot = {
  kind: 'TOEIC_PRACTICE_EXAM';
  mode: 'FULL_EXAM' | 'PART';
  part?: number;
  variantCode: 'TOEIC_LR' | 'TOEIC_SW' | 'TOEIC_4_SKILLS';
  topic?: string;
  difficulty: 'easy' | 'medium' | 'hard';
  plan: Record<number, PlannedGroup[]>;
};

const sha256 = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');

function planFor(part: number): PlannedGroup[] {
  switch (part) {
    case 1:
      return Array.from({ length: 6 }, () => ({ questionCount: 1 }));
    case 2:
      return Array.from({ length: 25 }, () => ({ questionCount: 1 }));
    case 3:
      return Array.from({ length: 13 }, () => ({ questionCount: 3 }));
    case 4:
      return Array.from({ length: 10 }, () => ({ questionCount: 3 }));
    case 5:
      return Array.from({ length: 30 }, () => ({ questionCount: 1 }));
    case 6:
      return Array.from({ length: 4 }, () => ({ questionCount: 4 }));
    case 7:
      return [
        ...Array.from({ length: 9 }, () => ({
          questionCount: 3,
          kind: 'SINGLE' as const,
        })),
        { questionCount: 2, kind: 'SINGLE' as const },
        ...Array.from({ length: 5 }, () => ({
          questionCount: 5,
          kind: 'MULTIPLE' as const,
        })),
      ];
    default:
      throw new BadRequestException('Part TOEIC không hợp lệ');
  }
}

function isPng(buffer: Buffer) {
  return (
    buffer.length >= 24 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  );
}

function isJpeg(buffer: Buffer) {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  );
}

function imageDimensions(
  buffer: Buffer,
): { width: number; height: number } | null {
  if (isPng(buffer))
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  if (!isJpeg(buffer)) return null;
  for (let offset = 2; offset + 9 < buffer.length;) {
    if (buffer[offset] !== 0xff) break;
    const marker = buffer[offset + 1];
    const size = buffer.readUInt16BE(offset + 2);
    if ([0xc0, 0xc1, 0xc2, 0xc3].includes(marker)) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + size;
  }
  return null;
}

@Injectable()
export class ToeicAiExamService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ToeicAiExamService.name);
  private readonly connection = new IORedis(
    process.env.REDIS_URL || 'redis://localhost:6379',
    {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    },
  );
  private readonly queue = new Queue<JobPayload, unknown, 'generate'>(
    TOEIC_AI_QUEUE,
    {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 30 * 86400, count: 250 },
        removeOnFail: { age: 7 * 86400, count: 250 },
      },
    },
  );
  private worker?: Worker<JobPayload, unknown, 'generate'>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly genericExam: GenericExamService,
    private readonly ai: AiService,
    private readonly r2: R2Service,
  ) {}

  onModuleInit() {
    this.worker = new Worker<JobPayload, unknown, 'generate'>(
      TOEIC_AI_QUEUE,
      async (job) => this.process(job),
      { connection: this.connection, concurrency: 1 },
    );
    this.worker.on('failed', (job, error) =>
      this.logger.error(
        `toeic_ai_job_failed jobId=${job?.data?.jobId}: ${error.message}`,
      ),
    );
    this.worker.on('error', (error) =>
      this.logger.error(`toeic_ai_worker_error: ${error.message}`),
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue.close();
    await this.connection.quit();
  }

  private snapshot(dto: CreateToeicAiExamDto): RequestSnapshot {
    const mode = dto.mode ?? 'FULL_EXAM';
    const hasLr = ['TOEIC_LR', 'TOEIC_4_SKILLS'].includes(dto.variantCode);
    const parts = hasLr
      ? mode === 'PART'
        ? [dto.part!]
        : [1, 2, 3, 4, 5, 6, 7]
      : [];
    return {
      kind: 'TOEIC_PRACTICE_EXAM',
      mode,
      part: mode === 'PART' ? dto.part : undefined,
      variantCode: dto.variantCode,
      topic: dto.topic?.trim() || undefined,
      difficulty: dto.difficulty ?? 'medium',
      plan: Object.fromEntries(parts.map((part) => [part, planFor(part)])),
    };
  }

  async start(
    dto: CreateToeicAiExamDto,
    adminId: number,
    idempotencyKey?: string,
  ) {
    if (dto.variantCode !== 'TOEIC_LR' && dto.mode === 'PART') {
      throw new BadRequestException(
        'Chế độ tạo riêng theo Part hiện chỉ áp dụng cho TOEIC Listening & Reading.',
      );
    }
    if (dto.mode === 'PART' && !dto.part) {
      throw new BadRequestException('Cần chọn Part cần tạo');
    }
    if (idempotencyKey) {
      const existing = await this.prisma.aiGenerationJob.findUnique({
        where: { idempotencyKey },
      });
      if (existing) return this.status(existing.id);
    }
    const active = await this.prisma.aiGenerationJob.findFirst({
      where: {
        createdByAdminId: adminId,
        generationType: AiGenerationJobType.TOEIC_QUIZ,
        status: {
          in: [AiGenerationJobStatus.QUEUED, AiGenerationJobStatus.PROCESSING],
        },
        requestSnapshot: { path: ['kind'], equals: 'TOEIC_PRACTICE_EXAM' },
      },
    });
    if (active)
      throw new ConflictException(
        'Bạn đang có một đề TOEIC AI đang được tạo. Hãy chờ hoàn tất hoặc hủy trước.',
      );

    const request = this.snapshot(dto);
    const label =
      dto.variantCode === 'TOEIC_LR'
        ? 'Listening & Reading'
        : dto.variantCode === 'TOEIC_SW'
          ? 'Speaking & Writing'
          : '4 Skills';
    const title = `TOEIC ${label} — Practice Test ${new Date().toISOString().slice(0, 10)}`;
    const draft = await this.genericExam.createDraft(
      {
        familyCode: 'TOEIC',
        variantCode: dto.variantCode,
        title,
        description: PRACTICE_DISCLAIMER,
        type: request.mode === 'FULL_EXAM' ? 'FULL_TEST' : 'PRACTICE_BY_PART',
        difficulty: request.difficulty,
        durationSeconds: 7200,
      },
      adminId,
    );
    const jobId = randomUUID();
    await this.prisma.$transaction([
      this.prisma.aiGenerationJob.create({
        data: {
          id: jobId,
          createdByAdminId: adminId,
          generationType: AiGenerationJobType.TOEIC_QUIZ,
          status: AiGenerationJobStatus.QUEUED,
          idempotencyKey,
          requestSnapshot: request,
          resultSnapshot: {
            stage: 'QUEUED',
            parts: {},
          },
          provider: 'GEMINI',
          model: process.env.GEMINI_MODEL_NAME || 'gemini-3.1-flash-lite',
          generatorVersion: 'toeic-ai-exam-v1',
          promptVersion: 'toeic-practice-original-v1',
        },
      }),
      this.prisma.exam.update({
        where: { id: draft.id },
        data: { aiGenerationJobId: jobId },
      }),
    ]);
    await this.queue.add('generate', { version: 1, jobId }, { jobId });
    return this.status(jobId);
  }

  async status(jobId: string) {
    const job = await this.prisma.aiGenerationJob.findUnique({
      where: { id: jobId },
    });
    if (!job || (job.requestSnapshot as any)?.kind !== 'TOEIC_PRACTICE_EXAM')
      throw new NotFoundException('Không tìm thấy job tạo đề TOEIC AI');
    const exam = await this.prisma.exam.findUnique({
      where: { aiGenerationJobId: jobId },
      select: { id: true, title: true, publicationStatus: true },
    });
    return {
      id: job.id,
      status: job.status,
      stage: (job.resultSnapshot as any)?.stage ?? 'QUEUED',
      progress: (job.resultSnapshot as any)?.parts ?? {},
      error: job.errorSummary ?? undefined,
      exam,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }

  async retry(jobId: string, adminId: number) {
    const job = await this.prisma.aiGenerationJob.findUnique({
      where: { id: jobId },
    });
    if (!job || job.createdByAdminId !== adminId)
      throw new NotFoundException('Không tìm thấy job tạo đề TOEIC AI');
    if (job.status !== AiGenerationJobStatus.FAILED)
      throw new ConflictException('Chỉ job lỗi mới có thể thử lại');
    await this.prisma.aiGenerationJob.update({
      where: { id: jobId },
      data: {
        status: AiGenerationJobStatus.QUEUED,
        errorSummary: null,
        completedAt: null,
        attempt: { increment: 1 },
        resultSnapshot: {
          ...(job.resultSnapshot as object),
          stage: 'QUEUED',
        },
      },
    });
    const existing = await this.queue.getJob(jobId);
    if (existing) await existing.remove();
    await this.queue.add('generate', { version: 1, jobId }, { jobId });
    return this.status(jobId);
  }

  async cancel(jobId: string, adminId: number) {
    const job = await this.prisma.aiGenerationJob.findUnique({
      where: { id: jobId },
    });
    if (!job || job.createdByAdminId !== adminId)
      throw new NotFoundException('Không tìm thấy job tạo đề TOEIC AI');
    const terminalStatuses: AiGenerationJobStatus[] = [
      AiGenerationJobStatus.GENERATED,
      AiGenerationJobStatus.APPROVED,
      AiGenerationJobStatus.PUBLISHED,
    ];
    if (terminalStatuses.includes(job.status)) {
      throw new ConflictException(
        'Bản nháp đã sẵn sàng review nên không thể hủy job',
      );
    }
    await this.prisma.aiGenerationJob.update({
      where: { id: jobId },
      data: {
        status: AiGenerationJobStatus.CANCELLED,
        resultSnapshot: {
          ...(job.resultSnapshot as object),
          stage: 'CANCELLED',
        },
      },
    });
    const queued = await this.queue.getJob(jobId);
    if (queued) await queued.remove();
    return this.status(jobId);
  }

  private async editableDraft(examId: number) {
    const exam = await this.prisma.exam.findUnique({
      where: { id: examId },
      include: {
        toeicExamSet: { include: { _count: { select: { attempts: true } } } },
      },
    });
    if (!exam?.toeicExamSet)
      throw new NotFoundException('Không tìm thấy nguồn TOEIC L&R của đề');
    if (exam.publicationStatus !== 'DRAFT')
      throw new ConflictException('Chỉ Draft mới có thể tạo lại nội dung AI');
    if (exam.toeicExamSet._count.attempts)
      throw new ConflictException(
        'Đề đã có lịch sử làm bài; không thể thay đổi nội dung lịch sử',
      );
    return exam;
  }

  async regenerateQuestionCandidate(
    examId: number,
    groupId: number,
    questionId: number,
    topic?: string,
  ) {
    const exam = await this.editableDraft(examId);
    const group = await this.prisma.toeicQuestionGroup.findFirst({
      where: { id: groupId, examId: exam.toeicExamSet!.id },
      include: { questions: { where: { id: questionId } } },
    });
    if (!group?.questions[0])
      throw new NotFoundException('Không tìm thấy câu hỏi trong Draft');
    const candidate = await this.ai.generateToeicExamBatch({
      part: group.part,
      topic,
      difficulty: exam.toeicExamSet!.difficulty as 'easy' | 'medium' | 'hard',
      groups: [{ questionCount: 1 }],
    });
    this.assertBatch(group.part, [{ questionCount: 1 }], candidate);
    return {
      mode: 'CANDIDATE_ONLY',
      questionId,
      candidate: candidate.groups[0].questions[0],
    };
  }

  async regenerateGroupCandidate(
    examId: number,
    groupId: number,
    topic?: string,
  ) {
    const exam = await this.editableDraft(examId);
    const group = await this.prisma.toeicQuestionGroup.findFirst({
      where: { id: groupId, examId: exam.toeicExamSet!.id },
      include: { questions: true },
    });
    if (!group) throw new NotFoundException('Không tìm thấy nhóm trong Draft');
    const plan: PlannedGroup[] = [{ questionCount: group.questions.length }];
    const candidate = await this.ai.generateToeicExamBatch({
      part: group.part,
      topic,
      difficulty: exam.toeicExamSet!.difficulty as 'easy' | 'medium' | 'hard',
      groups: plan,
    });
    this.assertBatch(group.part, plan, candidate);
    return { mode: 'CANDIDATE_ONLY', groupId, candidate: candidate.groups[0] };
  }

  async regeneratePartCandidate(examId: number, part: number, topic?: string) {
    const exam = await this.editableDraft(examId);
    const plan = planFor(part);
    const batches: unknown[] = [];
    for (let offset = 0; offset < plan.length; offset += 3) {
      const slice = plan.slice(offset, offset + 3);
      const candidate = await this.ai.generateToeicExamBatch({
        part,
        topic,
        difficulty: exam.toeicExamSet!.difficulty as 'easy' | 'medium' | 'hard',
        groups: slice,
      });
      this.assertBatch(part, slice, candidate);
      batches.push(...candidate.groups);
    }
    return {
      mode: 'CANDIDATE_ONLY',
      part,
      groups: batches,
      requiresConfirmationToApply: true,
    };
  }

  async regenerateMedia(
    examId: number,
    groupId: number,
    kind: 'image' | 'audio',
  ) {
    const exam = await this.editableDraft(examId);
    const group = await this.prisma.toeicQuestionGroup.findFirst({
      where: { id: groupId, examId: exam.toeicExamSet!.id },
    });
    if (!group) throw new NotFoundException('Không tìm thấy nhóm trong Draft');
    const metadata = (group.mediaMetadata as any) ?? {};
    if (kind === 'image') {
      if (group.part !== 1 || !group.imageBrief?.trim())
        throw new BadRequestException(
          'Chỉ Part 1 có thể tạo lại ảnh từ mô tả hiện tại',
        );
      const image = await this.ai.generateToeicExamImage({
        brief: group.imageBrief,
        part: 1,
      });
      this.assertImage(image.buffer, image.mimeType);
      const uploaded = await this.r2.putObjectAtKey(
        `ai/toeic-exams/exam-${exam.toeicExamSet!.id}/groups/${group.id}/image-regenerated.${image.mimeType === 'image/png' ? 'png' : 'jpg'}`,
        image.buffer,
        image.mimeType,
      );
      if (!(await this.r2.objectExists(uploaded.key)))
        throw new BadRequestException('R2 chưa xác nhận ảnh tạo lại');
      metadata.image = {
        source: 'AI_GENERATED',
        r2Key: uploaded.key,
        generatedAt: new Date().toISOString(),
        briefHash: sha256(group.imageBrief),
      };
      return this.prisma.toeicQuestionGroup.update({
        where: { id: group.id },
        data: {
          imageUrl: uploaded.url,
          mediaMetadata: metadata as Prisma.InputJsonValue,
        },
      });
    }
    if (group.part > 4 || !group.transcriptText?.trim())
      throw new BadRequestException(
        'Nhóm này không có transcript Listening để tạo lại audio',
      );
    const audio = await this.makeAudio(group.transcriptText);
    const uploaded = await this.r2.putObjectAtKey(
      `ai/toeic-exams/exam-${exam.toeicExamSet!.id}/groups/${group.id}/audio-regenerated.mp3`,
      audio,
      'audio/mpeg',
    );
    if (!(await this.r2.objectExists(uploaded.key)))
      throw new BadRequestException('R2 chưa xác nhận audio tạo lại');
    metadata.audio = {
      source: 'AI_GENERATED',
      r2Key: uploaded.key,
      generatedAt: new Date().toISOString(),
      transcriptHash: sha256(group.transcriptText),
    };
    return this.prisma.toeicQuestionGroup.update({
      where: { id: group.id },
      data: {
        audioUrl: uploaded.url,
        mediaMetadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  private async checkpoint(
    jobId: string,
    stage: string,
    part?: number,
    data?: object,
  ) {
    const job = await this.prisma.aiGenerationJob.findUniqueOrThrow({
      where: { id: jobId },
      select: { resultSnapshot: true, status: true },
    });
    if (job.status === AiGenerationJobStatus.CANCELLED)
      throw new Error('Generation cancelled by Admin');
    const current = (job.resultSnapshot as any) ?? {};
    await this.prisma.aiGenerationJob.update({
      where: { id: jobId },
      data: {
        resultSnapshot: {
          ...current,
          stage,
          parts: part
            ? { ...(current.parts ?? {}), [part]: data ?? { stage } }
            : (current.parts ?? {}),
        } as Prisma.InputJsonValue,
      },
    });
  }

  private assertBatch(part: number, expected: PlannedGroup[], candidate: any) {
    if (
      !Array.isArray(candidate?.groups) ||
      candidate.groups.length !== expected.length
    )
      throw new BadRequestException('AI trả về sai cấu trúc nhóm');
    const seen = new Set<string>();
    candidate.groups.forEach((group: any, index: number) => {
      if (
        !Array.isArray(group.questions) ||
        group.questions.length !== expected[index].questionCount
      )
        throw new BadRequestException(`Nhóm ${index + 1} có sai số câu hỏi`);
      if ([1, 2, 3, 4].includes(part) && !String(group.transcript ?? '').trim())
        throw new BadRequestException(
          `Nhóm Listening ${index + 1} thiếu transcript`,
        );
      if ([6, 7].includes(part) && !String(group.passageText ?? '').trim())
        throw new BadRequestException(
          `Nhóm Reading ${index + 1} thiếu passage`,
        );
      if (part === 1 && !String(group.imageBrief ?? '').trim())
        throw new BadRequestException(
          `Nhóm Part 1 ${index + 1} thiếu mô tả ảnh`,
        );
      group.questions.forEach((question: any) => {
        const options: string[] = Array.isArray(question.options)
          ? question.options.map((value: unknown) => String(value ?? '').trim())
          : [];
        const optionCount = part === 2 ? 3 : 4;
        if (
          options.length !== optionCount ||
          options.some((value: string) => !value) ||
          new Set(options.map((value: string) => value.toLowerCase())).size !==
            optionCount
        )
          throw new BadRequestException('AI trả về phương án không hợp lệ');
        if (
          !Number.isInteger(question.correctIndex) ||
          question.correctIndex < 0 ||
          question.correctIndex >= options.length
        )
          throw new BadRequestException('AI trả về đáp án không hợp lệ');
        if (String(question.explanation ?? '').trim().length < 20)
          throw new BadRequestException(
            'AI trả về giải thích không đủ chất lượng',
          );
        const fingerprint =
          `${String(question.text ?? '')} ${options.join('|')}`
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
        if (seen.has(fingerprint))
          throw new BadRequestException(
            'AI trả về câu hỏi trùng lặp trong batch',
          );
        seen.add(fingerprint);
      });
    });
  }

  private async writeBatch(
    examSetId: number,
    part: number,
    firstGroupOrder: number,
    firstQuestionNumber: number,
    candidate: any,
  ) {
    let questionNumber = firstQuestionNumber;
    for (let index = 0; index < candidate.groups.length; index += 1) {
      const group = candidate.groups[index];
      await this.prisma.toeicQuestionGroup.create({
        data: {
          examId: examSetId,
          part,
          groupOrder: firstGroupOrder + index,
          transcriptText: group.transcript?.trim() || null,
          passageText: group.passageText?.trim() || null,
          imageBrief: group.imageBrief?.trim() || null,
          mediaMetadata: {
            source: 'AI_GENERATED',
            generatedAt: new Date().toISOString(),
          },
          questions: {
            create: group.questions.map((question: any) => ({
              questionNumber: questionNumber++,
              text: question.text?.trim() || null,
              options: question.options.map((option: unknown) =>
                String(option).trim(),
              ),
              correctIndex: question.correctIndex,
              explanation: question.explanation.trim(),
            })),
          },
        },
      });
    }
  }

  private async makeAudio(transcript: string) {
    const audio = await this.ai.generateToeicListeningAudio(transcript);
    if (!audio?.length)
      throw new BadRequestException('Không thể tạo audio TTS cho transcript');
    const metadata = await parseBuffer(audio, { mimeType: 'audio/mpeg' });
    if (!metadata.format.duration || metadata.format.duration <= 0)
      throw new BadRequestException('Audio TTS không có thời lượng hợp lệ');
    return audio;
  }

  private assertImage(buffer: Buffer, mimeType: string) {
    const dimensions = imageDimensions(buffer);
    if (
      !mimeType.startsWith('image/') ||
      !dimensions ||
      dimensions.width < 160 ||
      dimensions.height < 120 ||
      buffer.length < 1024
    ) {
      throw new BadRequestException(
        'Ảnh AI không qua kiểm tra MIME, magic bytes hoặc kích thước',
      );
    }
  }

  private async materializeMedia(jobId: string, examSetId: number) {
    await this.checkpoint(jobId, 'GENERATING_MEDIA');
    const groups = await this.prisma.toeicQuestionGroup.findMany({
      where: { examId: examSetId, part: { lte: 4 } },
      orderBy: { groupOrder: 'asc' },
    });
    for (const group of groups) {
      const metadata = (group.mediaMetadata as any) ?? {};
      if (group.part === 1) {
        const image = await this.ai.generateToeicExamImage({
          brief: group.imageBrief || 'natural workplace scene',
          part: 1,
        });
        this.assertImage(image.buffer, image.mimeType);
        const uploaded = await this.r2.putObjectAtKey(
          `ai/toeic-exams/exam-${examSetId}/groups/${group.id}/image.${image.mimeType === 'image/png' ? 'png' : 'jpg'}`,
          image.buffer,
          image.mimeType,
        );
        if (!(await this.r2.objectExists(uploaded.key)))
          throw new BadRequestException('R2 chưa xác nhận ảnh AI vừa tải lên');
        metadata.image = {
          source: 'AI_GENERATED',
          r2Key: uploaded.key,
          generatedAt: new Date().toISOString(),
          briefHash: sha256(group.imageBrief || ''),
        };
        await this.prisma.toeicQuestionGroup.update({
          where: { id: group.id },
          data: {
            imageUrl: uploaded.url,
            mediaMetadata: metadata as Prisma.InputJsonValue,
          },
        });
      }
      const transcript = group.transcriptText?.trim();
      if (!transcript)
        throw new BadRequestException(
          `Nhóm Listening #${group.id} thiếu transcript`,
        );
      const audio = await this.makeAudio(transcript);
      const uploaded = await this.r2.putObjectAtKey(
        `ai/toeic-exams/exam-${examSetId}/groups/${group.id}/audio.mp3`,
        audio,
        'audio/mpeg',
      );
      if (!(await this.r2.objectExists(uploaded.key)))
        throw new BadRequestException('R2 chưa xác nhận audio AI vừa tải lên');
      metadata.audio = {
        source: 'AI_GENERATED',
        r2Key: uploaded.key,
        generatedAt: new Date().toISOString(),
        transcriptHash: sha256(transcript),
      };
      await this.prisma.toeicQuestionGroup.update({
        where: { id: group.id },
        data: {
          audioUrl: uploaded.url,
          mediaMetadata: metadata as Prisma.InputJsonValue,
        },
      });
    }
    await this.checkpoint(jobId, 'VALIDATING_MEDIA');
  }

  private assertSpeakingWritingDraft(draft: any, request: RequestSnapshot) {
    const needsSpeaking = ['TOEIC_SW', 'TOEIC_4_SKILLS'].includes(
      request.variantCode,
    );
    const needsWriting = needsSpeaking;
    const speaking = Array.isArray(draft?.speaking) ? draft.speaking : [];
    const writing = Array.isArray(draft?.writing) ? draft.writing : [];
    if (
      (needsSpeaking &&
        speaking.length !== TOEIC_SPEAKING_TASK_SEQUENCE.length) ||
      (!needsSpeaking && speaking.length)
    )
      throw new BadRequestException('AI trả về sai cấu trúc TOEIC Speaking');
    if (
      (needsWriting && writing.length !== TOEIC_WRITING_SLOT_CONTRACT.length) ||
      (!needsWriting && writing.length)
    )
      throw new BadRequestException('AI trả về sai cấu trúc TOEIC Writing');
    speaking.forEach((exercise: any, index: number) => {
      if (
        exercise?.taskType !== TOEIC_SPEAKING_TASK_SEQUENCE[index] ||
        !String(exercise?.title ?? '').trim() ||
        !String(exercise?.targetText ?? '').trim()
      )
        throw new BadRequestException(`Câu Speaking ${index + 1} không hợp lệ`);
      if ([2, 3].includes(index) && !String(exercise.imageBrief ?? '').trim())
        throw new BadRequestException(
          `Câu Speaking ${index + 1} thiếu image brief`,
        );
    });
    if (needsSpeaking) {
      const shared = speaking
        .slice(7, 10)
        .map((item: any) => String(item.informationStimulus ?? '').trim());
      if (!shared[0] || shared.some((value: string) => value !== shared[0]))
        throw new BadRequestException(
          'Câu Speaking 8–10 phải dùng cùng một thông tin tham chiếu',
        );
    }
    writing.forEach((task: any, index: number) => {
      if (
        task?.taskKind !== TOEIC_WRITING_SLOT_CONTRACT[index] ||
        !String(task?.title ?? '').trim() ||
        !String(task?.prompt ?? '').trim()
      )
        throw new BadRequestException(`Task Writing ${index + 1} không hợp lệ`);
      if (
        task.taskKind === 'PICTURE_SENTENCE' &&
        !String(task.imageBrief ?? '').trim()
      )
        throw new BadRequestException(
          `Task Writing ${index + 1} thiếu image brief`,
        );
    });
  }

  private async generatedImageUrl(scope: string, brief: string, part: number) {
    const image = await this.ai.generateToeicExamImage({ brief, part });
    this.assertImage(image.buffer, image.mimeType);
    const extension = image.mimeType === 'image/png' ? 'png' : 'jpg';
    const uploaded = await this.r2.putObjectAtKey(
      `ai/toeic-exams/${scope}.${extension}`,
      image.buffer,
      image.mimeType,
    );
    if (!(await this.r2.objectExists(uploaded.key)))
      throw new BadRequestException('R2 chưa xác nhận ảnh AI vừa tải lên');
    return {
      url: uploaded.url,
      metadata: {
        source: 'AI_GENERATED',
        r2Key: uploaded.key,
        generatedAt: new Date().toISOString(),
        briefHash: sha256(brief),
      },
    };
  }

  private async materializeSpeakingWriting(
    jobId: string,
    exam: any,
    request: RequestSnapshot,
  ) {
    if (!['TOEIC_SW', 'TOEIC_4_SKILLS'].includes(request.variantCode)) return;
    const components = exam.toeicAssessment?.components ?? [];
    const speakingSetId = components.find(
      (component: any) => component.kind === 'SPEAKING',
    )?.speakingPracticeSetId;
    const writingSetId = components.find(
      (component: any) => component.kind === 'WRITING',
    )?.writingSetId;
    if (!speakingSetId || !writingSetId)
      throw new NotFoundException('Draft thiếu source TOEIC Speaking/Writing');
    await this.checkpoint(jobId, 'GENERATING_TEXT');
    const draft = await this.ai.generateToeicSpeakingWritingDraft({
      topic: request.topic,
      difficulty: request.difficulty,
      includeSpeaking: true,
      includeWriting: true,
    });
    this.assertSpeakingWritingDraft(draft, request);
    await this.prisma.$transaction(async (tx) => {
      const oldItems = await tx.toeicWritingSetItem.findMany({
        where: { writingSetId },
        select: { writingQuizId: true },
      });
      await tx.toeicWritingSetItem.deleteMany({ where: { writingSetId } });
      if (oldItems.length)
        await tx.quiz.deleteMany({
          where: { id: { in: oldItems.map((item) => item.writingQuizId) } },
        });
      await tx.speakingExercise.deleteMany({
        where: { practiceSetId: speakingSetId },
      });
    });
    const sharedInformation = await this.prisma.speakingStimulus.create({
      data: {
        kind: SpeakingStimulusKind.INFORMATION,
        title: 'TOEIC Speaking information source',
        content: draft.speaking[7].informationStimulus!.trim(),
      },
    });
    for (const [index, exercise] of draft.speaking.entries()) {
      const image = exercise.imageBrief
        ? await this.generatedImageUrl(
            `exam-${exam.id}/speaking/${index + 1}`,
            exercise.imageBrief,
            1,
          )
        : null;
      await this.prisma.speakingExercise.create({
        data: {
          title: exercise.title.trim(),
          targetText: exercise.targetText.trim(),
          category: 'TOEIC',
          difficulty: 'INTERMEDIATE',
          taskType: exercise.taskType as any,
          imageUrl: image?.url,
          stimulusId: index >= 7 && index <= 9 ? sharedInformation.id : null,
          practiceSetId: speakingSetId,
          order: index + 1,
          publicationStatus: QuizPublicationStatus.DRAFT,
        },
      });
    }
    for (const [index, task] of draft.writing.entries()) {
      const image = task.imageBrief
        ? await this.generatedImageUrl(
            `exam-${exam.id}/writing/${index + 1}`,
            task.imageBrief,
            1,
          )
        : null;
      const content = {
        prompt: task.prompt.trim(),
        taskType:
          task.taskKind === 'PICTURE_SENTENCE'
            ? 'PICTURE_SENTENCE'
            : task.taskKind,
        imageUrl: image?.url,
        keywords: task.keywords?.map((value) => value.trim()).filter(Boolean),
        wordRange: task.wordRange,
        aiMedia: image?.metadata,
      };
      const quiz = await this.prisma.quiz.create({
        data: {
          title: task.title.trim(),
          description: PRACTICE_DISCLAIMER,
          type:
            task.taskKind === 'PICTURE_SENTENCE'
              ? QuizType.WRITING_PICTURE
              : QuizType.WRITING_EMAIL,
          publicationStatus: QuizPublicationStatus.DRAFT,
          questions: {
            create: {
              type: 'WRITING',
              content,
              order: 0,
            },
          },
        },
      });
      await this.prisma.toeicWritingSetItem.create({
        data: {
          writingSetId,
          writingQuizId: quiz.id,
          order: index + 1,
          taskKind: task.taskKind,
        },
      });
    }
    await this.checkpoint(jobId, 'VALIDATING_MEDIA');
  }

  private async process(queueJob: Job<JobPayload>) {
    const jobId = queueJob.data.jobId;
    const job = await this.prisma.aiGenerationJob.findUnique({
      where: { id: jobId },
    });
    if (!job || job.status === AiGenerationJobStatus.CANCELLED) return;
    const request = job.requestSnapshot as unknown as RequestSnapshot;
    const exam = await this.prisma.exam.findUnique({
      where: { aiGenerationJobId: jobId },
      include: {
        toeicExamSet: true,
        toeicAssessment: { include: { components: true } },
      },
    });
    if (!exam)
      throw new NotFoundException('Không tìm thấy Draft TOEIC đích của job AI');
    try {
      await this.prisma.aiGenerationJob.update({
        where: { id: jobId },
        data: {
          status: AiGenerationJobStatus.PROCESSING,
          startedAt: new Date(),
          errorSummary: null,
        },
      });
      const existingAttempts = exam.toeicExamSet
        ? await this.prisma.toeicAttempt.count({
            where: { examId: exam.toeicExamSet.id },
          })
        : await this.prisma.toeicAssessmentAttempt.count({
            where: { assessmentId: exam.toeicAssessment?.id ?? -1 },
          });
      if (existingAttempts)
        throw new ConflictException(
          'Không thể tạo lại Draft AI đã có lịch sử làm bài',
        );
      if (exam.toeicExamSet) {
        await this.prisma.toeicQuestionGroup.deleteMany({
          where: { examId: exam.toeicExamSet.id },
        });
      }
      let groupOrder = 1;
      let questionNumber = 1;
      const lrExamSet = exam.toeicExamSet;
      if (Object.keys(request.plan).length && !lrExamSet) {
        throw new NotFoundException(
          'Draft thiếu source TOEIC Listening/Reading',
        );
      }
      for (const [rawPart, plan] of Object.entries(request.plan)) {
        const part = Number(rawPart);
        await this.checkpoint(jobId, 'GENERATING_TEXT', part, {
          completedGroups: 0,
          totalGroups: plan.length,
          stage: 'GENERATING_TEXT',
        });
        for (let offset = 0; offset < plan.length; offset += 3) {
          const slice = plan.slice(offset, offset + 3);
          const candidate = await this.ai.generateToeicExamBatch({
            part,
            topic: request.topic,
            difficulty: request.difficulty,
            groups: slice,
          });
          this.assertBatch(part, slice, candidate);
          await this.writeBatch(
            lrExamSet!.id,
            part,
            groupOrder,
            questionNumber,
            candidate,
          );
          groupOrder += slice.length;
          questionNumber += slice.reduce(
            (total, item) => total + item.questionCount,
            0,
          );
          await this.checkpoint(jobId, 'GENERATING_TEXT', part, {
            completedGroups: Math.min(offset + slice.length, plan.length),
            totalGroups: plan.length,
            stage: 'GENERATING_TEXT',
          });
        }
      }
      await this.checkpoint(jobId, 'VALIDATING_TEXT');
      let validation: any = { learnerReady: true, issues: [] };
      if (exam.toeicExamSet) {
        await this.materializeMedia(jobId, exam.toeicExamSet.id);
        const complete = await this.prisma.toeicExamSet.findUniqueOrThrow({
          where: { id: exam.toeicExamSet.id },
          include: {
            groups: {
              include: { questions: true },
              orderBy: { groupOrder: 'asc' },
            },
          },
        });
        validation = validateToeicExam(complete);
        if (!validation.learnerReady)
          throw new BadRequestException(
            validation.issues
              .map((issue: { message: string }) => issue.message)
              .join('; '),
          );
      }
      await this.materializeSpeakingWriting(jobId, exam, request);
      const currentJob = await this.prisma.aiGenerationJob.findUniqueOrThrow({
        where: { id: jobId },
        select: { resultSnapshot: true },
      });
      await this.prisma.aiGenerationJob.update({
        where: { id: jobId },
        data: {
          status: AiGenerationJobStatus.GENERATED,
          completedAt: new Date(),
          resultSnapshot: {
            ...((currentJob.resultSnapshot as object) ?? {}),
            stage: 'READY_FOR_REVIEW',
            validation,
          },
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.aiGenerationJob.update({
        where: { id: jobId },
        data: {
          status: AiGenerationJobStatus.FAILED,
          completedAt: new Date(),
          errorSummary: message.slice(0, 1000),
          failureHistory: [
            { at: new Date().toISOString(), message: message.slice(0, 1000) },
          ] as Prisma.InputJsonValue,
        },
      });
      throw error;
    }
  }
}

export { PRACTICE_DISCLAIMER };
