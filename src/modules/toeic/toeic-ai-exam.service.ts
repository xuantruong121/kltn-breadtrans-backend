import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
  ServiceUnavailableException,
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
import { DelayedError, Job, Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import type { ToeicExamBatchRequest } from '../ai/strategies/ai-evaluator.interface';
import { R2Service } from '../upload/r2.service';
import { GenericExamService } from './generic-exam.service';
import { CreateToeicAiExamDto } from './toeic-ai-exam.dto';
import { validateToeicExam } from './toeic.validation';
import {
  mediaRetryMessage,
  toeicMediaHash,
  withMediaFailure,
  withoutMediaFailure,
} from './toeic-media';
import {
  buildToeicListeningAudioScript,
  TOEIC_LISTENING_AUDIO_SCRIPT_VERSION,
  toeicListeningAudioFingerprint,
} from './toeic-listening-audio';
import { TOEIC_SPEAKING_TASK_SEQUENCE } from '../speaking/toeic-speaking-contract';
import { TOEIC_WRITING_SLOT_CONTRACT } from '../writing/toeic-writing-set.contract';
import { ImageSearchCandidate } from './pixabay-image-search.provider';
import { ImageSearchProviderChain } from './image-search.provider-chain';
import { bestImageCandidate, imageSearchQueries } from './exam-image-query';
import {
  explanationNamesPosition,
  isVietnameseExplanation,
  prepareGeneratedBatch,
  questionFingerprint,
  plannedGroupIssue,
  questionContentIssue,
  languageIssue,
  type PlannedTraits,
  questionsToAvoid,
  readingGroupIssue,
  shuffleOptions,
} from './toeic-ai-batch.logic';
import { DEFAULT_GEMINI_TEXT_MODEL } from '../ai/gemini/gemini-model-router';
import type {
  ToeicPart1CandidateAnalysis,
  ToeicPart1QuestionCandidate,
} from '../ai/strategies/ai-evaluator.interface';
import { listeningScriptLengthIssue } from './toeic-listening-length';
import { isAiOutage } from '../ai/cloudflare-workers-ai.client';
import { exhaustedUntil } from '../ai/review/provider-exhaustion';
import { quotaWaitResumeAt } from './ai-job-quota-wait.logic';
import { NotificationsService } from '../notifications/notifications.service';
import { PRACTICE_DISCLAIMER } from './exam-template.registry';
import { AnswerReviewService } from '../ai/review/answer-review.service';
import {
  ReviewerUnavailableError,
  isReviewerUnavailable,
} from '../ai/review/answer-reviewer';
import {
  explanationPrompt,
  part1VisionPrompt,
  solvePrompt,
} from '../ai/toeic-answer-review-prompt';
import {
  canApply,
  canonicalGroupHash,
  combinedVerdict,
  confirmReview,
  confirmationRefusal,
  diffGroup,
  emptyReview,
  explanationRequestOf,
  groupStimulus,
  invalidateReview,
  judgeExplanation,
  judgePart1Vision,
  judgeSolve,
  optionCountOf,
  part1DraftHash,
  pendingStep,
  reviewItemId,
  reviewRejection,
  settleStatus,
  solveRequestOf,
  validateExplanationOutput,
  validatePart1VisionOutput,
  validateSolveOutput,
  type ApplyDecision,
} from './toeic-answer-review.logic';
import type {
  ConfirmationMethod,
  GroupReview,
  QuestionReview,
  QuestionVerdict,
} from './toeic-answer-review.types';

const TOEIC_AI_QUEUE = 'breadtrans-toeic-ai-exam';
/** Tries per batch: the first draft plus these, each told why it was refused. */
const BATCH_RETRIES = 2;
const ADMIN_SELECT_IMAGE_TIMEOUT_MS = 20_000;
const ADMIN_SELECT_R2_TIMEOUT_MS = 30_000;
const ADMIN_SELECT_VISION_TIMEOUT_MS = 45_000;

type PlannedGroup = PlannedTraits & {
  questionCount: number;
  kind?: 'SINGLE' | 'MULTIPLE';
};
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

type FailedLrBatch = {
  batchKey: string;
  part: number;
  offset: number;
  groupOrder: number;
  questionNumber: number;
  groups: PlannedGroup[];
  /** ANSWER_REVIEW_FAILED keeps the last refused batch for the admin to fix. */
  code: 'CONTENT_CONTRACT_FAILURE' | 'ANSWER_REVIEW_FAILED';
  message: string;
  attempts: number;
};

type StoredLrBatch = {
  batchKey?: string;
  part: number;
  groupOrder: number;
  questionNumber: number;
  candidate: any;
};

const isLrKey = (key: string) => /^LR:P\d+:G\d+$/.test(key);

type ToeicAiDraftSnapshot = {
  version: 1;
  partial: boolean;
  lrBatches: Array<{
    batchKey?: string;
    part: number;
    groupOrder: number;
    questionNumber: number;
    candidate: any;
  }>;
  failedUnits?: FailedLrBatch[];
  speakingWriting?: any;
};

const sha256 = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');

const MAX_IMAGE_PREVIEWS = 3;

/** The prompt printed for Parts whose AI items carry no question of their own. */
function fixedPromptOfPart(part: number) {
  if (part === 1)
    return 'Choose the sentence that best describes the photograph.';
  if (part === 2) return 'Choose the best response.';
  return null;
}

/** Every path that writes a Part 1 item from a photo shares this shape. */
function part1QuestionData(vision: {
  statements: string[];
  correctIndex: number;
  explanation: string;
}) {
  const shuffled = shuffleOptions({
    options: vision.statements,
    correctIndex: vision.correctIndex,
    explanation: vision.explanation,
  });
  return {
    text: fixedPromptOfPart(1),
    options: shuffled.options,
    correctIndex: shuffled.correctIndex,
    explanation: shuffled.explanation,
  };
}

function firstQuestionOfPart(part: number) {
  let number = 1;
  for (let earlier = 1; earlier < part; earlier += 1)
    for (const group of planFor(earlier)) number += group.questionCount;
  return number;
}

function firstGroupOfPart(part: number) {
  let order = 1;
  for (let earlier = 1; earlier < part; earlier += 1)
    order += planFor(earlier).length;
  return order;
}

function planFor(part: number): PlannedGroup[] {
  switch (part) {
    case 1:
      return Array.from({ length: 6 }, () => ({ questionCount: 1 }));
    case 2:
      return Array.from({ length: 25 }, () => ({ questionCount: 1 }));
    case 3:
      // Two conversations have three speakers; the last three have a graphic.
      return Array.from({ length: 13 }, (_, index) => ({
        questionCount: 3,
        ...(index === 2 || index === 7 ? { threeSpeakers: true } : {}),
        ...(index >= 10 ? { graphic: true } : {}),
      }));
    case 4:
      // The last two talks have a graphic.
      return Array.from({ length: 10 }, (_, index) => ({
        questionCount: 3,
        ...(index >= 8 ? { graphic: true } : {}),
      }));
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
        // Two double and three triple passages.
        ...Array.from({ length: 5 }, (_, index): PlannedGroup => ({
          questionCount: 5,
          kind: 'MULTIPLE' as const,
          documents: index < 2 ? 2 : 3,
        })),
      ];
    default:
      throw new BadRequestException('Part TOEIC không hợp lệ');
  }
}

/** A batch key is "part:offset"; the plan keeps the traits of each group. */
function plannedGroupOf(
  request: RequestSnapshot,
  batch: { part: number | string; batchKey?: string },
  index: number,
  questionCount: number,
): PlannedGroup {
  const offset = Number(String(batch.batchKey ?? '').split(':')[1]);
  const planned = request.plan?.[Number(batch.part)]?.[offset + index];
  return planned?.questionCount === questionCount ? planned : { questionCount };
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
  private readonly imageCandidates = new Map<
    string,
    { candidate: ImageSearchCandidate; expiresAt: number; query: string }
  >();

  private async runBoundedStage<T>(
    requestId: string,
    stage: string,
    timeoutMs: number,
    operation: () => Promise<T>,
  ): Promise<T> {
    const startedAt = Date.now();
    this.logger.log(
      `toeic_admin_select_stage_started requestId=${requestId} stage=${stage}`,
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`${stage} timed out after ${timeoutMs}ms`);
        (error as Error & { code?: string }).code =
          `${stage.toUpperCase()}_TIMEOUT`;
        reject(error);
      }, timeoutMs);
    });
    try {
      const result = await Promise.race([
        Promise.resolve().then(operation),
        timeout,
      ]);
      this.logger.log(
        `toeic_admin_select_stage_completed requestId=${requestId} stage=${stage} elapsedMs=${Date.now() - startedAt}`,
      );
      return result;
    } catch (error) {
      this.logger.warn(
        `toeic_admin_select_stage_failed requestId=${requestId} stage=${stage} elapsedMs=${Date.now() - startedAt} code=${(error as { code?: string })?.code ?? 'ERROR'}`,
      );
      if (
        (error as { code?: string })?.code === `${stage.toUpperCase()}_TIMEOUT`
      ) {
        throw new ServiceUnavailableException(
          `Bước ${stage} quá thời gian xử lý. Vui lòng thử lại sau.`,
        );
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly genericExam: GenericExamService,
    private readonly ai: AiService,
    private readonly r2: R2Service,
    private readonly imageSearch: ImageSearchProviderChain,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly answerReview?: AnswerReviewService,
  ) {}

  onModuleInit() {
    this.worker = new Worker<JobPayload, unknown, 'generate'>(
      TOEIC_AI_QUEUE,
      async (job, token) => this.process(job, token),
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
    const title = await this.genericExam.nextExamTitle(dto.variantCode);
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
          model: process.env.GEMINI_MODEL_NAME || DEFAULT_GEMINI_TEXT_MODEL,
          generatorVersion: 'toeic-ai-exam-v1',
          promptVersion: 'toeic-practice-original-v2',
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

  private batchCoordinates(
    request: RequestSnapshot,
    targetPart: number,
    targetOffset: number,
  ) {
    let groupOrder = 1;
    let questionNumber = 1;
    for (const [rawPart, plan] of Object.entries(request.plan)) {
      const part = Number(rawPart);
      for (let offset = 0; offset < plan.length; offset += 3) {
        const groups = plan.slice(offset, offset + 3);
        if (part === targetPart && offset === targetOffset) {
          return { groupOrder, questionNumber, groups };
        }
        groupOrder += groups.length;
        questionNumber += groups.reduce(
          (total, group) => total + group.questionCount,
          0,
        );
      }
    }
    throw new BadRequestException('Không tìm thấy batch TOEIC cần tạo lại');
  }

  private failedBatch(
    request: RequestSnapshot,
    part: number,
    offset: number,
    message: string,
    previous?: FailedLrBatch,
    code: FailedLrBatch['code'] = 'CONTENT_CONTRACT_FAILURE',
  ): FailedLrBatch {
    const coordinates = this.batchCoordinates(request, part, offset);
    return {
      batchKey: `${part}:${offset}`,
      part,
      offset,
      groupOrder: coordinates.groupOrder,
      questionNumber: coordinates.questionNumber,
      groups: coordinates.groups,
      code,
      message: message.slice(0, 1000),
      attempts: (previous?.attempts ?? 0) + 1,
    };
  }

  /**
   * Phase E — Candidate Workspace content for human review BEFORE Apply.
   * Returns actual generated question/task content (not just counts), each
   * item flagged by deterministic checks only (no AI confidence, no extra
   * provider call). Read-only — never mutates draftSnapshot or Draft.
   */
  async getCandidate(jobId: string, adminId: number) {
    const job = await this.prisma.aiGenerationJob.findUnique({
      where: { id: jobId },
    });
    if (!job || job.createdByAdminId !== adminId)
      throw new NotFoundException('Không tìm thấy candidate tạo đề TOEIC AI');
    const candidate = (job.draftSnapshot as any) ?? null;
    if (!candidate)
      return {
        lrGroups: [],
        speaking: [],
        writing: [],
        failedUnits: [],
        flaggedCount: 0,
        appliedCandidateKeys: [],
      };
    const appliedCandidateKeys: string[] = Array.isArray(
      (job.approvedSnapshot as any)?.appliedCandidateKeys,
    )
      ? (job.approvedSnapshot as any).appliedCandidateKeys
      : [];

    const failedUnits: FailedLrBatch[] = Array.isArray(candidate.failedUnits)
      ? candidate.failedUnits
      : [];
    const request = job.requestSnapshot as unknown as RequestSnapshot;
    let flaggedCount = failedUnits.length;
    const lrGroups = (
      Array.isArray(candidate.lrBatches) ? candidate.lrBatches : []
    ).flatMap((batch: any) => {
      let questionNumber = batch.questionNumber;
      return (batch.candidate?.groups ?? []).map(
        (group: any, index: number) => {
          const expectedOptions = batch.part === 2 ? 3 : 4;
          const questions = (group.questions ?? []).map((question: any) => {
            const options = Array.isArray(question.options)
              ? question.options.map((option: unknown) => String(option).trim())
              : [];
            const issues: string[] = [];
            if (
              options.length !== expectedOptions ||
              options.some((o: string) => !o)
            )
              issues.push('Thiếu đáp án lựa chọn');
            if (
              new Set(options.map((o: string) => o.toLowerCase())).size !==
              options.length
            )
              issues.push('Có đáp án trùng lặp');
            if (
              !Number.isInteger(question.correctIndex) ||
              question.correctIndex < 0 ||
              question.correctIndex >= options.length
            )
              issues.push('Chưa có đáp án đúng hợp lệ');
            if (!question.explanation?.trim())
              issues.push('Chưa có giải thích đáp án');
            if (issues.length) flaggedCount += 1;
            return {
              questionNumber: questionNumber++,
              text: question.text ?? null,
              options,
              correctIndex: question.correctIndex,
              explanation: question.explanation ?? null,
              issues,
            };
          });
          const groupIssues: string[] = [];
          if (batch.part >= 2 && batch.part <= 4 && !group.transcript?.trim())
            groupIssues.push('Chưa có lời thoại');
          if (
            (batch.part === 6 || batch.part === 7) &&
            !group.passageText?.trim()
          )
            groupIssues.push('Chưa có đoạn văn');
          if (batch.part === 1 && !group.imageBrief?.trim())
            groupIssues.push('Chưa có mô tả hình ảnh');
          if (groupIssues.length) flaggedCount += 1;
          const groupOrder = batch.groupOrder + index;
          const decision = this.lrApplyDecision(request, batch, index, group);
          return {
            candidateKey: `LR:P${batch.part}:G${groupOrder}`,
            part: batch.part,
            groupOrder,
            standIn: group.provider === 'CLOUDFLARE',
            transcript: group.transcript ?? null,
            passageText: group.passageText ?? null,
            imageBrief: group.imageBrief ?? null,
            issues: groupIssues,
            questions,
            // Part 1 is reviewed on the Draft, once its photo exists.
            reviewStatus:
              batch.part === 1
                ? null
                : ((group.review as GroupReview | undefined)?.status ??
                  'UNREVIEWED'),
            review: group.review ?? null,
            contentHash: decision.currentHash,
            applyDecision: { ok: decision.ok, reason: decision.reason },
          };
        },
      );
    });

    const speaking = (candidate.speakingWriting?.speaking ?? []).map(
      (task: any, index: number) => {
        const issues: string[] = [];
        if (!task.title?.trim()) issues.push('Chưa có tiêu đề');
        if (!task.targetText?.trim())
          issues.push('Chưa có nội dung tình huống');
        if (issues.length) flaggedCount += 1;
        return {
          candidateKey: `SPEAKING:TASK${index + 1}`,
          taskNumber: index + 1,
          title: task.title ?? null,
          targetText: task.targetText ?? null,
          issues,
          applied: appliedCandidateKeys.includes('SPEAKING'),
        };
      },
    );
    const writing = (candidate.speakingWriting?.writing ?? []).map(
      (task: any, index: number) => {
        const issues: string[] = [];
        if (!task.prompt?.trim()) issues.push('Chưa có đề bài');
        if (task.taskKind === 'PICTURE_SENTENCE' && !task.imageBrief?.trim())
          issues.push('Chưa có mô tả hình ảnh');
        if (task.taskKind === 'WRITTEN_REQUEST' && !task.email?.trim())
          issues.push('Chưa có e-mail cần trả lời');
        if (issues.length) flaggedCount += 1;
        return {
          candidateKey: `WRITING:TASK${index + 1}`,
          taskNumber: index + 1,
          title: task.title ?? null,
          prompt: task.prompt ?? null,
          email: task.email ?? null,
          issues,
          applied: appliedCandidateKeys.includes('WRITING'),
        };
      },
    );

    const lrGroupsWithApplied = lrGroups.map((g: any) => ({
      ...g,
      applied: appliedCandidateKeys.includes(g.candidateKey),
    }));

    return {
      lrGroups: lrGroupsWithApplied,
      speaking,
      writing,
      standIn: candidate.speakingWriting?.provider === 'CLOUDFLARE',
      failedUnits: failedUnits.map((unit) => ({
        batchKey: unit.batchKey,
        part: unit.part,
        offset: unit.offset,
        groupOrder: unit.groupOrder,
        code: unit.code,
        message: unit.message,
        attempts: unit.attempts,
      })),
      flaggedCount,
      appliedCandidateKeys,
    };
  }

  /**
   * Phase E — edit candidate content BEFORE Apply. Persists only into the
   * job's draftSnapshot JSON; never touches real Exam/ToeicQuestionGroup
   * tables (EXAM_AI_CANDIDATE_EDIT_MUTATES_DRAFT=false).
   */
  async updateCandidate(
    jobId: string,
    adminId: number,
    candidateKey: string,
    patch: Record<string, unknown>,
  ) {
    const job = await this.prisma.aiGenerationJob.findUnique({
      where: { id: jobId },
    });
    if (!job || job.createdByAdminId !== adminId)
      throw new NotFoundException('Không tìm thấy candidate tạo đề TOEIC AI');
    const candidate = (job.draftSnapshot as any) ?? null;
    if (!candidate)
      throw new ConflictException('Candidate AI chưa sẵn sàng để chỉnh sửa');

    const lrMatch = /^LR:P(\d+):G(\d+)$/.exec(candidateKey);
    const taskMatch = /^(SPEAKING|WRITING):TASK(\d+)$/.exec(candidateKey);

    if (lrMatch) {
      const part = Number(lrMatch[1]);
      const groupOrder = Number(lrMatch[2]);
      const lrBatches = Array.isArray(candidate.lrBatches)
        ? candidate.lrBatches
        : [];
      let found = false;
      for (const batch of lrBatches) {
        if (Number(batch.part) !== part) continue;
        const groups = batch.candidate?.groups ?? [];
        let questionNumberStart = Number(batch.questionNumber);
        for (let index = 0; index < groups.length; index += 1) {
          const group = groups[index];
          if (Number(batch.groupOrder) + index !== groupOrder) {
            questionNumberStart += group.questions?.length ?? 0;
            continue;
          }
          found = true;
          const before = JSON.parse(
            JSON.stringify({
              transcript: group.transcript,
              passageText: group.passageText,
              imageBrief: group.imageBrief,
              questions: group.questions,
            }),
          );
          if (typeof patch.transcript === 'string')
            group.transcript = patch.transcript;
          if (typeof patch.passageText === 'string')
            group.passageText = patch.passageText;
          if (typeof patch.imageBrief === 'string')
            group.imageBrief = patch.imageBrief;
          if (Array.isArray(patch.questions)) {
            for (const qPatch of patch.questions) {
              const question = (group.questions ?? []).find(
                (q: any, qi: number) =>
                  qi === qPatch.questionIndex ||
                  questionNumberStart + qi === qPatch.questionNumber,
              );
              if (!question) continue;
              if (typeof qPatch.text === 'string') question.text = qPatch.text;
              if (Array.isArray(qPatch.options))
                question.options = qPatch.options.map((o: unknown) =>
                  String(o),
                );
              if (Number.isInteger(qPatch.correctIndex))
                question.correctIndex = qPatch.correctIndex;
              if (typeof qPatch.explanation === 'string')
                question.explanation = qPatch.explanation;
            }
          }
          this.recordCandidateEdit(part, group, before, adminId);
        }
      }
      if (!found)
        throw new NotFoundException('Không tìm thấy candidate item này');
      this.resolveReviewFailures(candidate);
    } else if (taskMatch) {
      const skill = taskMatch[1];
      const taskIndex = Number(taskMatch[2]) - 1;
      const list =
        skill === 'SPEAKING'
          ? candidate.speakingWriting?.speaking
          : candidate.speakingWriting?.writing;
      const task = Array.isArray(list) ? list[taskIndex] : undefined;
      if (!task)
        throw new NotFoundException('Không tìm thấy candidate item này');
      if (typeof patch.title === 'string') task.title = patch.title;
      if (typeof patch.targetText === 'string')
        task.targetText = patch.targetText;
      if (typeof patch.prompt === 'string') task.prompt = patch.prompt;
      if (typeof patch.email === 'string') task.email = patch.email;
      if (typeof patch.imageBrief === 'string')
        task.imageBrief = patch.imageBrief;
    } else {
      throw new NotFoundException('candidateKey không hợp lệ');
    }

    await this.prisma.aiGenerationJob.update({
      where: { id: jobId },
      data: { draftSnapshot: candidate as Prisma.InputJsonValue },
    });
    return this.getCandidate(jobId, adminId);
  }

  /**
   * Targeted "Tạo lại nhóm" — regenerates ONE L&R group's candidate content
   * BEFORE Apply, reusing the same bounded AI batch call Phase D already
   * uses. Never touches real Draft tables; never regenerates a key that has
   * already been applied (that content belongs to "Tạo phiên bản mới"
   * territory, not a silent candidate swap under an applied item).
   */
  async regenerateCandidateGroup(
    jobId: string,
    adminId: number,
    candidateKey: string,
  ) {
    const job = await this.prisma.aiGenerationJob.findUnique({
      where: { id: jobId },
    });
    if (!job || job.createdByAdminId !== adminId)
      throw new NotFoundException('Không tìm thấy candidate tạo đề TOEIC AI');
    const candidate = (job.draftSnapshot as any) ?? null;
    if (!candidate)
      throw new ConflictException('Candidate AI chưa sẵn sàng để tạo lại');
    const appliedCandidateKeys: string[] = Array.isArray(
      (job.approvedSnapshot as any)?.appliedCandidateKeys,
    )
      ? (job.approvedSnapshot as any).appliedCandidateKeys
      : [];
    if (appliedCandidateKeys.includes(candidateKey))
      throw new ConflictException(
        'Nội dung này đã được Apply vào Draft; không thể tạo lại candidate. Dùng "Tạo phiên bản mới" để thay đổi nội dung đã xuất bản/áp dụng.',
      );
    const lrMatch = /^LR:P(\d+):G(\d+)$/.exec(candidateKey);
    if (!lrMatch)
      throw new NotFoundException(
        'Chỉ có thể tạo lại theo nhóm cho nội dung Listening/Reading',
      );
    const part = Number(lrMatch[1]);
    const groupOrder = Number(lrMatch[2]);
    const request = job.requestSnapshot as unknown as RequestSnapshot;

    const lrBatches = Array.isArray(candidate.lrBatches)
      ? candidate.lrBatches
      : [];
    let found = false;
    for (const batch of lrBatches) {
      if (Number(batch.part) !== part) continue;
      const groups = batch.candidate?.groups ?? [];
      let firstQuestionNumber = Number(batch.questionNumber);
      for (let index = 0; index < groups.length; index += 1) {
        const questionCount = groups[index].questions?.length ?? 1;
        if (Number(batch.groupOrder) + index === groupOrder) {
          found = true;
          const planned = plannedGroupOf(request, batch, index, questionCount);
          const regenerated = await this.draftBatch(
            {
              part,
              topic: request.topic,
              difficulty: request.difficulty,
              groups: [planned],
              avoidQuestions: questionsToAvoid(lrBatches, part),
            },
            firstQuestionNumber,
          );
          this.assertBatch(part, [planned], regenerated);
          await this.reviewRegenerated(part, firstQuestionNumber, regenerated);
          groups[index] = regenerated.groups[0];
        }
        firstQuestionNumber += questionCount;
      }
    }
    if (!found)
      throw new NotFoundException('Không tìm thấy candidate item này');
    this.assertNoDuplicateBatches(lrBatches);
    this.resolveReviewFailures(candidate);

    await this.prisma.aiGenerationJob.update({
      where: { id: jobId },
      data: { draftSnapshot: candidate as Prisma.InputJsonValue },
    });
    return this.getCandidate(jobId, adminId);
  }

  /**
   * Targeted "Tạo lại Part" — regenerates every NOT-YET-APPLIED L&R group of
   * one Part. Already-applied groups in the same Part are left untouched.
   * Bounded to this Part's groups only — never re-runs the whole Exam.
   */
  async regenerateCandidatePart(jobId: string, adminId: number, part: number) {
    const job = await this.prisma.aiGenerationJob.findUnique({
      where: { id: jobId },
    });
    if (!job || job.createdByAdminId !== adminId)
      throw new NotFoundException('Không tìm thấy candidate tạo đề TOEIC AI');
    const candidate = (job.draftSnapshot as any) ?? null;
    if (!candidate)
      throw new ConflictException('Candidate AI chưa sẵn sàng để tạo lại');
    const appliedCandidateKeys: string[] = Array.isArray(
      (job.approvedSnapshot as any)?.appliedCandidateKeys,
    )
      ? (job.approvedSnapshot as any).appliedCandidateKeys
      : [];
    const request = job.requestSnapshot as unknown as RequestSnapshot;
    const lrBatches = Array.isArray(candidate.lrBatches)
      ? candidate.lrBatches
      : [];
    for (const batch of lrBatches) {
      if (Number(batch.part) !== part) continue;
      const groups = batch.candidate?.groups ?? [];
      let firstQuestionNumber = Number(batch.questionNumber);
      for (let index = 0; index < groups.length; index += 1) {
        const groupOrder = Number(batch.groupOrder) + index;
        const candidateKey = `LR:P${part}:G${groupOrder}`;
        const questionCount = groups[index].questions?.length ?? 1;
        const first = firstQuestionNumber;
        firstQuestionNumber += questionCount;
        if (appliedCandidateKeys.includes(candidateKey)) continue;
        const planned = plannedGroupOf(request, batch, index, questionCount);
        const regenerated = await this.draftBatch(
          {
            part,
            topic: request.topic,
            difficulty: request.difficulty,
            groups: [planned],
            avoidQuestions: questionsToAvoid(lrBatches, part),
          },
          first,
        );
        this.assertBatch(part, [planned], regenerated);
        await this.reviewRegenerated(part, first, regenerated);
        groups[index] = regenerated.groups[0];
      }
    }
    this.resolveReviewFailures(candidate);

    await this.prisma.aiGenerationJob.update({
      where: { id: jobId },
      data: { draftSnapshot: candidate as Prisma.InputJsonValue },
    });
    return this.getCandidate(jobId, adminId);
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
    const candidate = (job.draftSnapshot as any) ?? null;
    return {
      id: job.id,
      status: job.status,
      stage: (job.resultSnapshot as any)?.stage ?? 'QUEUED',
      // Set while the job waits for an AI quota reset (stage WAITING_QUOTA).
      resumeAt: (job.resultSnapshot as any)?.resumeAt ?? null,
      progress: (job.resultSnapshot as any)?.parts ?? {},
      error: job.errorSummary ?? undefined,
      missingMedia: (job.resultSnapshot as any)?.missingMedia ?? [],
      candidate: candidate
        ? {
            available:
              job.status === AiGenerationJobStatus.GENERATED ||
              Array.isArray(candidate.failedUnits),
            partial: candidate.partial === true,
            failedUnitCount: Array.isArray(candidate.failedUnits)
              ? candidate.failedUnits.length
              : 0,
            lrBatchCount: Array.isArray(candidate.lrBatches)
              ? candidate.lrBatches.length
              : 0,
            speakingCount: Array.isArray(candidate.speakingWriting?.speaking)
              ? candidate.speakingWriting.speaking.length
              : 0,
            writingCount: Array.isArray(candidate.speakingWriting?.writing)
              ? candidate.speakingWriting.writing.length
              : 0,
          }
        : undefined,
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
    // Waiting for an AI quota reset: "run now" resumes the delayed job from
    // its checkpoint instead of waiting for resumeAt.
    const waiting = job.resultSnapshot as Record<string, unknown> | null;
    if (waiting?.stage === 'WAITING_QUOTA') {
      await this.prisma.aiGenerationJob.update({
        where: { id: jobId },
        data: {
          errorSummary: null,
          resultSnapshot: { ...waiting, stage: 'QUEUED', resumeAt: null },
        },
      });
      const delayed = await this.queue.getJob(jobId);
      if (delayed && (await delayed.isDelayed())) await delayed.promote();
      else if (!delayed)
        await this.queue.add('generate', { version: 1, jobId }, { jobId });
      return this.status(jobId);
    }
    const request = job.requestSnapshot as RequestSnapshot;
    const existingCandidate =
      (job.draftSnapshot as ToeicAiDraftSnapshot | null) ?? null;
    const existingFailedUnits = Array.isArray(existingCandidate?.failedUnits)
      ? existingCandidate.failedUnits
      : [];
    const legacyFailedScope = (job.resultSnapshot as any)?.failedScope;
    const recoveredLegacyFailure =
      existingFailedUnits.length === 0 &&
      job.status === AiGenerationJobStatus.FAILED &&
      legacyFailedScope?.kind === 'batch' &&
      Number.isInteger(legacyFailedScope.part) &&
      Number.isInteger(legacyFailedScope.offset)
        ? this.failedBatch(
            request,
            legacyFailedScope.part,
            legacyFailedScope.offset,
            job.errorSummary || 'Batch AI chưa hoàn tất',
          )
        : null;
    const failedUnits = recoveredLegacyFailure
      ? [recoveredLegacyFailure]
      : existingFailedUnits;
    const speakingWritingFailed =
      job.status === AiGenerationJobStatus.FAILED &&
      legacyFailedScope?.kind === 'speaking-writing';
    if (!failedUnits.length && !speakingWritingFailed)
      throw new ConflictException('Chỉ job lỗi mới có thể thử lại');
    await this.prisma.aiGenerationJob.update({
      where: { id: jobId },
      data: {
        status: AiGenerationJobStatus.QUEUED,
        errorSummary: null,
        completedAt: null,
        draftSnapshot: {
          version: 1,
          partial: true,
          lrBatches: existingCandidate?.lrBatches ?? [],
          failedUnits,
          speakingWriting: existingCandidate?.speakingWriting ?? null,
        },
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

  async apply(
    jobId: string,
    adminId: number,
    selectedCandidateKeys?: string[],
  ) {
    const job = await this.prisma.aiGenerationJob.findUnique({
      where: { id: jobId },
    });
    if (!job || job.createdByAdminId !== adminId)
      throw new NotFoundException('Không tìm thấy candidate tạo đề TOEIC AI');
    if (job.status !== AiGenerationJobStatus.GENERATED)
      throw new ConflictException('Chỉ candidate đã hoàn tất mới có thể Apply');
    const candidate = (job.draftSnapshot as any) ?? null;
    if (!candidate || candidate.version !== 1)
      throw new ConflictException('Candidate AI không còn hợp lệ để Apply');
    const exam = await this.prisma.exam.findUnique({
      where: { aiGenerationJobId: jobId },
      include: {
        toeicExamSet: true,
        toeicAssessment: { include: { components: true } },
      },
    });
    if (!exam)
      throw new NotFoundException('Không tìm thấy Draft đích của job AI');
    if (exam.publicationStatus !== QuizPublicationStatus.DRAFT)
      throw new ConflictException('Chỉ có thể Apply candidate vào Draft');
    // Defence in depth: even if an Exam somehow sits in DRAFT with existing
    // learner attempts (e.g. a legacy/bugged unpublish), AI Apply must never
    // rewrite historically-attempted content.
    if (await this.genericExam.hasLearnerAttempts(exam as any))
      throw new ConflictException(
        'Đề đã có lịch sử làm bài; không thể Apply candidate AI đè lên nội dung lịch sử. Hãy dùng "Tạo phiên bản mới".',
      );

    const previouslyApplied: string[] = Array.isArray(
      (job.approvedSnapshot as any)?.appliedCandidateKeys,
    )
      ? (job.approvedSnapshot as any).appliedCandidateKeys
      : [];
    const availableKeys = this.availableCandidateKeys(candidate);
    const isSelective = Array.isArray(selectedCandidateKeys);
    // Keys actually eligible to be (re)written this call: requested, known
    // to exist in the candidate, and not already applied (idempotent no-op
    // on repeat — re-applying an applied key must never duplicate content).
    const requested = isSelective
      ? selectedCandidateKeys.filter(
          (k) => availableKeys.includes(k) && !previouslyApplied.includes(k),
        )
      : // Full apply-all (no selection given) always rewrites everything —
        // deleteMany below wipes the whole L&R set, so every available key
        // must be rewritten, not just the ones never applied before.
        availableKeys;

    // Answer review gate: hash and structure come from the current content.
    const request = job.requestSnapshot as unknown as RequestSnapshot;
    const decisions = new Map<string, ApplyDecision>();
    for (const batch of (candidate.lrBatches ?? []) as StoredLrBatch[])
      (batch.candidate?.groups ?? []).forEach((group: any, index: number) =>
        decisions.set(
          `LR:P${batch.part}:G${Number(batch.groupOrder) + index}`,
          this.lrApplyDecision(request, batch, index, group),
        ),
      );
    const skipped = requested
      .filter((key) => isLrKey(key) && !decisions.get(key)?.ok)
      .map((key) => ({
        candidateKey: key,
        reason: decisions.get(key)?.reason ?? 'UNREVIEWED',
      }));
    const toApply = requested.filter(
      (key) => !isLrKey(key) || decisions.get(key)?.ok,
    );

    const lrGroups = this.flattenLrCandidateGroups(candidate);
    // Apply-all replaces the L&R set only when it has groups to write: a run
    // whose groups were all held back must not wipe the Draft.
    const wipesLr = !isSelective && toApply.some(isLrKey);
    if (exam.toeicExamSet && (isSelective ? toApply.length : wipesLr)) {
      const groupsToWrite = lrGroups.filter((g) =>
        toApply.includes(g.candidateKey),
      );
      await this.prisma.$transaction(async (tx) => {
        if (!isSelective) {
          // Full apply-all (default, backward-compatible): replace the
          // entire L&R content set in one shot, as before.
          await tx.toeicQuestionGroup.deleteMany({
            where: { examId: exam.toeicExamSet!.id },
          });
        }
        for (const g of groupsToWrite) {
          await this.writeGroup(
            tx,
            exam.toeicExamSet!.id,
            g.part,
            g.groupOrder,
            g.questionNumberStart,
            g.group,
          );
        }
      });
      await this.materializeMedia(jobId, exam.toeicExamSet.id);
    }
    if (
      candidate.speakingWriting &&
      (toApply.includes('SPEAKING') || toApply.includes('WRITING'))
    ) {
      await this.materializeSpeakingWriting(
        jobId,
        exam,
        job.requestSnapshot as RequestSnapshot,
        candidate.speakingWriting,
      );
    }

    let validation: any = { learnerReady: true, issues: [] };
    if (exam.toeicExamSet) {
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
    }
    // Apply-all wiped the whole L&R set, so only what it wrote is applied.
    const appliedCandidateKeys = Array.from(
      new Set([
        ...(wipesLr
          ? previouslyApplied.filter((key) => !isLrKey(key))
          : previouslyApplied),
        ...toApply,
      ]),
    );
    const fullyApplied =
      availableKeys.every((k) => appliedCandidateKeys.includes(k)) &&
      !skipped.length &&
      !(candidate.failedUnits ?? []).length;
    const snapshot = (job.resultSnapshot as any) ?? {};
    const missingMedia = await this.genericExam.missingImages(exam.id);
    await this.prisma.aiGenerationJob.update({
      where: { id: jobId },
      data: {
        status: fullyApplied
          ? AiGenerationJobStatus.APPROVED
          : AiGenerationJobStatus.GENERATED,
        reviewedByAdminId: adminId,
        reviewedAt: new Date(),
        approvedSnapshot: {
          appliedAt: new Date().toISOString(),
          appliedCandidateKeys,
        },
        resultSnapshot: {
          ...snapshot,
          stage: fullyApplied ? 'APPLIED_TO_DRAFT' : 'PARTIALLY_APPLIED',
          validation,
          missingMedia,
          skipped,
        } as Prisma.InputJsonValue,
      },
    });
    if (missingMedia.length)
      await this.notifications
        ?.createNotification({
          userId: adminId,
          type: 'ADMIN_EXAM_MEDIA',
          title: `${exam.title}: còn thiếu ${missingMedia.length} ảnh`,
          body: 'Không tìm được ảnh phù hợp nên câu hỏi vẫn được giữ. Hãy tìm hoặc tải ảnh lên trước khi xuất bản.',
          url: `/admin/exams?exam=${exam.id}`,
        })
        .catch(() => undefined);
    return { ...(await this.status(jobId)), skipped };
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
    const candidate = await this.draftBatch(
      {
        part: group.part,
        topic,
        difficulty: exam.toeicExamSet!.difficulty as 'easy' | 'medium' | 'hard',
        groups: [{ questionCount: 1 }],
      },
      group.questions[0].questionNumber,
    );
    this.assertBatch(group.part, [{ questionCount: 1 }], candidate);
    await this.reviewRegenerated(
      group.part,
      group.questions[0].questionNumber,
      candidate,
    );
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
    const plan: PlannedGroup[] = [
      plannedGroupOf(
        {
          plan: { [group.part]: planFor(group.part) },
        } as unknown as RequestSnapshot,
        {
          part: group.part,
          batchKey: `${group.part}:${group.groupOrder - firstGroupOfPart(group.part)}`,
        },
        0,
        group.questions.length,
      ),
    ];
    const candidate = await this.draftBatch(
      {
        part: group.part,
        topic,
        difficulty: exam.toeicExamSet!.difficulty as 'easy' | 'medium' | 'hard',
        groups: plan,
      },
      Math.min(...group.questions.map((question) => question.questionNumber)),
    );
    this.assertBatch(group.part, plan, candidate);
    await this.reviewRegenerated(
      group.part,
      Math.min(...group.questions.map((question) => question.questionNumber)),
      candidate,
    );
    return { mode: 'CANDIDATE_ONLY', groupId, candidate: candidate.groups[0] };
  }

  async regeneratePartCandidate(examId: number, part: number, topic?: string) {
    const exam = await this.editableDraft(examId);
    const plan = planFor(part);
    const batches: unknown[] = [];
    let firstQuestionNumber = firstQuestionOfPart(part);
    for (let offset = 0; offset < plan.length; offset += 3) {
      const slice = plan.slice(offset, offset + 3);
      const candidate = await this.draftBatch(
        {
          part,
          topic,
          difficulty: exam.toeicExamSet!.difficulty as
            'easy' | 'medium' | 'hard',
          groups: slice,
        },
        firstQuestionNumber,
      );
      this.assertBatch(part, slice, candidate);
      await this.reviewRegenerated(part, firstQuestionNumber, candidate);
      batches.push(...candidate.groups);
      firstQuestionNumber += slice.reduce(
        (total, item) => total + item.questionCount,
        0,
      );
    }
    return {
      mode: 'CANDIDATE_ONLY',
      part,
      groups: batches,
      requiresConfirmationToApply: true,
    };
  }

  /**
   * Apply leaves a slot empty when no library answered, and Speaking and
   * Writing have no per-item retry, so this fills only the empty slots.
   */
  async fillMissingImages(examId: number) {
    const exam = await this.editableDraft(examId);
    const setId = exam.toeicExamSet!.id;
    const filled: string[] = [];
    const missing: string[] = [];
    const attempt = async (slot: string, fill: () => Promise<boolean>) => {
      const done = await fill().catch((error) => {
        this.logger.warn(`Exam image still missing ${slot}: ${String(error)}`);
        return false;
      });
      (done ? filled : missing).push(slot);
    };

    const groups = await this.prisma.toeicQuestionGroup.findMany({
      where: { examId: setId, part: 1, imageUrl: null },
      orderBy: { groupOrder: 'asc' },
    });
    for (const group of groups)
      await attempt(`Part 1 nhóm ${group.groupOrder}`, async () => {
        await this.regenerateMedia(examId, group.id, 'image');
        return true;
      });

    const owner = await this.prisma.exam.findUnique({
      where: { id: examId },
      include: { toeicAssessment: { include: { components: true } } },
    });
    const job = owner?.aiGenerationJobId
      ? await this.prisma.aiGenerationJob.findUnique({
          where: { id: owner.aiGenerationJobId },
        })
      : null;
    const draft = (job?.draftSnapshot as any)?.speakingWriting;
    const components: any[] = owner?.toeicAssessment?.components ?? [];
    const speakingSetId = components.find(
      (component) => component.kind === 'SPEAKING',
    )?.speakingPracticeSetId;
    const writingSetId = components.find(
      (component) => component.kind === 'WRITING',
    )?.writingSetId;

    if (draft && speakingSetId) {
      const exercises = await this.prisma.speakingExercise.findMany({
        where: { practiceSetId: speakingSetId, imageUrl: null },
        orderBy: { order: 'asc' },
      });
      for (const exercise of exercises) {
        const brief = draft.speaking?.[(exercise.order ?? 0) - 1]?.imageBrief;
        if (!brief) continue;
        await attempt(`Speaking câu ${exercise.order}`, async () => {
          const image = await this.sourceExamImage(
            `exam-${examId}/speaking/${exercise.order}`,
            brief,
            1,
          );
          await this.prisma.speakingExercise.update({
            where: { id: exercise.id },
            data: { imageUrl: image.url },
          });
          return true;
        });
      }
    }

    if (draft && writingSetId) {
      const items = await this.prisma.toeicWritingSetItem.findMany({
        where: { writingSetId },
        include: { writingQuiz: { include: { questions: true } } },
        orderBy: { order: 'asc' },
      });
      for (const item of items) {
        const brief = draft.writing?.[item.order - 1]?.imageBrief;
        const question = item.writingQuiz.questions[0];
        const content = (question?.content ?? {}) as Record<string, unknown>;
        if (!brief || !question || content.imageUrl) continue;
        await attempt(`Writing câu ${item.order}`, async () => {
          const image = await this.sourceExamImage(
            `exam-${examId}/writing/${item.order}`,
            brief,
            1,
          );
          await this.prisma.question.update({
            where: { id: question.id },
            data: {
              content: {
                ...content,
                imageUrl: image.url,
                aiMedia: image.metadata,
              } as Prisma.InputJsonValue,
            },
          });
          return true;
        });
      }
    }
    return { filled, missing };
  }

  async regenerateMedia(
    examId: number,
    groupId: number,
    kind: 'image' | 'audio',
  ): Promise<unknown> {
    const exam = await this.editableDraft(examId);
    const group = await this.prisma.toeicQuestionGroup.findFirst({
      where: { id: groupId, examId: exam.toeicExamSet!.id },
      include: { questions: { orderBy: { questionNumber: 'asc' } } },
    });
    if (!group) throw new NotFoundException('Không tìm thấy nhóm trong Draft');
    const metadata = (group.mediaMetadata as any) ?? {};
    if (kind === 'image') {
      if (group.part !== 1 || !group.imageBrief?.trim())
        throw new BadRequestException(
          'Chỉ Part 1 có thể tạo lại ảnh từ mô tả hiện tại',
        );
      try {
        const image = await this.sourceExamImage(
          `exam-${exam.toeicExamSet!.id}/groups/${group.id}/image-regenerated`,
          group.imageBrief,
          1,
        );
        metadata.image = {
          ...image.metadata,
          status: 'READY',
          r2Key: image.key,
          generatedAt: new Date().toISOString(),
          briefHash: toeicMediaHash(group.imageBrief),
          // Kept so the new photo's review files the old one as history.
          ...(metadata.image?.review ? { review: metadata.image.review } : {}),
        };
        await this.matchPart1QuestionToImage(group, metadata, image);
        await this.reviewPart1DraftGroup(
          group,
          metadata.image,
          image,
          image.url,
        );
        const updated = await this.prisma.toeicQuestionGroup.update({
          where: { id: group.id },
          data: {
            imageUrl: image.url,
            mediaMetadata: metadata as Prisma.InputJsonValue,
          },
        });
        // Part 1 audio reads the statements, which the photo just replaced.
        return metadata.image.questionStatus === 'READY_FOR_REVIEW'
          ? await this.regenerateMedia(examId, groupId, 'audio')
          : updated;
      } catch {
        throw new BadRequestException(mediaRetryMessage('image'));
      }
    }
    if (group.part > 4)
      throw new BadRequestException(
        'Nhóm này không phải nội dung Listening để tạo lại audio',
      );
    try {
      const script = buildToeicListeningAudioScript(group);
      const sourceHash = toeicListeningAudioFingerprint(group);
      const audio = await this.makeAudio(script);
      // Exam Listening audio goes to the private bucket; the group stores the
      // key and learners hear it only through /toeic/groups/:id/audio.
      const uploaded = await this.r2.putPrivateObjectAtKey(
        `premium/listening/toeic/exams/${exam.toeicExamSet!.id}/groups/${group.id}/audio-regenerated.mp3`,
        audio,
        'audio/mpeg',
      );
      if (!(await this.r2.privateObjectExists(uploaded.key)))
        throw new BadRequestException('R2 chưa xác nhận audio tạo lại');
      metadata.audio = {
        source: 'AI_GENERATED',
        status: 'READY',
        r2Key: uploaded.key,
        generatedAt: new Date().toISOString(),
        sourceHash,
        scriptVersion: TOEIC_LISTENING_AUDIO_SCRIPT_VERSION,
      };
      return this.prisma.toeicQuestionGroup.update({
        where: { id: group.id },
        data: {
          audioUrl: uploaded.key,
          mediaMetadata: metadata as Prisma.InputJsonValue,
        },
      });
    } catch {
      throw new BadRequestException(mediaRetryMessage('audio'));
    }
  }

  async searchPart1Images(
    examId: number,
    groupId: number,
    query: string,
    limit = 5,
  ) {
    const exam = await this.editableDraft(examId);
    const group = await this.prisma.toeicQuestionGroup.findFirst({
      where: { id: groupId, examId: exam.toeicExamSet!.id },
    });
    if (!group || group.part !== 1)
      throw new NotFoundException('Không tìm thấy nhóm Part 1 trong Draft');
    const candidates = await this.imageSearch.search(
      query || group.imageBrief || 'workers meeting office',
      { limit },
    );
    const ids = candidates.map(
      (candidate) => `${candidate.provider.toLowerCase()}:${randomUUID()}`,
    );
    candidates.forEach((candidate, index) =>
      this.imageCandidates.set(ids[index], {
        candidate,
        query: query.trim(),
        expiresAt: Date.now() + 15 * 60 * 1000,
      }),
    );
    const previews = await Promise.all(
      candidates.map(async (candidate, index) => {
        try {
          const visionImage = await this.imageSearch.download(candidate);
          return {
            candidateId: ids[index],
            imageBuffer: visionImage.buffer,
            mimeType: visionImage.mimeType,
          };
        } catch (error) {
          this.logger.warn(
            `Image preview skipped provider=${candidate.provider}: ${error instanceof Error ? error.message : String(error)}`,
          );
          return null;
        }
      }),
    );
    let analyses: ToeicPart1CandidateAnalysis[] = [];
    let analysisFailure: string | undefined;
    try {
      analyses = await this.runBoundedStage(
        randomUUID(),
        'vision_analysis',
        ADMIN_SELECT_VISION_TIMEOUT_MS,
        () =>
          this.ai.analyzeToeicPart1Candidates({
            candidates: previews.filter(
              (preview): preview is NonNullable<typeof preview> =>
                Boolean(preview),
            ),
          }),
      );
    } catch (error) {
      analysisFailure = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Image candidate analysis failed: ${analysisFailure}`);
    }
    const results = candidates.map((candidate, index) => ({
      id: ids[index],
      ...candidate,
      analysis:
        analyses.find((analysis) => analysis.candidateId === ids[index]) ??
        (analysisFailure
          ? {
              candidateId: ids[index],
              status: 'ANALYSIS_FAILED' as const,
              suitable: false,
              score: 0,
              sceneSummary: '',
              visibleFacts: [],
              unsafeInferences: [],
              rejectionReasons: ['Không thể hoàn tất phân tích AI.'],
            }
          : undefined),
    }));
    return { query, provider: 'CHAIN', candidates: results };
  }

  async selectPart1Image(examId: number, groupId: number, candidateId: string) {
    const requestId = randomUUID();
    const exam = await this.editableDraft(examId);
    const group = await this.prisma.toeicQuestionGroup.findFirst({
      where: { id: groupId, examId: exam.toeicExamSet!.id },
      include: { questions: { orderBy: { questionNumber: 'asc' } } },
    });
    if (!group || group.part !== 1)
      throw new NotFoundException('Không tìm thấy nhóm Part 1 trong Draft');
    const stored = this.imageCandidates.get(candidateId);
    if (!stored || stored.expiresAt < Date.now()) {
      this.imageCandidates.delete(candidateId);
      throw new BadRequestException(
        'Ứng viên ảnh đã hết hạn. Hãy tìm lại ảnh.',
      );
    }
    let uploadedKey: string | undefined;
    const image = await this.runBoundedStage(
      requestId,
      'image_download',
      ADMIN_SELECT_IMAGE_TIMEOUT_MS,
      () => this.imageSearch.download(stored.candidate),
    );
    const imageHash = sha256(image.buffer);
    try {
      const uploaded = await this.runBoundedStage(
        requestId,
        'r2_upload',
        ADMIN_SELECT_R2_TIMEOUT_MS,
        () =>
          this.r2.putObjectAtKey(
            `ai/toeic-exams/exam-${exam.toeicExamSet!.id}/groups/${group.id}/image-${stored.candidate.provider.toLowerCase()}-${imageHash.slice(0, 16)}.${image.mimeType === 'image/png' ? 'png' : image.mimeType === 'image/webp' ? 'webp' : 'jpg'}`,
            image.buffer,
            image.mimeType,
          ),
      );
      uploadedKey = uploaded.key;
      const exists = await this.runBoundedStage(
        requestId,
        'r2_verify',
        ADMIN_SELECT_R2_TIMEOUT_MS,
        () => this.r2.objectExists(uploaded.key),
      );
      if (!exists)
        throw new BadRequestException('R2 chưa xác nhận ảnh vừa tải lên');
      const current = (group.mediaMetadata as any) ?? {};
      const imageBrief = stored.query || group.imageBrief;
      const imageMetadata: Record<string, any> = {
        ...withoutMediaFailure(current.image),
        // The brief changes to the search words, so the hash must follow it.
        briefHash: toeicMediaHash(imageBrief),
        source: stored.candidate.provider,
        provenance: 'EXTERNAL_LIBRARY',
        provider: stored.candidate.provider,
        providerAssetId: stored.candidate.providerAssetId,
        sourcePageUrl: stored.candidate.sourcePageUrl,
        author: stored.candidate.author,
        authorUrl: stored.candidate.authorUrl,
        upstreamSource: stored.candidate.source,
        originalTags: stored.candidate.tags,
        license: stored.candidate.license,
        licenseVersion: stored.candidate.licenseVersion,
        licenseUrl: stored.candidate.licenseUrl,
        attribution: stored.candidate.attribution,
        providerMetadata: stored.candidate.metadata,
        r2Key: uploaded.key,
        imageHash,
        retrievedAt: new Date().toISOString(),
        status: 'READY',
        questionStatus: 'STALE',
      };
      const mediaMetadata = { ...current, image: imageMetadata };
      await this.prisma.toeicQuestionGroup.update({
        where: { id: group.id },
        data: {
          imageUrl: uploaded.url,
          imageBrief,
          mediaMetadata: mediaMetadata as Prisma.InputJsonValue,
        },
      });
      let vision: ToeicPart1QuestionCandidate | undefined;
      let visionError: string | undefined;
      try {
        vision = await this.runBoundedStage(
          requestId,
          'question_generation',
          ADMIN_SELECT_VISION_TIMEOUT_MS,
          () =>
            this.ai.generateToeicPart1FromImage({
              imageBuffer: image.buffer,
              mimeType: image.mimeType,
            }),
        );
        this.assertPart1QuestionCandidate(vision);
      } catch {
        visionError =
          'Không thể phân tích ảnh lúc này. Bạn có thể sửa câu hỏi thủ công hoặc thử lại.';
      }
      if (vision) {
        const question = group.questions[0];
        const data = part1QuestionData(vision);
        if (question) {
          await this.prisma.toeicQuestion.update({
            where: { id: question.id },
            data,
          });
        } else {
          await this.prisma.toeicQuestion.create({
            data: { ...data, groupId: group.id, questionNumber: 1 },
          });
        }
        imageMetadata.questionStatus = 'READY_FOR_REVIEW';
        imageMetadata.questionImageHash = imageHash;
        imageMetadata.sceneSummary = vision.sceneSummary;
        await this.reviewPart1DraftGroup(
          {
            ...group,
            imageBrief,
            questions: [{ ...(question ?? { questionNumber: 1 }), ...data }],
          },
          imageMetadata,
          image,
          uploaded.url,
        );
      } else {
        imageMetadata.questionStatus = 'FAILED';
        imageMetadata.visionError = visionError;
        await this.reviewPart1DraftGroup(
          { ...group, imageBrief },
          imageMetadata,
          image,
          uploaded.url,
        );
      }
      await this.prisma.toeicQuestionGroup.update({
        where: { id: group.id },
        data: {
          mediaMetadata: {
            ...current,
            image: imageMetadata,
          },
        },
      });
      this.imageCandidates.delete(candidateId);
      return {
        imageUrl: uploaded.url,
        imageMetadata,
        question: vision ?? null,
        error: visionError,
      };
    } catch (error) {
      if (uploadedKey)
        await this.r2.deleteFile(uploadedKey).catch(() => undefined);
      this.imageCandidates.delete(candidateId);
      throw error;
    }
  }

  async generatePart1QuestionFromStoredImage(examId: number, groupId: number) {
    const exam = await this.editableDraft(examId);
    const group = await this.prisma.toeicQuestionGroup.findFirst({
      where: { id: groupId, examId: exam.toeicExamSet!.id },
      include: { questions: { orderBy: { questionNumber: 'asc' } } },
    });
    if (!group?.imageUrl || group.part !== 1)
      throw new BadRequestException('Nhóm Part 1 chưa có ảnh để phân tích');
    const publicStorageUrl = this.r2.getPublicUrl();
    if (
      !publicStorageUrl ||
      !group.imageUrl.startsWith(`${publicStorageUrl.replace(/\/$/, '')}/`)
    ) {
      throw new BadRequestException(
        'Chỉ ảnh đã lưu trong R2 của BreadTrans mới được phân tích',
      );
    }
    const response = await fetch(group.imageUrl, {
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok)
      throw new BadRequestException('Không thể đọc ảnh đã tải lên');
    const image = this.imageSearch.validateBuffer(
      Buffer.from(await response.arrayBuffer()),
      response.headers.get('content-type'),
    );
    const vision = await this.ai.generateToeicPart1FromImage({
      imageBuffer: image.buffer,
      mimeType: image.mimeType,
    });
    this.assertPart1QuestionCandidate(vision);
    const current = (group.mediaMetadata as any) ?? {};
    const imageHash = sha256(image.buffer);
    const question = group.questions[0];
    const data = part1QuestionData(vision);
    if (question)
      await this.prisma.toeicQuestion.update({
        where: { id: question.id },
        data,
      });
    else
      await this.prisma.toeicQuestion.create({
        data: { ...data, groupId: group.id, questionNumber: 1 },
      });
    const imageMeta: Record<string, any> = {
      ...(current.image ?? {}),
      status: 'READY',
      questionStatus: 'READY_FOR_REVIEW',
      visionReviewFailed: false,
      questionImageHash: imageHash,
      sceneSummary: vision.sceneSummary,
    };
    await this.reviewPart1DraftGroup(
      {
        ...group,
        questions: [{ ...(question ?? { questionNumber: 1 }), ...data }],
      },
      imageMeta,
      image,
      group.imageUrl,
    );
    await this.prisma.toeicQuestionGroup.update({
      where: { id: group.id },
      data: {
        mediaMetadata: {
          ...current,
          image: imageMeta,
        } as Prisma.InputJsonValue,
      },
    });
    return { question: vision, review: imageMeta.review ?? null };
  }

  private assertPart1QuestionCandidate(candidate: ToeicPart1QuestionCandidate) {
    if (
      !candidate ||
      !Array.isArray(candidate.statements) ||
      candidate.statements.length !== 4 ||
      !Number.isInteger(candidate.correctIndex) ||
      candidate.correctIndex < 0 ||
      candidate.correctIndex > 3 ||
      candidate.statements.some((statement) => !String(statement).trim()) ||
      !String(candidate.explanation || '').trim()
    ) {
      throw new BadRequestException('Câu hỏi Part 1 từ ảnh không hợp lệ');
    }
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

  /** Every generated batch passes here, so no path can keep the model's key order. */
  private async draftBatch(
    input: ToeicExamBatchRequest,
    firstQuestionNumber: number,
  ) {
    const batch = await this.ai.generateToeicExamBatch(input);
    const prepared = prepareGeneratedBatch(
      input.part,
      batch,
      firstQuestionNumber,
    );
    return batch.provider
      ? {
          ...prepared,
          groups: prepared.groups.map((group) => ({
            ...group,
            provider: batch.provider,
          })),
        }
      : prepared;
  }

  /**
   * Gives a refused draft two more tries, each told why. A wrong answer stays
   * inside its batch so the rest of the exam goes on; only an outage stops the
   * job, which then resumes from the batches already done.
   */
  private async draftCheckedBatch(
    input: ToeicExamBatchRequest,
    firstQuestionNumber: number,
    slice: PlannedGroup[],
    earlierBatches: Parameters<
      ToeicAiExamService['assertNoDuplicateBatches']
    >[0],
    identity: { batchKey: string; groupOrder: number },
    review?: {
      /** Saves the batch before the reviewer runs, so a crash can resume it. */
      store: (batch: StoredLrBatch) => Promise<void>;
      unstore: (batchKey: string) => Promise<void>;
      persist: () => Promise<void>;
      initialRefusal?: string;
    },
  ): Promise<
    | { batch: StoredLrBatch; stored: boolean }
    | { batch?: undefined; refusal: string; code: FailedLrBatch['code'] }
  > {
    let refusal = review?.initialRefusal ?? '';
    let code: FailedLrBatch['code'] = 'CONTENT_CONTRACT_FAILURE';
    // Every draft of this batch and why it was refused, kept on the batch.
    const drafts: Array<{
      attempt: number;
      outcome: 'CONTENT_CONTRACT' | 'REVIEW_REJECTED' | 'ACCEPTED';
      reason?: string;
      verdictCounts?: Record<string, number>;
      refused?: unknown[];
    }> = [];
    for (let attempt = 0; attempt <= BATCH_RETRIES; attempt += 1) {
      let batch: StoredLrBatch & { drafts?: typeof drafts };
      try {
        const candidate = await this.draftBatch(
          { ...input, ...(refusal ? { retryNote: refusal } : {}) },
          firstQuestionNumber,
        );
        this.assertBatch(input.part, slice, candidate);
        batch = {
          ...identity,
          part: input.part,
          questionNumber: firstQuestionNumber,
          candidate,
          drafts,
        };
        this.assertNoDuplicateBatches([...earlierBatches, batch]);
      } catch (error) {
        if (isAiOutage(error)) throw error;
        refusal = (error as Error)?.message || 'Nội dung AI không hợp lệ';
        code = 'CONTENT_CONTRACT_FAILURE';
        drafts.push({
          attempt,
          outcome: 'CONTENT_CONTRACT',
          reason: refusal.slice(0, 300),
        });
        continue;
      }
      // Part 1 is checked on the Draft, once its photo exists.
      if (!review || input.part === 1) {
        drafts.push({ attempt, outcome: 'ACCEPTED' });
        return { batch, stored: false };
      }
      await review.store(batch);
      // A reviewer outage propagates here: the batch stays stored and the
      // resumed job only runs the missing review step.
      const verdict = await this.reviewBatch(batch, review.persist);
      if (verdict.accepted) {
        drafts.push({ attempt, outcome: 'ACCEPTED' });
        await review.persist();
        return { batch, stored: true };
      }
      refusal = verdict.refusal;
      code = 'ANSWER_REVIEW_FAILED';
      drafts.push({
        attempt,
        outcome: 'REVIEW_REJECTED',
        reason: refusal.slice(0, 300),
        ...this.refusedDraftRecord(batch),
      });
      // The last refused draft stays so the admin can see and fix it.
      if (attempt < BATCH_RETRIES) await review.unstore(identity.batchKey);
    }
    return { refusal, code };
  }

  /**
   * What a refused draft held, kept after it is redrafted: verdict counts of
   * every question and the refused questions themselves, so the refusal can
   * be audited later.
   */
  private refusedDraftRecord(batch: StoredLrBatch) {
    const part = Number(batch.part);
    const verdictCounts: Record<string, number> = {};
    const refused: unknown[] = [];
    for (const { group, firstQuestionNumber } of this.groupsWithNumbers(
      batch,
    )) {
      for (const row of (group.review?.verdicts ?? []) as QuestionReview[]) {
        verdictCounts[row.verdict] = (verdictCounts[row.verdict] ?? 0) + 1;
        if (row.verdict === 'AGREE') continue;
        const question =
          group.questions?.[row.questionNumber - firstQuestionNumber];
        refused.push({
          questionNumber: row.questionNumber,
          verdict: row.verdict,
          stimulus: groupStimulus(part, group)?.slice(0, 2500) ?? null,
          question: question
            ? {
                text: question.text ?? null,
                options: question.options,
                correctIndex: question.correctIndex,
                explanation: question.explanation,
              }
            : null,
          solve: row.solve ?? null,
          explanation: row.explanation ?? null,
        });
      }
    }
    return { verdictCounts, refused };
  }

  private reviewer(): AnswerReviewService {
    if (!this.answerReview)
      throw new ReviewerUnavailableError(
        'Chưa cấu hình dịch vụ kiểm định đáp án AI',
      );
    return this.answerReview;
  }

  private groupsWithNumbers(batch: StoredLrBatch) {
    let questionNumber = Number(batch.questionNumber);
    return (batch.candidate?.groups ?? []).map((group: any) => {
      const row = { group, firstQuestionNumber: questionNumber };
      questionNumber += group.questions?.length ?? 0;
      return row;
    });
  }

  private static adminSettled(review?: GroupReview) {
    return (
      review?.status === 'EDITED_BY_ADMIN' ||
      review?.status === 'ADMIN_CONFIRMED'
    );
  }

  /** A stored Part 2-7 batch whose review has not finished. */
  private batchNeedsReview(batch: StoredLrBatch) {
    if (Number(batch.part) === 1) return false;
    return (batch.candidate?.groups ?? []).some(
      (group: any) =>
        !ToeicAiExamService.adminSettled(group.review) &&
        (!group.review ||
          group.review.contentHash !==
            canonicalGroupHash(Number(batch.part), group) ||
          pendingStep(group.review) !== null),
    );
  }

  /**
   * Runs the review steps a Part 2-7 batch still lacks: independent solve,
   * then the explanation check. Each finished step is saved at once. A
   * provider outage throws ReviewerUnavailableError after saving, so a resumed
   * job continues from that step and never redrafts saved content.
   */
  private async reviewBatch(
    batch: StoredLrBatch,
    persist: () => Promise<void>,
  ): Promise<{ accepted: boolean; refusal: string }> {
    const part = Number(batch.part);
    const rows = this.groupsWithNumbers(batch).filter(
      ({ group }: { group: any }) =>
        !ToeicAiExamService.adminSettled(group.review),
    );
    for (const { group } of rows) {
      const hash = canonicalGroupHash(part, group);
      if (!group.review) group.review = emptyReview(hash);
      else if (group.review.contentHash !== hash)
        group.review = invalidateReview(group.review, hash, 'CONTENT_CHANGED');
    }
    if (!rows.length) return { accepted: true, refusal: '' };
    const reviewer = this.reviewer();
    const generatorVendor = reviewer.generatorVendor(rows[0].group.provider);
    const refused = () =>
      rows.some(({ group }: { group: any }) =>
        group.review.verdicts.some(
          (row: QuestionReview) => row.verdict !== 'AGREE',
        ),
      );
    const pendingOf = () =>
      rows
        .map(({ group }: { group: any }) => pendingStep(group.review))
        .find(Boolean) ?? null;
    const expected = rows.flatMap(({ group, firstQuestionNumber }: any) =>
      group.questions.map((_: unknown, index: number) => ({
        id: reviewItemId(firstQuestionNumber + index),
        optionCount: optionCountOf(part),
        part,
      })),
    );

    let pending = pendingOf();
    while (pending && !refused()) {
      if (pending === 'independentSolve') {
        const run = await reviewer.run({
          stepName: 'independentSolve',
          chain: reviewer.solveChain(),
          prompt: solvePrompt(solveRequestOf(part, rows)),
          generatorVendor,
          validate: (data) => validateSolveOutput(expected, data),
        });
        for (const { group, firstQuestionNumber } of rows) {
          const review: GroupReview = group.review;
          review.steps = { ...review.steps, independentSolve: run.step };
          if (run.step.status === 'OK') {
            review.verdicts = group.questions.map(
              (question: any, index: number) => {
                const questionNumber = firstQuestionNumber + index;
                const answer = run.answers!.get(reviewItemId(questionNumber))!;
                const judged = judgeSolve({
                  part,
                  stimulus: groupStimulus(part, group),
                  questionText: question.text,
                  options: (question.options ?? []).map(String),
                  key: question.correctIndex,
                  answer,
                });
                return {
                  questionNumber,
                  verdict: judged.verdict,
                  solve: {
                    ...judged,
                    choice: answer.choice,
                    alsoCorrect: answer.alsoCorrect,
                    answerable: answer.answerable,
                    evidence: answer.evidence,
                    evidenceSupportsAnswer: answer.evidenceSupportsAnswer,
                    reasoning: answer.reasoning,
                  },
                };
              },
            );
          } else if (run.step.status === 'INVALID') {
            review.verdicts = this.invalidVerdicts(
              group,
              firstQuestionNumber,
              'solve',
              run.step.tried,
            );
          }
          group.review = settleStatus(part, review);
        }
        await persist();
        if (run.step.status === 'UNAVAILABLE')
          throw new ReviewerUnavailableError(
            `Kiểm định đáp án tạm thời không khả dụng (${this.triedSummary(run.step.tried)})`,
          );
      } else {
        const run = await reviewer.run({
          stepName: 'explanationCheck',
          chain: reviewer.explanationChain(),
          prompt: explanationPrompt(explanationRequestOf(part, rows)),
          generatorVendor,
          validate: (data) => validateExplanationOutput(expected, data),
        });
        for (const { group, firstQuestionNumber } of rows) {
          const review: GroupReview = group.review;
          review.steps = { ...review.steps, explanationCheck: run.step };
          if (run.step.status !== 'UNAVAILABLE') {
            review.verdicts = review.verdicts.map((row) => {
              const question =
                group.questions[row.questionNumber - firstQuestionNumber];
              const explanation =
                run.step.status === 'OK'
                  ? (() => {
                      const answer = run.answers!.get(
                        reviewItemId(row.questionNumber),
                      )!;
                      return {
                        ...judgeExplanation(question.correctIndex, answer),
                        claimedChoice: answer.claimedChoice,
                        reasoning: answer.reasoning,
                      };
                    })()
                  : {
                      verdict: 'REVIEW_INVALID' as QuestionVerdict,
                      detail: `Kiểm tra giải thích trả kết quả không hợp lệ (${this.triedSummary(run.step.tried)})`,
                    };
              const next: QuestionReview = { ...row, explanation };
              next.verdict = combinedVerdict(next);
              return next;
            });
          }
          group.review = settleStatus(part, review);
        }
        await persist();
        if (run.step.status === 'UNAVAILABLE')
          throw new ReviewerUnavailableError(
            `Kiểm tra giải thích tạm thời không khả dụng (${this.triedSummary(run.step.tried)})`,
          );
      }
      pending = pendingOf();
    }
    const accepted = rows.every(({ group }: { group: any }) =>
      ['REVIEWED_INDEPENDENT', 'REVIEWED_DEGRADED'].includes(
        group.review.status,
      ),
    );
    return {
      accepted,
      refusal: accepted
        ? ''
        : reviewRejection(
            rows.flatMap(({ group }: { group: any }) => group.review.verdicts),
          ) || 'Kiểm định đáp án chưa hoàn tất',
    };
  }

  private invalidVerdicts(
    group: any,
    firstQuestionNumber: number,
    step: 'solve',
    tried: Array<{ provider: string; reason: string }>,
  ): QuestionReview[] {
    const detail = `Người giải độc lập trả kết quả không hợp lệ (${this.triedSummary(tried)})`;
    return group.questions.map((_: unknown, index: number) => ({
      questionNumber: firstQuestionNumber + index,
      verdict: 'REVIEW_INVALID' as QuestionVerdict,
      [step]: { verdict: 'REVIEW_INVALID' as QuestionVerdict, detail },
    }));
  }

  private triedSummary(tried: Array<{ provider: string; reason: string }>) {
    return (
      tried
        .map((row) => `${row.provider}: ${row.reason}`)
        .join('; ')
        .slice(0, 400) || 'không có nhà cung cấp'
    );
  }

  /** Reviews a freshly regenerated candidate group; 400 when refused. */
  private async reviewRegenerated(
    part: number,
    firstQuestionNumber: number,
    candidate: any,
  ) {
    if (part === 1) return;
    try {
      const verdict = await this.reviewBatch(
        { part, groupOrder: 0, questionNumber: firstQuestionNumber, candidate },
        () => Promise.resolve(),
      );
      if (!verdict.accepted) throw new BadRequestException(verdict.refusal);
    } catch (error) {
      if (isReviewerUnavailable(error))
        throw new ServiceUnavailableException((error as Error).message);
      throw error;
    }
  }

  /**
   * Apply decision of one candidate group from its current content: the
   * structure checks run again and the hash is recomputed, never trusted.
   */
  private lrApplyDecision(
    request: RequestSnapshot,
    batch: StoredLrBatch,
    index: number,
    group: any,
  ): ApplyDecision & { currentHash: string } {
    const part = Number(batch.part);
    let structureOk = true;
    let structureIssue = '';
    try {
      const planned = plannedGroupOf(
        request,
        batch,
        index,
        group?.questions?.length ?? 1,
      );
      this.assertBatch(part, [planned], { groups: [group] });
    } catch (error) {
      structureOk = false;
      structureIssue = (error as Error)?.message ?? '';
    }
    const currentHash = canonicalGroupHash(part, group ?? {});
    const decision = canApply({
      part,
      review: group?.review,
      currentHash,
      structureOk,
    });
    return {
      ...decision,
      reason:
        !structureOk && structureIssue
          ? `STRUCTURE_INVALID: ${structureIssue}`
          : decision.reason,
      currentHash,
    };
  }

  /**
   * Admin confirmation of a Part 2-7 candidate group, bound to its current
   * content hash. Part 1 is confirmed on the Draft, once its photo exists.
   */
  async confirmCandidate(
    jobId: string,
    adminId: number,
    candidateKey: string,
    method: ConfirmationMethod,
  ) {
    const job = await this.prisma.aiGenerationJob.findUnique({
      where: { id: jobId },
    });
    if (!job || job.createdByAdminId !== adminId)
      throw new NotFoundException('Không tìm thấy candidate tạo đề TOEIC AI');
    const candidate = (job.draftSnapshot as any) ?? null;
    if (!candidate)
      throw new ConflictException('Candidate AI chưa sẵn sàng để xác nhận');
    const located = this.flattenLrCandidateGroups(candidate).find(
      (row) => row.candidateKey === candidateKey,
    );
    if (!located)
      throw new NotFoundException('Không tìm thấy candidate item này');
    if (located.part === 1)
      throw new ConflictException(
        'Nhóm Part 1 được xác nhận trên Draft sau khi Apply, khi đã có ảnh.',
      );
    const group = located.group;
    const currentHash = canonicalGroupHash(located.part, group);
    // A legacy group never reviewed starts its record at the current content.
    const review: GroupReview = group.review ?? emptyReview(currentHash);
    const refusal = confirmationRefusal({
      part: located.part,
      review,
      method,
      currentHash,
    });
    if (refusal) throw new ConflictException(refusal);
    group.review = confirmReview(review, {
      by: adminId,
      at: new Date().toISOString(),
      method,
    });
    await this.prisma.aiGenerationJob.update({
      where: { id: jobId },
      data: { draftSnapshot: candidate as Prisma.InputJsonValue },
    });
    return this.getCandidate(jobId, adminId);
  }

  /** Records an admin edit and retires the review of the old content. */
  private recordCandidateEdit(
    part: number,
    group: any,
    before: any,
    adminId: number,
  ) {
    const changes = diffGroup(before, group);
    if (!changes.length) return;
    const hashBefore = canonicalGroupHash(part, before);
    const hashAfter = canonicalGroupHash(part, group);
    const review = invalidateReview(
      (group.review as GroupReview | undefined) ?? emptyReview(hashBefore),
      hashAfter,
      'ADMIN_EDIT',
    );
    review.status = 'EDITED_BY_ADMIN';
    review.edits = [
      ...review.edits,
      {
        by: adminId,
        at: new Date().toISOString(),
        contentHashBefore: hashBefore,
        contentHashAfter: hashAfter,
        changes,
      },
    ];
    group.review = review;
  }

  /** Clears ANSWER_REVIEW_FAILED once no group of that batch is refused. */
  private resolveReviewFailures(candidate: any) {
    if (!Array.isArray(candidate.failedUnits)) return;
    candidate.failedUnits = candidate.failedUnits.filter(
      (unit: FailedLrBatch) => {
        if (unit.code !== 'ANSWER_REVIEW_FAILED') return true;
        const batch = (candidate.lrBatches ?? []).find(
          (row: StoredLrBatch) => row.batchKey === unit.batchKey,
        );
        if (!batch) return true;
        return (batch.candidate?.groups ?? []).some(
          (group: any) => !group.review || group.review.status === 'REJECTED',
        );
      },
    );
    candidate.partial = candidate.failedUnits.length > 0;
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
      if ([2, 3, 4].includes(part) && !String(group.transcript ?? '').trim())
        throw new BadRequestException(
          `Nhóm Listening ${index + 1} thiếu nội dung cần nghe`,
        );
      const lengthIssue = listeningScriptLengthIssue(part, group.transcript);
      if (lengthIssue)
        throw new BadRequestException(`Nhóm ${index + 1}: ${lengthIssue}`);
      if ([6, 7].includes(part) && !String(group.passageText ?? '').trim())
        throw new BadRequestException(
          `Nhóm Reading ${index + 1} thiếu passage`,
        );
      if (part === 1 && !String(group.imageBrief ?? '').trim())
        throw new BadRequestException(
          `Nhóm Part 1 ${index + 1} thiếu mô tả ảnh`,
        );
      const readingIssue =
        languageIssue(group) ??
        readingGroupIssue(part, group) ??
        plannedGroupIssue(expected[index], group) ??
        questionContentIssue(part, group);
      if (readingIssue)
        throw new BadRequestException(`Nhóm ${index + 1}: ${readingIssue}`);
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
        if (!isVietnameseExplanation(question.explanation))
          throw new BadRequestException(
            'AI trả về giải thích không phải tiếng Việt có dấu',
          );
        if (explanationNamesPosition(question.explanation))
          throw new BadRequestException(
            'AI trả về giải thích gọi đáp án theo vị trí',
          );
        // Part 3/4 question prompts are spoken after the conversation/talk
        // (toeic-listening-audio.ts); without this text the audio script
        // cannot be composed at all.
        if ([3, 4].includes(part) && !String(question.text ?? '').trim())
          throw new BadRequestException(
            'AI trả về câu hỏi Part 3/4 thiếu nội dung câu hỏi để đọc trong audio',
          );
        const fingerprint = questionFingerprint({ ...question, options });
        if (seen.has(fingerprint))
          throw new BadRequestException(
            'AI trả về câu hỏi trùng lặp trong batch',
          );
        seen.add(fingerprint);
      });
      if (part >= 1 && part <= 4) {
        try {
          buildToeicListeningAudioScript({
            part,
            transcriptText: group.transcript,
            passageText: group.passageText,
            questions: group.questions,
          });
        } catch (error) {
          throw new BadRequestException(
            `Nhóm Listening ${index + 1} không đủ cấu trúc audio: ${(error as Error).message}`,
          );
        }
      }
    });
  }

  private assertNoDuplicateBatches(
    batches: Array<{ candidate: { groups?: any[] } }>,
  ) {
    const seen = new Set<string>();
    for (const batch of batches) {
      for (const group of batch.candidate?.groups ?? []) {
        for (const question of group.questions ?? []) {
          const fingerprint = questionFingerprint(question);
          if (seen.has(fingerprint))
            throw new BadRequestException(
              'AI trả về câu hỏi trùng lặp giữa các batch',
            );
          seen.add(fingerprint);
        }
      }
    }
  }

  private async writeBatch(
    db: PrismaService | Prisma.TransactionClient,
    examSetId: number,
    part: number,
    firstGroupOrder: number,
    firstQuestionNumber: number,
    candidate: any,
  ) {
    let questionNumber = firstQuestionNumber;
    for (let index = 0; index < candidate.groups.length; index += 1) {
      const group = candidate.groups[index];
      await this.writeGroup(
        db,
        examSetId,
        part,
        firstGroupOrder + index,
        questionNumber,
        group,
      );
      questionNumber += group.questions.length;
    }
  }

  private async writeGroup(
    db: PrismaService | Prisma.TransactionClient,
    examSetId: number,
    part: number,
    groupOrder: number,
    firstQuestionNumber: number,
    group: any,
  ) {
    let questionNumber = firstQuestionNumber;
    await db.toeicQuestionGroup.create({
      data: {
        examId: examSetId,
        part,
        groupOrder,
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
            text: question.text?.trim() || fixedPromptOfPart(part),
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

  /**
   * Derives the stable, in-memory-only candidateKey identity for every
   * selectable logical unit in a draft candidate — no new DB column/table.
   * Group-level for L&R (the atomic Prisma write unit); whole-block for
   * Speaking/Writing (their materialization is all-or-nothing today).
   */
  private flattenLrCandidateGroups(candidate: any): Array<{
    candidateKey: string;
    part: number;
    groupOrder: number;
    questionNumberStart: number;
    group: any;
  }> {
    const lrBatches = Array.isArray(candidate?.lrBatches)
      ? candidate.lrBatches
      : [];
    const flattened: Array<{
      candidateKey: string;
      part: number;
      groupOrder: number;
      questionNumberStart: number;
      group: any;
    }> = [];
    for (const batch of lrBatches) {
      let questionNumber = Number(batch.questionNumber);
      const groups = batch.candidate?.groups ?? [];
      for (let index = 0; index < groups.length; index += 1) {
        const group = groups[index];
        const groupOrder = Number(batch.groupOrder) + index;
        flattened.push({
          candidateKey: `LR:P${batch.part}:G${groupOrder}`,
          part: Number(batch.part),
          groupOrder,
          questionNumberStart: questionNumber,
          group,
        });
        questionNumber += group.questions?.length ?? 0;
      }
    }
    return flattened;
  }

  private availableCandidateKeys(candidate: any): string[] {
    const keys = this.flattenLrCandidateGroups(candidate).map(
      (g) => g.candidateKey,
    );
    if (candidate?.speakingWriting?.speaking?.length) keys.push('SPEAKING');
    if (candidate?.speakingWriting?.writing?.length) keys.push('WRITING');
    return keys;
  }

  private async makeAudio(audioScript: string) {
    const audio = await this.ai.generateToeicListeningAudio(audioScript);
    if (!audio?.length)
      throw new BadRequestException('Không thể tạo audio TTS cho lời thoại');
    // music-metadata is ESM-only. Keep it out of module bootstrap so the
    // CommonJS Jest E2E harness can load AppModule without parsing audio.
    const { parseBuffer } = await import('music-metadata');
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
      include: { questions: { orderBy: { questionNumber: 'asc' } } },
      orderBy: { groupOrder: 'asc' },
    });
    for (const group of groups) {
      const metadata = (group.mediaMetadata as any) ?? {};
      if (group.part === 1) {
        let imageResult:
          | {
              url: string;
              key: string;
              metadata: Record<string, unknown>;
              buffer?: Buffer;
              mimeType?: string;
            }
          | undefined;
        try {
          imageResult = await this.sourceExamImage(
            `exam-${examSetId}/groups/${group.id}/image`,
            group.imageBrief || 'natural workplace scene',
            1,
          );
        } catch (error) {
          const failedMetadata = withMediaFailure(
            metadata,
            'image',
            error,
            toeicMediaHash(group.imageBrief),
          );
          Object.assign(metadata, failedMetadata);
          await this.prisma.toeicQuestionGroup.update({
            where: { id: group.id },
            data: {
              imageUrl: null,
              mediaMetadata: failedMetadata,
            },
          });
          this.logger.warn(
            `TOEIC image soft failure for group ${group.id}: ${
              failedMetadata.image.errorCode
            }`,
          );
        }
        if (imageResult) {
          metadata.image = {
            ...imageResult.metadata,
            status: 'READY',
            r2Key: imageResult.key,
            generatedAt: new Date().toISOString(),
            briefHash: toeicMediaHash(group.imageBrief),
          };
          await this.matchPart1QuestionToImage(group, metadata, imageResult);
          await this.reviewPart1DraftGroup(
            group,
            metadata.image,
            imageResult,
            imageResult.url,
          );
          await this.prisma.toeicQuestionGroup.update({
            where: { id: group.id },
            data: {
              imageUrl: imageResult.url,
              mediaMetadata: metadata as Prisma.InputJsonValue,
            },
          });
        }
      }
      let script: string;
      let sourceHash: string;
      try {
        script = buildToeicListeningAudioScript(group);
        sourceHash = toeicListeningAudioFingerprint(group);
      } catch (error) {
        const failedMetadata = withMediaFailure(
          metadata,
          'audio',
          error,
          toeicMediaHash(''),
        );
        Object.assign(metadata, failedMetadata);
        await this.prisma.toeicQuestionGroup.update({
          where: { id: group.id },
          data: {
            audioUrl: null,
            mediaMetadata: failedMetadata,
          },
        });
        continue;
      }
      let audioResult: { url: string; key: string } | undefined;
      try {
        const audio = await this.makeAudio(script);
        // Private bucket; the group stores the key (see regenerate above).
        const uploaded = await this.r2.putPrivateObjectAtKey(
          `premium/listening/toeic/exams/${examSetId}/groups/${group.id}/audio.mp3`,
          audio,
          'audio/mpeg',
        );
        if (!(await this.r2.privateObjectExists(uploaded.key)))
          throw new BadRequestException(
            'R2 chưa xác nhận audio AI vừa tải lên',
          );
        audioResult = uploaded;
      } catch (error) {
        const failedMetadata = withMediaFailure(
          metadata,
          'audio',
          error,
          sourceHash,
        );
        Object.assign(metadata, failedMetadata);
        await this.prisma.toeicQuestionGroup.update({
          where: { id: group.id },
          data: {
            audioUrl: null,
            mediaMetadata: failedMetadata,
          },
        });
        this.logger.warn(
          `TOEIC audio soft failure for group ${group.id}: ${
            failedMetadata.audio.errorCode
          }`,
        );
      }
      if (audioResult) {
        metadata.audio = {
          source: 'AI_GENERATED',
          status: 'READY',
          r2Key: audioResult.key,
          generatedAt: new Date().toISOString(),
          sourceHash,
          scriptVersion: TOEIC_LISTENING_AUDIO_SCRIPT_VERSION,
        };
        await this.prisma.toeicQuestionGroup.update({
          where: { id: group.id },
          data: {
            audioUrl: audioResult.key,
            mediaMetadata: metadata as Prisma.InputJsonValue,
          },
        });
      }
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
      if (
        task.taskKind === 'PICTURE_SENTENCE' &&
        new Set(
          (Array.isArray(task.keywords) ? task.keywords : [])
            .map((word: unknown) => String(word).trim().toLowerCase())
            .filter(Boolean),
        ).size !== 2
      )
        throw new BadRequestException(
          `Task Writing ${index + 1} cần đúng 2 từ khoá`,
        );
      if (
        task.taskKind === 'WRITTEN_REQUEST' &&
        String(task.email ?? '').trim().length < 40
      )
        throw new BadRequestException(
          `Task Writing ${index + 1} thiếu e-mail cần trả lời`,
        );
      if (
        task.taskKind === 'OPINION_ESSAY' &&
        !(Number(task.wordRange?.[0]) >= 300)
      )
        throw new BadRequestException(
          `Task Writing ${index + 1} cần tối thiểu 300 từ`,
        );
    });
  }

  private async generatedImageUrl(scope: string, brief: string, part: number) {
    try {
      const image = await this.sourceExamImage(scope, brief, part);
      return {
        url: image.url,
        metadata: {
          ...image.metadata,
          r2Key: image.key,
          generatedAt: new Date().toISOString(),
          briefHash: sha256(brief),
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Exam image unavailable for ${scope}: ${message}`);
      return {
        url: null,
        metadata: withMediaFailure({}, 'image', error, sha256(brief)),
      };
    }
  }

  /**
   * Photo libraries come first, then the Cloudflare image model, then Gemini
   * for a paid key. When all fail the question stays and the admin is told.
   */
  private async sourceExamImage(scope: string, brief: string, part: number) {
    const library = await this.imageFromLibrary(scope, brief);
    if (library) return library;
    // Without a free generator every miss would spend a failed call.
    if (!this.ai.canGenerateExamImage())
      throw new Error('Image provider unavailable: no suitable library photo');
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
      key: uploaded.key,
      buffer: image.buffer,
      mimeType: image.mimeType,
      metadata: { source: 'AI_GENERATED' } as Record<string, unknown>,
    };
  }

  /** Null when no library has a suitable image; the caller then falls back. */
  private async imageFromLibrary(scope: string, brief: string) {
    for (const query of imageSearchQueries(brief)) {
      const image = await this.imageForQuery(scope, query);
      if (image) return image;
    }
    return null;
  }

  private async imageForQuery(scope: string, query: string) {
    let candidates: ImageSearchCandidate[];
    try {
      candidates = await this.imageSearch.search(query, { limit: 5 });
    } catch (error) {
      this.logger.warn(`Image search failed for ${scope}: ${String(error)}`);
      return null;
    }
    const previews: Array<{
      candidate: ImageSearchCandidate;
      candidateId: string;
      image: Awaited<ReturnType<typeof this.imageSearch.download>>;
    }> = [];
    // One at a time: parallel downloads draw a 429 from Pixabay, and the chain
    // then skips Pixabay search for a minute.
    for (const [index, candidate] of candidates.entries()) {
      if (previews.length === MAX_IMAGE_PREVIEWS) break;
      try {
        const image = await this.imageSearch.download(candidate);
        previews.push({ candidate, candidateId: String(index), image });
      } catch {
        continue;
      }
    }
    if (!previews.length) return null;
    const analyses = await this.ai.analyzeToeicPart1Candidates({
      candidates: previews.map((row) => ({
        candidateId: row.candidateId,
        imageBuffer: row.image.buffer,
        mimeType: row.image.mimeType,
      })),
    });
    const bestId = bestImageCandidate(analyses);
    const best = previews.find((row) => row.candidateId === bestId);
    if (!best) return null;
    const { candidate, image } = best;
    const uploaded = await this.r2.putObjectAtKey(
      `ai/toeic-exams/${scope}.${image.mimeType === 'image/png' ? 'png' : 'jpg'}`,
      image.buffer,
      image.mimeType,
    );
    if (!(await this.r2.objectExists(uploaded.key)))
      throw new BadRequestException('R2 chưa xác nhận ảnh vừa tải lên');
    return {
      url: uploaded.url,
      key: uploaded.key,
      buffer: image.buffer,
      mimeType: image.mimeType,
      metadata: {
        source: candidate.provider,
        provenance: 'EXTERNAL_LIBRARY',
        provider: candidate.provider,
        providerAssetId: candidate.providerAssetId,
        sourcePageUrl: candidate.sourcePageUrl,
        author: candidate.author,
        authorUrl: candidate.authorUrl,
        license: candidate.license,
        licenseVersion: candidate.licenseVersion,
        licenseUrl: candidate.licenseUrl,
        attribution: candidate.attribution,
      } as Record<string, unknown>,
    };
  }

  /**
   * Part 1 answer review on the Draft: Vision looks at the photo and the four
   * statements (never the key) and picks one. A different pick marks the
   * question FAILED. Any earlier review moves to history, tied to its hash.
   * Never throws: a reviewer outage leaves the group UNREVIEWED.
   */
  private async reviewPart1DraftGroup(
    group: {
      transcriptText?: string | null;
      passageText?: string | null;
      imageBrief?: string | null;
      questions: any[];
    },
    imageMeta: Record<string, any>,
    image: { buffer?: Buffer; mimeType?: string } | undefined,
    url: string | null,
  ) {
    if (!image?.buffer || !image.mimeType) return;
    const imageSha256 = sha256(image.buffer);
    imageMeta.imageHash = imageSha256;
    const hash = part1DraftHash(group, {
      r2Key: imageMeta.r2Key,
      url,
      sha256: imageSha256,
    });
    const previous = imageMeta.review as GroupReview | undefined;
    let review = previous
      ? invalidateReview(previous, hash, 'IMAGE_OR_QUESTION_CHANGED')
      : emptyReview(hash);
    const question = group.questions[0];
    if (!question || imageMeta.questionStatus === 'FAILED') {
      // The question was not written from this photo: nothing to confirm.
      imageMeta.review = { ...review, status: 'REJECTED' };
      return;
    }
    if (!this.answerReview) {
      imageMeta.review = review;
      return;
    }
    try {
      const run = await this.answerReview.run({
        stepName: 'part1VisionReview',
        chain: this.answerReview.visionChain(),
        prompt: part1VisionPrompt(
          (question.options ?? []).map((option: unknown) => String(option)),
        ),
        generatorVendor: 'google',
        image: { buffer: image.buffer, mimeType: image.mimeType },
        validate: (data) => validatePart1VisionOutput(data),
      });
      review.steps = { ...review.steps, part1VisionReview: run.step };
      if (run.step.status === 'OK') {
        const answer = run.answers!.get('q')!;
        const judged = judgePart1Vision(question.correctIndex, answer);
        review.verdicts = [
          {
            questionNumber: question.questionNumber ?? 1,
            verdict: judged.verdict,
            vision: {
              ...judged,
              choice: answer.choice,
              reasoning: answer.reasoning,
            },
          },
        ];
        if (judged.verdict !== 'AGREE') {
          imageMeta.questionStatus = 'FAILED';
          imageMeta.visionReviewFailed = true;
        }
      }
      review = settleStatus(1, review);
    } catch (error) {
      this.logger.warn(`Part 1 vision review failed: ${String(error)}`);
    }
    imageMeta.review = review;
  }

  /** Reads the stored Part 1 photo back from BreadTrans's public R2. */
  private async storedPart1Image(imageUrl: string) {
    const publicStorageUrl = this.r2.getPublicUrl();
    if (
      !publicStorageUrl ||
      !imageUrl.startsWith(`${publicStorageUrl.replace(/\/$/, '')}/`)
    )
      throw new BadRequestException(
        'Chỉ ảnh đã lưu trong R2 của BreadTrans mới được phân tích',
      );
    const response = await fetch(imageUrl, {
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok)
      throw new BadRequestException('Không thể đọc ảnh đã tải lên');
    return this.imageSearch.validateBuffer(
      Buffer.from(await response.arrayBuffer()),
      response.headers.get('content-type'),
    );
  }

  private async part1DraftGroup(examId: number, groupId: number) {
    const exam = await this.editableDraft(examId);
    const group = await this.prisma.toeicQuestionGroup.findFirst({
      where: { id: groupId, examId: exam.toeicExamSet!.id },
      include: { questions: { orderBy: { questionNumber: 'asc' } } },
    });
    if (!group || group.part !== 1)
      throw new NotFoundException('Không tìm thấy nhóm Part 1 trong Draft');
    return group;
  }

  /**
   * Re-reads the stored photo, checks its bytes and either keeps the review
   * (same content) or retires it. A question FAILED by Vision stops being
   * FAILED once the admin changed that question or its photo.
   */
  private async currentPart1Review(group: any) {
    const metadata = group.mediaMetadata ?? {};
    const image = { ...(metadata.image ?? {}) };
    if (!group.imageUrl)
      throw new ConflictException('Nhóm Part 1 chưa có ảnh để xác nhận');
    const stored = await this.storedPart1Image(group.imageUrl).catch(() => {
      throw new ConflictException(
        'Không đọc được ảnh hiện tại nên không xác định được phiên bản ảnh (IMAGE_VERSION_UNKNOWN).',
      );
    });
    const bytesSha = sha256(stored.buffer);
    const imageChanged = image.imageHash !== bytesSha;
    image.imageHash = bytesSha;
    const currentHash = part1DraftHash(group, {
      r2Key: image.r2Key,
      url: group.imageUrl,
      sha256: bytesSha,
    });
    let review: GroupReview = image.review ?? emptyReview(currentHash);
    let changed = false;
    if (review.contentHash !== currentHash || imageChanged) {
      review = invalidateReview(
        review,
        currentHash,
        imageChanged ? 'IMAGE_CHANGED' : 'CONTENT_CHANGED',
      );
      if (image.questionStatus === 'FAILED' && image.visionReviewFailed) {
        image.questionStatus = 'READY_FOR_REVIEW';
        image.visionReviewFailed = false;
      }
      changed = true;
    }
    image.review = review;
    return { metadata, image, stored, currentHash, review, changed };
  }

  /** Runs the Part 1 Vision review again on the current question and photo. */
  async reviewPart1Draft(examId: number, groupId: number) {
    const group = await this.part1DraftGroup(examId, groupId);
    const { metadata, image, stored } = await this.currentPart1Review(group);
    await this.reviewPart1DraftGroup(group, image, stored, group.imageUrl);
    await this.prisma.toeicQuestionGroup.update({
      where: { id: group.id },
      data: {
        mediaMetadata: { ...metadata, image } as Prisma.InputJsonValue,
      },
    });
    return { groupId: group.id, image };
  }

  /**
   * Admin confirmation of a Part 1 Draft group, bound to the hash of its
   * current question and photo bytes. Publishing requires it.
   */
  async confirmPart1Draft(
    examId: number,
    groupId: number,
    adminId: number,
    method: ConfirmationMethod,
  ) {
    const group = await this.part1DraftGroup(examId, groupId);
    const { metadata, image, review, currentHash, changed } =
      await this.currentPart1Review(group);
    if (changed) {
      await this.prisma.toeicQuestionGroup.update({
        where: { id: group.id },
        data: {
          mediaMetadata: { ...metadata, image } as Prisma.InputJsonValue,
        },
      });
      throw new ConflictException(
        'Nội dung hoặc ảnh đã thay đổi sau lần kiểm định; kết quả cũ đã chuyển vào lịch sử. Hãy chạy lại kiểm tra Vision hoặc xác nhận thủ công.',
      );
    }
    const refusal = confirmationRefusal({
      part: 1,
      review,
      method,
      currentHash,
      anyQuestionFailed: ['FAILED', 'STALE'].includes(image.questionStatus),
    });
    if (refusal) throw new ConflictException(refusal);
    image.review = confirmReview(review, {
      by: adminId,
      at: new Date().toISOString(),
      method,
    });
    await this.prisma.toeicQuestionGroup.update({
      where: { id: group.id },
      data: {
        mediaMetadata: { ...metadata, image } as Prisma.InputJsonValue,
      },
    });
    return { groupId: group.id, image };
  }

  /** A library photo is not the scene the question was written for. */
  private async matchPart1QuestionToImage(
    group: { questions: Array<{ id: number; options?: unknown }> },
    metadata: { image?: Record<string, unknown> },
    image: { buffer?: Buffer; mimeType?: string; metadata: object },
  ) {
    const fromLibrary =
      (image.metadata as { provenance?: string }).provenance ===
      'EXTERNAL_LIBRARY';
    if (!fromLibrary || !image.buffer || !image.mimeType) return;
    const question = group.questions[0];
    try {
      const vision = await this.ai.generateToeicPart1FromImage({
        imageBuffer: image.buffer,
        mimeType: image.mimeType,
      });
      this.assertPart1QuestionCandidate(vision);
      if (question) {
        const data = part1QuestionData(vision);
        await this.prisma.toeicQuestion.update({
          where: { id: question.id },
          data,
        });
        // The audio and the answer review read this same object right after.
        Object.assign(question, data);
      }
      metadata.image = {
        ...metadata.image,
        questionStatus: 'READY_FOR_REVIEW',
        sceneSummary: vision.sceneSummary,
      };
    } catch (error) {
      this.logger.warn(`Part 1 question not matched: ${String(error)}`);
      metadata.image = { ...metadata.image, questionStatus: 'FAILED' };
    }
  }

  private async materializeSpeakingWriting(
    jobId: string,
    exam: any,
    request: RequestSnapshot,
    draft: any,
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
        // The room strips "<exam title> — " and shows the rest as the box
        // heading; a fixed English title showed as is (audit 2026-11-06).
        title: exam.title ? `${exam.title} — Thông tin` : 'Thông tin',
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
          taskType: exercise.taskType,
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
        email: task.email?.trim() || undefined,
        keywords: task.keywords
          ?.map((value: unknown) => String(value).trim())
          .filter(Boolean),
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

  private async process(queueJob: Job<JobPayload>, token?: string) {
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
    let activeScope:
      | { kind: 'batch'; part: number; offset: number }
      | { kind: 'speaking-writing' }
      | undefined;
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
      let groupOrder = 1;
      let questionNumber = 1;
      const lrExamSet = exam.toeicExamSet;
      const persistedCandidate =
        (job.draftSnapshot as ToeicAiDraftSnapshot | null) ?? null;
      const generatedBatches: Array<{
        batchKey?: string;
        part: number;
        groupOrder: number;
        questionNumber: number;
        candidate: any;
      }> = Array.isArray(persistedCandidate?.lrBatches)
        ? persistedCandidate.lrBatches.filter(
            (batch: any) =>
              typeof batch?.batchKey === 'string' &&
              Number.isInteger(batch?.part) &&
              batch?.candidate,
          )
        : [];
      let speakingWritingDraft: any =
        persistedCandidate?.speakingWriting ?? null;
      let failedUnits: FailedLrBatch[] = Array.isArray(
        persistedCandidate?.failedUnits,
      )
        ? (persistedCandidate?.failedUnits ?? [])
        : [];
      const persistPartialCandidate = async () => {
        await this.prisma.aiGenerationJob.update({
          where: { id: jobId },
          data: {
            draftSnapshot: {
              version: 1,
              partial: true,
              lrBatches: generatedBatches,
              failedUnits,
              speakingWriting: speakingWritingDraft,
            },
          },
        });
      };
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
          const batchKey = `${part}:${offset}`;
          const firstGroupOrder = groupOrder;
          const firstQuestionNumber = questionNumber;
          groupOrder += slice.length;
          questionNumber += slice.reduce(
            (total, item) => total + item.questionCount,
            0,
          );
          const dropStored = (key: string) => {
            const index = generatedBatches.findIndex(
              (batch) => batch.batchKey === key,
            );
            if (index >= 0) generatedBatches.splice(index, 1);
          };
          let initialRefusal: string | undefined;
          const stored = generatedBatches.find(
            (batch) => batch.batchKey === batchKey,
          );
          if (stored) {
            const refusedUnit = failedUnits.find(
              (unit) =>
                unit.batchKey === batchKey &&
                unit.code === 'ANSWER_REVIEW_FAILED',
            );
            let redraft = false;
            if (refusedUnit) {
              // A retry redrafts the refused batch the admin did not fix.
              redraft = (stored.candidate?.groups ?? []).some(
                (group: any) => group.review?.status === 'REJECTED',
              );
              initialRefusal = refusedUnit.message;
            } else if (this.batchNeedsReview(stored)) {
              activeScope = { kind: 'batch', part, offset };
              const verdict = await this.reviewBatch(
                stored,
                persistPartialCandidate,
              );
              redraft = !verdict.accepted;
              initialRefusal = verdict.refusal;
            }
            if (!redraft) {
              failedUnits = failedUnits.filter(
                (unit) => unit.batchKey !== batchKey,
              );
              await this.checkpoint(jobId, 'GENERATING_TEXT', part, {
                completedGroups: Math.min(offset + slice.length, plan.length),
                totalGroups: plan.length,
                stage: 'GENERATING_TEXT',
              });
              continue;
            }
            dropStored(batchKey);
            await persistPartialCandidate();
          }
          activeScope = { kind: 'batch', part, offset };
          const outcome = await this.draftCheckedBatch(
            {
              part,
              topic: request.topic,
              difficulty: request.difficulty,
              groups: slice,
              avoidQuestions: questionsToAvoid(generatedBatches, part),
            },
            firstQuestionNumber,
            slice,
            generatedBatches,
            { batchKey, groupOrder: firstGroupOrder },
            {
              initialRefusal,
              persist: persistPartialCandidate,
              store: async (batch) => {
                dropStored(batch.batchKey!);
                generatedBatches.push(batch);
                await persistPartialCandidate();
              },
              unstore: async (key) => {
                dropStored(key);
                await persistPartialCandidate();
              },
            },
          );
          if (!outcome.batch) {
            const message = outcome.refusal;
            const previous = failedUnits.find(
              (unit) => unit.batchKey === batchKey,
            );
            failedUnits = [
              ...failedUnits.filter((unit) => unit.batchKey !== batchKey),
              this.failedBatch(
                request,
                part,
                offset,
                message,
                previous,
                outcome.code,
              ),
            ];
            await persistPartialCandidate();
            await this.checkpoint(jobId, 'GENERATING_TEXT', part, {
              completedGroups: Math.min(offset + slice.length, plan.length),
              totalGroups: plan.length,
              stage: 'PARTIAL',
              failedBatches: failedUnits
                .filter((unit) => unit.part === part)
                .map((unit) => ({
                  batchKey: unit.batchKey,
                  message: unit.message,
                })),
            });
            continue;
          }
          const generatedBatch = outcome.batch;
          if (!outcome.stored) generatedBatches.push(generatedBatch);
          failedUnits = failedUnits.filter(
            (unit) => unit.batchKey !== batchKey,
          );
          await persistPartialCandidate();
          await this.checkpoint(jobId, 'GENERATING_TEXT', part, {
            completedGroups: Math.min(offset + slice.length, plan.length),
            totalGroups: plan.length,
            stage: 'GENERATING_TEXT',
          });
        }
      }
      if (['TOEIC_SW', 'TOEIC_4_SKILLS'].includes(request.variantCode)) {
        if (!speakingWritingDraft) {
          activeScope = { kind: 'speaking-writing' };
          await this.checkpoint(jobId, 'GENERATING_TEXT');
          let refusal = '';
          for (let attempt = 0; attempt <= BATCH_RETRIES; attempt += 1) {
            try {
              const draft = await this.ai.generateToeicSpeakingWritingDraft({
                topic: request.topic,
                difficulty: request.difficulty,
                includeSpeaking: true,
                includeWriting: true,
                ...(refusal ? { retryNote: refusal } : {}),
              });
              this.assertSpeakingWritingDraft(draft, request);
              speakingWritingDraft = draft;
              break;
            } catch (error) {
              if (isAiOutage(error) || attempt === BATCH_RETRIES) throw error;
              refusal = (error as Error)?.message || 'Nội dung AI không hợp lệ';
            }
          }
          await persistPartialCandidate();
        }
      }
      await this.checkpoint(jobId, 'VALIDATING_TEXT');
      const currentJob = await this.prisma.aiGenerationJob.findUniqueOrThrow({
        where: { id: jobId },
        select: { resultSnapshot: true },
      });
      await this.prisma.aiGenerationJob.update({
        where: { id: jobId },
        data: {
          status: AiGenerationJobStatus.GENERATED,
          completedAt: new Date(),
          draftSnapshot: {
            version: 1,
            partial: failedUnits.length > 0,
            lrBatches: generatedBatches,
            failedUnits,
            speakingWriting: speakingWritingDraft ?? null,
          },
          resultSnapshot: {
            ...((currentJob.resultSnapshot as object) ?? {}),
            stage:
              failedUnits.length > 0
                ? 'READY_FOR_REVIEW_WITH_ERRORS'
                : 'READY_FOR_REVIEW',
            candidate: {
              lrBatchCount: generatedBatches.length,
              failedUnitCount: failedUnits.length,
              speakingCount: speakingWritingDraft?.speaking?.length ?? 0,
              writingCount: speakingWritingDraft?.writing?.length ?? 0,
            },
          },
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Every provider out (quota spent or down): wait for the reset and
      // resume from the checkpoint rather than failing (ai-job-quota-wait).
      const latest = await this.prisma.aiGenerationJob.findUnique({
        where: { id: jobId },
        select: { resultSnapshot: true },
      });
      const snapshot =
        (latest?.resultSnapshot as Record<string, unknown>) ?? {};
      const waitsSoFar = Number(snapshot.quotaWaits ?? 0) || 0;
      const resumeAt = token
        ? quotaWaitResumeAt({
            isOutage: isAiOutage(error) || isReviewerUnavailable(error),
            spentUntil: await Promise.all(
              (['cloudflare', 'openai-compatible', 'gemini'] as const).map(
                (provider) => exhaustedUntil(this.connection, provider),
              ),
            ),
            waitsSoFar,
            now: new Date(),
          })
        : null;
      if (resumeAt && token) {
        await this.prisma.aiGenerationJob.update({
          where: { id: jobId },
          data: {
            status: AiGenerationJobStatus.QUEUED,
            errorSummary: message.slice(0, 1000),
            resultSnapshot: {
              ...snapshot,
              stage: 'WAITING_QUOTA',
              resumeAt: resumeAt.toISOString(),
              quotaWaits: waitsSoFar + 1,
              failedScope: activeScope,
            },
            failureHistory: [
              ...(Array.isArray(job.failureHistory) ? job.failureHistory : []),
              {
                at: new Date().toISOString(),
                message: message.slice(0, 1000),
                waitingUntil: resumeAt.toISOString(),
              },
            ] as Prisma.InputJsonValue,
          },
        });
        this.logger.warn(
          `toeic_ai_job_waiting_quota jobId=${jobId} resumeAt=${resumeAt.toISOString()} wait=${waitsSoFar + 1}`,
        );
        await queueJob.moveToDelayed(resumeAt.getTime(), token);
        throw new DelayedError();
      }
      await this.prisma.aiGenerationJob.update({
        where: { id: jobId },
        data: {
          status: AiGenerationJobStatus.FAILED,
          completedAt: new Date(),
          errorSummary: message.slice(0, 1000),
          resultSnapshot: {
            ...((job.resultSnapshot as object) ?? {}),
            stage: 'FAILED',
            failedScope: activeScope,
          },
          failureHistory: [
            ...(Array.isArray(job.failureHistory) ? job.failureHistory : []),
            { at: new Date().toISOString(), message: message.slice(0, 1000) },
          ] as Prisma.InputJsonValue,
        },
      });
      throw error;
    }
  }
}

export { PRACTICE_DISCLAIMER };
