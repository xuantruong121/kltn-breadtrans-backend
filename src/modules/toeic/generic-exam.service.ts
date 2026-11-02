import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  AiGenerationJobStatus,
  Prisma,
  QuizPublicationStatus,
  SpeakingPracticeScope,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  validateToeicExam,
  humanizeToeicValidationIssues,
} from './toeic.validation';
import { isAcceptedContentImageReference } from '../upload/content-image-validation';
import {
  isPrivateListeningMediaKey,
  UploadService,
} from '../upload/upload.service';
import {
  EXAM_TEMPLATES,
  ExamTemplate,
  resolveExamTemplate,
  resolveTemplateByKey,
} from './exam-template.registry';
import { CreateGenericExamDto, UpdateGenericExamDto } from './generic-exam.dto';
import {
  TOEIC_SPEAKING_TASK_SEQUENCE,
  toeicSpeakingContractErrors,
} from '../speaking/toeic-speaking-contract';
import { SkillCmsService } from '../content/skill-cms.service';
import {
  SpeakingExerciseDto,
  SpeakingExerciseReorderDto,
} from '../content/skill-cms.dto';
import { SpeakingStimulusDto } from '../content/speaking-stimulus.dto';
import { ListQuery, pageOf, wantsPage } from '../../common/paging/list-page';
import { examListFacets, filterExamList } from './exam-admin-list';

type ProductRecord = any;

/**
 * An exam's own draft L&R goes live inside publish(), so requiring it to be
 * published first would make the exam impossible to publish. Only a source
 * borrowed from another exam must already be live.
 */
export function lrSourceIsLive(
  lr: { id: number; publicationStatus: string } | null | undefined,
  ownSetId: number | undefined,
) {
  if (lr?.publicationStatus === QuizPublicationStatus.PUBLISHED) return true;
  return (
    lr?.publicationStatus === QuizPublicationStatus.DRAFT && lr.id === ownSetId
  );
}

/**
 * What a learner receives for one question: Parts 1 and 2 are audio only, so
 * printing their options would give the spoken answers away.
 */
function learnerPreviewQuestion(part: number, question: any) {
  const audioOnly = part <= 2;
  return {
    id: question.id,
    questionNumber: question.questionNumber,
    text: audioOnly ? null : question.text,
    options: audioOnly ? question.options.map(() => '') : question.options,
  };
}

/** Slots that need a picture and have none; the exam page offers to fill them. */
function countMissingImages(exam: ProductRecord, lr: ProductRecord) {
  const components: any[] = exam.toeicAssessment?.components ?? [];
  const groups: any[] = lr?.groups ?? [];
  const exercises: any[] =
    components.find((component) => component.kind === 'SPEAKING')
      ?.speakingPracticeSet?.exercises ?? [];
  const items: any[] =
    components.find((component) => component.kind === 'WRITING')?.writingSet
      ?.items ?? [];
  return (
    groups.filter((group) => group.part === 1 && !group.imageUrl).length +
    exercises.filter(
      (exercise) =>
        exercise.taskType === 'DESCRIBE_PICTURE' && !exercise.imageUrl,
    ).length +
    items.filter(
      (item) =>
        item.taskKind === 'PICTURE_SENTENCE' &&
        !item.writingQuiz?.questions?.[0]?.content?.imageUrl,
    ).length
  );
}

/**
 * Internal sources of a draft exam stay drafts until publish() takes them live,
 * so readiness judges their content. Once the exam is live they must be too.
 */
function sourceCounts(status: unknown, draftExam: boolean) {
  if (status === QuizPublicationStatus.PUBLISHED) return true;
  return draftExam && status === QuizPublicationStatus.DRAFT;
}

@Injectable()
export class GenericExamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly skillCms: SkillCmsService,
    @Optional() private readonly uploadService?: UploadService,
  ) {}

  listTemplates() {
    return EXAM_TEMPLATES.map(
      ({
        key,
        familyCode,
        variantCode,
        displayName,
        authoringEnabled,
        sections,
      }) => ({
        key,
        familyCode,
        variantCode,
        displayName,
        authoringEnabled,
        sections,
      }),
    );
  }

  private include = {
    toeicExamSet: {
      include: {
        groups: {
          include: { questions: { orderBy: { questionNumber: 'asc' } } },
          orderBy: { groupOrder: 'asc' },
        },
        _count: { select: { attempts: true } },
      },
    },
    toeicAssessment: {
      include: {
        components: {
          orderBy: { order: 'asc' },
          include: {
            lrExamSet: {
              include: {
                groups: {
                  include: {
                    questions: { orderBy: { questionNumber: 'asc' } },
                  },
                  orderBy: { groupOrder: 'asc' },
                },
              },
            },
            speakingPracticeSet: {
              include: {
                exercises: {
                  include: { stimulus: true },
                  orderBy: { order: 'asc' },
                },
              },
            },
            writingSet: {
              include: {
                items: {
                  include: { writingQuiz: { include: { questions: true } } },
                  orderBy: { order: 'asc' },
                },
              },
            },
          },
        },
        _count: { select: { attempts: true } },
      },
    },
  } satisfies Prisma.ExamInclude;

  private resolveRequestedVariant(dto: CreateGenericExamDto) {
    const familyCode = (dto.familyCode ?? dto.family ?? 'TOEIC').toUpperCase();
    const variantCode = (
      dto.variantCode ??
      dto.variant ??
      (dto.type === 'FULL_TEST' || dto.type === 'PRACTICE_BY_PART'
        ? 'TOEIC_LR'
        : undefined) ??
      'TOEIC_LR'
    ).toUpperCase();
    return { familyCode, variantCode };
  }

  private async findExam(id: number) {
    const exam = await this.prisma.exam.findUnique({
      where: { id },
      include: this.include,
    });
    if (!exam) throw new NotFoundException(`Exam với ID ${id} không tồn tại`);
    return exam as ProductRecord;
  }

  /**
   * True once a learner has attempted this Exam (L&R or TOEIC assessment
   * attempts) — the single source of truth for every lifecycle guard below.
   * An Exam with attempts must keep its historical content/structure and
   * publication semantics; mutation goes through Duplicate instead.
   */
  async hasLearnerAttempts(exam: ProductRecord): Promise<boolean> {
    const [lrAttempt, assessmentAttempt] = await Promise.all([
      exam.toeicExamSet
        ? this.prisma.toeicAttempt.findFirst({
            where: { examId: exam.toeicExamSet.id },
            select: { id: true },
          })
        : Promise.resolve(null),
      exam.toeicAssessment
        ? this.prisma.toeicAssessmentAttempt.findFirst({
            where: { assessmentId: exam.toeicAssessment.id },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);
    return Boolean(lrAttempt || assessmentAttempt);
  }

  /** Blocks any action that would change already-published, attempted content. */
  private async assertExamCanReturnToDraft(exam: ProductRecord) {
    if (await this.hasLearnerAttempts(exam)) {
      // Structured, not just a string: the Admin UI uses offerNewVersion to
      // swap the "Chuyển về bản nháp" CTA for "Tạo phiên bản mới" without
      // string-matching the message.
      throw new ConflictException({
        message:
          'Đề đã có học viên làm bài, không thể chuyển về bản nháp hoặc chỉnh sửa nội dung. Hãy dùng "Tạo phiên bản mới" để chỉnh sửa mà không ảnh hưởng lịch sử.',
        code: 'EXAM_HAS_ATTEMPTS',
        offerNewVersion: true,
        examId: exam.id,
      });
    }
  }

  async resolveToeicExamId(id: number) {
    const root = await this.prisma.exam.findUnique({
      where: { id },
      select: { toeicExamSet: { select: { id: true } } },
    });
    if (root?.toeicExamSet) return root.toeicExamSet.id;
    const direct = await this.prisma.toeicExamSet.findUnique({
      where: { id },
      select: { id: true },
    });
    if (direct) return direct.id;
    throw new NotFoundException(`Đề TOEIC với ID ${id} không tồn tại`);
  }

  private speakingReady(
    source: any,
    template: ExamTemplate,
    draftExam = false,
  ) {
    const tasks =
      template.sections.find((section) => section.code === 'SPEAKING')?.tasks ??
      TOEIC_SPEAKING_TASK_SEQUENCE;
    const exercises = [...(source?.exercises ?? [])].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0),
    );
    if (
      !source ||
      source.scope !== SpeakingPracticeScope.EXAM_INTERNAL ||
      !sourceCounts(source.publicationStatus, draftExam) ||
      exercises.length !== 11
    )
      return false;
    return (
      exercises.every(
        (exercise, index) =>
          sourceCounts(exercise.publicationStatus, draftExam) &&
          exercise.taskType === tasks[index],
      ) && toeicSpeakingContractErrors(source).length === 0
    );
  }

  private writingReady(source: any, draftExam = false) {
    if (
      !source ||
      !sourceCounts(source.publicationStatus, draftExam) ||
      source.items?.length !== 8
    )
      return false;
    return source.items.every((item: any) => {
      const quiz = item.writingQuiz;
      if (!sourceCounts(quiz?.publicationStatus, draftExam)) return false;
      if (item.taskKind !== 'PICTURE_SENTENCE') return true;
      const content = quiz.questions?.[0]?.content as
        { imageUrl?: unknown } | undefined;
      return isAcceptedContentImageReference(content?.imageUrl);
    });
  }

  private lrSource(exam: ProductRecord) {
    const assessmentSource = exam.toeicAssessment?.components?.find(
      (component: any) => component.kind === 'LISTENING_READING',
    )?.lrExamSet;
    return exam.variantCode === 'TOEIC_4_SKILLS'
      ? (assessmentSource ?? exam.toeicExamSet)
      : (exam.toeicExamSet ?? assessmentSource);
  }

  private productReadiness(exam: ProductRecord) {
    const template = resolveTemplateByKey(exam.templateKey);
    const lr = this.lrSource(exam);
    const lrValidation = lr
      ? validateToeicExam(lr)
      : {
          learnerReady: false,
          issues: [
            {
              code: 'MISSING_LR',
              message: 'Chưa có nguồn Listening & Reading',
              humanMessage: 'Đề chưa có nguồn Listening & Reading.',
            },
          ],
          counts: { total: 0, listening: 0, reading: 0, groups: 0 },
        };
    // Admin-facing issues always carry a human Vietnamese message + part/
    // group/question navigation coordinates — never the raw technical code
    // (MISSING_AUDIO, "Group ID: 128") on its own.
    if (lr) {
      lrValidation.issues = humanizeToeicValidationIssues(
        lr,
        lrValidation.issues,
      );
    }
    const components = exam.toeicAssessment?.components ?? [];
    const speaking = components.find(
      (component: any) => component.kind === 'SPEAKING',
    )?.speakingPracticeSet;
    const writing = components.find(
      (component: any) => component.kind === 'WRITING',
    )?.writingSet;
    const hasLr =
      template.variantCode === 'TOEIC_LR' ||
      template.variantCode === 'TOEIC_4_SKILLS';
    const hasSpeaking =
      template.variantCode === 'TOEIC_SW' ||
      template.variantCode === 'TOEIC_4_SKILLS';
    const hasWriting = hasSpeaking;
    const draftExam = exam.publicationStatus === QuizPublicationStatus.DRAFT;
    const readiness = {
      listeningReading: hasLr
        ? lrValidation.learnerReady && lrSourceIsLive(lr, exam.toeicExamSet?.id)
        : undefined,
      speaking: hasSpeaking
        ? this.speakingReady(speaking, template, draftExam)
        : undefined,
      writing: hasWriting ? this.writingReady(writing, draftExam) : undefined,
    };
    const learnerReady = Object.values(readiness).every(
      (value) => value !== false,
    );
    return {
      template,
      readiness,
      learnerReady,
      lrValidation,
      speakingCount: speaking?.exercises?.length ?? 0,
      writingCount: writing?.items?.length ?? 0,
    };
  }

  /**
   * Deterministic "Kiểm tra sẵn sàng" summary — one row per section, each
   * with a readiness state and an issue count. No AI call; pure counting
   * over the same issues/booleans productReadiness() already computed.
   */
  private buildReadinessSummary(
    exam: ProductRecord,
    readiness: ReturnType<GenericExamService['productReadiness']>,
  ) {
    const issues = (readiness.lrValidation.issues ?? []) as Array<{
      part?: number;
    }>;
    const listeningIssues = issues.filter(
      (issue) => issue.part !== undefined && issue.part <= 4,
    ).length;
    const readingIssues = issues.filter(
      (issue) => issue.part !== undefined && issue.part >= 5,
    ).length;
    const structuralIssues = issues.length - listeningIssues - readingIssues;

    const rows: Array<{
      key: string;
      label: string;
      state: 'READY' | 'WARNING' | 'INCOMPLETE';
      issueCount: number;
    }> = [
      {
        key: 'info',
        label: 'Thông tin đề',
        state: exam.title ? 'READY' : 'INCOMPLETE',
        issueCount: 0,
      },
      {
        key: 'structure',
        label: 'Cấu trúc',
        state: structuralIssues > 0 ? 'WARNING' : 'READY',
        issueCount: structuralIssues,
      },
    ];
    if (readiness.readiness.listeningReading !== undefined) {
      rows.push(
        {
          key: 'listening',
          label: 'Listening',
          state:
            listeningIssues > 0
              ? 'WARNING'
              : readiness.readiness.listeningReading
                ? 'READY'
                : 'INCOMPLETE',
          issueCount: listeningIssues,
        },
        {
          key: 'reading',
          label: 'Reading',
          state:
            readingIssues > 0
              ? 'WARNING'
              : readiness.readiness.listeningReading
                ? 'READY'
                : 'INCOMPLETE',
          issueCount: readingIssues,
        },
      );
    }
    if (readiness.readiness.speaking !== undefined) {
      rows.push({
        key: 'speaking',
        label: 'Speaking',
        state: readiness.readiness.speaking ? 'READY' : 'INCOMPLETE',
        issueCount: readiness.readiness.speaking ? 0 : 1,
      });
    }
    if (readiness.readiness.writing !== undefined) {
      rows.push({
        key: 'writing',
        label: 'Writing',
        state: readiness.readiness.writing ? 'READY' : 'INCOMPLETE',
        issueCount: readiness.readiness.writing ? 0 : 1,
      });
    }
    return rows;
  }

  private project(exam: ProductRecord) {
    const readiness = this.productReadiness(exam);
    const child = this.lrSource(exam);
    const assessment = exam.toeicAssessment;
    const lrQuestions =
      child?.groups?.reduce(
        (total: number, group: any) => total + (group.questions?.length ?? 0),
        0,
      ) ?? 0;
    const taskQuestions =
      (readiness.speakingCount ?? 0) + (readiness.writingCount ?? 0);
    const totalQuestions =
      exam.variantCode === 'TOEIC_SW' ? taskQuestions : lrQuestions;
    return {
      id: exam.id,
      title: exam.title,
      description: exam.description,
      familyCode: exam.familyCode,
      variantCode: exam.variantCode,
      family: exam.familyCode,
      variant: exam.variantCode,
      templateKey: exam.templateKey,
      publicationStatus: exam.publicationStatus,
      createdAt: exam.createdAt,
      updatedAt: exam.updatedAt,
      childId: child?.id ?? assessment?.id ?? null,
      runtimeId: child?.id ?? assessment?.id ?? null,
      type: child?.type,
      difficulty: child?.difficulty,
      durationSeconds:
        child?.durationSeconds ??
        (exam.variantCode === 'TOEIC_SW' ? 4800 : undefined),
      groups: child?.groups ?? [],
      // A 4-skill exam may read another exam's L&R, which it cannot edit.
      lrEditable: Boolean(exam.toeicExamSet),
      missingImageCount: countMissingImages(exam, child),
      totalGroups: child?.groups?.length ?? 0,
      totalQuestions,
      questionsCount: totalQuestions,
      bilingualContent: {
        examFormat: exam.variantCode,
        examSetId: child?.id ?? null,
      },
      attemptsCount:
        child?._count?.attempts ?? assessment?._count?.attempts ?? 0,
      learnerReady: readiness.learnerReady,
      validation: readiness.lrValidation,
      readiness: {
        ...readiness.readiness,
        speakingCount: readiness.speakingCount,
        speakingExpected:
          readiness.template.variantCode === 'TOEIC_LR' ? 0 : 11,
        writingCount: readiness.writingCount,
        writingExpected: readiness.template.variantCode === 'TOEIC_LR' ? 0 : 8,
      },
      // Deterministic, zero-AI-call readiness summary for the Studio
      // "Kiểm tra" tab / outline header — code, not a model, decides this.
      readinessSummary: this.buildReadinessSummary(exam, readiness),
      aiGenerationJobId: exam.aiGenerationJobId ?? null,
      assessment: assessment
        ? {
            id: assessment.id,
            productFamily: assessment.productFamily,
            components: assessment.components.map((component: any) => ({
              id: component.id,
              kind: component.kind,
              order: component.order,
              required: component.required,
              sourceId:
                component.lrExamSetId ??
                component.speakingPracticeSetId ??
                component.writingSetId ??
                null,
            })),
          }
        : null,
    };
  }

  /**
   * All exams, or with `query.page` one filtered page plus header counts.
   * Audio playback URLs are signed only for the exams returned.
   */
  async listAdmin(query: ListQuery = {}) {
    const exams = await this.prisma.exam.findMany({
      include: this.include,
      orderBy: { updatedAt: 'desc' },
    });
    const projected = exams.map((exam) => this.project(exam));
    if (!wantsPage(query))
      return Promise.all(projected.map((exam) => this.withAdminPlayback(exam)));
    const page = pageOf(filterExamList(projected, query), query, 12);
    return {
      ...page,
      items: await Promise.all(
        page.items.map((exam) => this.withAdminPlayback(exam)),
      ),
      facets: examListFacets(projected),
    };
  }

  /**
   * A migrated clip's `audioUrl` is a private-bucket key: it stays as is (the
   * editor saves it back unchanged) and the admin player gets a short-lived
   * signed `audioPlaybackUrl` beside it. Legacy URLs are left alone.
   */
  private async withAdminPlayback<T extends { groups?: unknown }>(
    projection: T,
  ): Promise<T> {
    if (!Array.isArray(projection.groups)) return projection;
    const groups = await Promise.all(
      projection.groups.map(async (group: { audioUrl?: string | null }) => {
        if (!group?.audioUrl || !isPrivateListeningMediaKey(group.audioUrl))
          return group;
        const audioPlaybackUrl = this.uploadService
          ? await this.uploadService
              .getPrivatePresignedDownloadUrl(group.audioUrl, 3600)
              .catch(() => null)
          : null;
        return { ...group, audioPlaybackUrl };
      }),
    );
    return { ...projection, groups };
  }

  /**
   * Learner-facing product card: an explicit allowlist of catalog metadata.
   * `project()` also carries the authoring view (question groups with
   * answer keys and explanations, validation, readiness), which must never
   * leave the admin API: exam content reaches learners only inside an
   * attempt (`/toeic/attempts/:id`, assessment components).
   */
  private projectLearner(exam: ProductRecord) {
    const p = this.project(exam);
    return {
      id: p.id,
      title: p.title,
      description: p.description,
      familyCode: p.familyCode,
      variantCode: p.variantCode,
      family: p.family,
      variant: p.variant,
      templateKey: p.templateKey,
      publicationStatus: p.publicationStatus,
      updatedAt: p.updatedAt,
      childId: p.childId,
      runtimeId: p.runtimeId,
      type: p.type,
      difficulty: p.difficulty,
      durationSeconds: p.durationSeconds,
      totalGroups: p.totalGroups,
      totalQuestions: p.totalQuestions,
      questionsCount: p.questionsCount,
      bilingualContent: p.bilingualContent,
      attemptsCount: p.attemptsCount,
      learnerReady: p.learnerReady,
      assessment: p.assessment,
    };
  }

  async listLearner() {
    const exams = await this.prisma.exam.findMany({
      where: { publicationStatus: QuizPublicationStatus.PUBLISHED },
      include: this.include,
      orderBy: { updatedAt: 'desc' },
    });
    return exams
      .map((exam) => this.projectLearner(exam))
      .filter((exam) => exam.learnerReady);
  }

  /** Other exams that would disappear with this exam's L&R part. */
  private async examsSharingLr(exam: ProductRecord) {
    const set = exam.toeicExamSet;
    if (!set) return 0;
    return this.prisma.toeicAssessmentComponent.count({
      where: { lrExamSetId: set.id, assessment: { examId: { not: exam.id } } },
    });
  }

  async getAdmin(id: number) {
    const exam = await this.findExam(id);
    const job = exam.aiGenerationJobId
      ? await this.prisma.aiGenerationJob.findUnique({
          where: { id: exam.aiGenerationJobId },
          select: { status: true },
        })
      : null;
    return {
      ...(await this.withAdminPlayback(this.project(exam))),
      sharedLrExams: await this.examsSharingLr(exam),
      // Once applied, the AI draft has nothing left to review.
      aiReviewPending: job?.status === AiGenerationJobStatus.GENERATED,
    };
  }

  /**
   * Phase G — "Xem như học viên" preview DTO for Admin only. Strictly
   * excludes answer keys, grading rubrics and AI-internal provenance.
   * Read-only; creates no ExamAttempt/ToeicAssessmentAttempt and triggers
   * no gamification/quest/streak side effects
   * (EXAM_LEARNER_PREVIEW_CREATES_ATTEMPT=false).
   */
  async getLearnerPreview(id: number) {
    const exam = await this.findExam(id);

    const lrSet = this.lrSource(exam);
    const playable = lrSet
      ? await this.withAdminPlayback({ groups: lrSet.groups })
      : null;
    const lr = playable
      ? {
          groups: (playable.groups as any[]).map((group) => ({
            id: group.id,
            part: group.part,
            groupOrder: group.groupOrder,
            imageUrl: group.imageUrl,
            // Listening scripts stay hidden, exactly as in a real attempt.
            passageText: group.part <= 4 ? null : group.passageText,
            hasAudio: !!group.audioUrl,
            audioSrc: group.audioPlaybackUrl ?? group.audioUrl ?? null,
            questions: group.questions.map((question: any) =>
              learnerPreviewQuestion(group.part, question),
            ),
          })),
        }
      : null;

    const speaking = exam.toeicAssessment?.components
      ?.find((c: any) => c.speakingPracticeSet)
      ?.speakingPracticeSet?.exercises?.map((exercise: any) => ({
        id: exercise.id,
        order: exercise.order,
        title: exercise.title,
        targetText: exercise.targetText,
        taskType: exercise.taskType,
        imageUrl: exercise.imageUrl,
        audioUrl: exercise.audioUrl,
        stimulusText: exercise.stimulus?.content ?? null,
      }));

    const writing = exam.toeicAssessment?.components
      ?.find((c: any) => c.writingSet)
      ?.writingSet?.items?.map((item: any) => {
        const content = (item.writingQuiz?.questions?.[0]?.content ?? {}) as {
          prompt?: string;
          taskType?: string;
          imageUrl?: string;
          keywords?: string[];
          wordRange?: unknown;
        };
        return {
          id: item.id,
          order: item.order,
          taskKind: item.taskKind,
          prompt: content.prompt ?? null,
          taskType: content.taskType ?? null,
          imageUrl: content.imageUrl ?? null,
          keywords: content.keywords ?? [],
          wordRange: content.wordRange ?? null,
        };
      });

    return {
      examId: exam.id,
      title: exam.title,
      preview: true,
      lr,
      speaking: speaking ?? null,
      writing: writing ?? null,
    };
  }

  private async speakingContext(id: number) {
    const exam = await this.prisma.exam.findUnique({
      where: { id },
      select: {
        id: true,
        variantCode: true,
        toeicAssessment: {
          select: {
            components: {
              where: { kind: 'SPEAKING' },
              select: { speakingPracticeSetId: true },
            },
          },
        },
      },
    });
    if (!exam) throw new NotFoundException(`Exam với ID ${id} không tồn tại`);
    if (!['TOEIC_SW', 'TOEIC_4_SKILLS'].includes(exam.variantCode)) {
      throw new BadRequestException(
        'Exam này không có nguồn Speaking contextual',
      );
    }
    const setId = exam.toeicAssessment?.components[0]?.speakingPracticeSetId;
    if (!setId) throw new NotFoundException('Exam chưa có nguồn Speaking');
    const set = await this.prisma.speakingPracticeSet.findUnique({
      where: { id: setId },
      select: { id: true, scope: true },
    });
    if (!set || set.scope !== SpeakingPracticeScope.EXAM_INTERNAL) {
      throw new NotFoundException('Nguồn Speaking Exam không tồn tại');
    }
    return { exam, setId };
  }

  async getSpeakingAuthoring(id: number, user: { id: number; role: any }) {
    const { setId } = await this.speakingContext(id);
    return this.skillCms.get('speaking', setId, user, true);
  }

  async listSpeakingStimuli(id: number, user: { id: number; role: any }) {
    await this.speakingContext(id);
    return this.skillCms.listSpeakingStimuli(user);
  }

  async createSpeakingStimulus(
    id: number,
    dto: SpeakingStimulusDto,
    user: { id: number; role: any },
  ) {
    await this.speakingContext(id);
    return this.skillCms.createSpeakingStimulus(dto, user);
  }

  async createSpeakingExercise(
    id: number,
    dto: SpeakingExerciseDto,
    user: { id: number; role: any },
  ) {
    const { setId } = await this.speakingContext(id);
    return this.skillCms.addSpeakingExercise('speaking', setId, dto, user);
  }

  async updateSpeakingExercise(
    id: number,
    exerciseId: number,
    dto: SpeakingExerciseDto,
    user: { id: number; role: any },
  ) {
    const { setId } = await this.speakingContext(id);
    return this.skillCms.updateSpeakingExercise(
      'speaking',
      setId,
      String(exerciseId),
      dto,
      user,
    );
  }

  async reorderSpeakingExercises(
    id: number,
    dto: SpeakingExerciseReorderDto,
    user: { id: number; role: any },
  ) {
    const { setId } = await this.speakingContext(id);
    return this.skillCms.reorderSpeakingExercises('speaking', setId, dto, user);
  }

  async deleteSpeakingExercise(
    id: number,
    exerciseId: number,
    user: { id: number; role: any },
  ) {
    const { setId } = await this.speakingContext(id);
    return this.skillCms.deleteSpeakingExercise(
      'speaking',
      setId,
      String(exerciseId),
      user,
    );
  }

  async publishSpeakingSource(id: number, user: { id: number; role: any }) {
    const { setId } = await this.speakingContext(id);
    return this.skillCms.publish(
      'speaking',
      setId,
      QuizPublicationStatus.PUBLISHED,
      user,
    );
  }

  async getLearner(id: number) {
    const exam = await this.findExam(id);
    const projected = this.projectLearner(exam);
    if (
      exam.publicationStatus !== QuizPublicationStatus.PUBLISHED ||
      !projected.learnerReady
    ) {
      throw new NotFoundException('Exam chưa sẵn sàng cho học viên');
    }
    return projected;
  }

  async createDraft(dto: CreateGenericExamDto, createdBy?: number) {
    const { familyCode, variantCode } = this.resolveRequestedVariant(dto);
    const template = resolveExamTemplate(familyCode, variantCode);
    const title = dto.title.trim();

    return this.prisma.$transaction(async (tx) => {
      const exam = await tx.exam.create({
        data: {
          title,
          description: dto.description,
          familyCode,
          variantCode,
          templateKey: template.key,
          createdBy,
          publicationStatus: QuizPublicationStatus.DRAFT,
        },
      });

      const createLr =
        variantCode === 'TOEIC_LR' || variantCode === 'TOEIC_4_SKILLS';
      let lr: any = null;
      if (createLr) {
        lr = await tx.toeicExamSet.create({
          data: {
            title,
            description: dto.description,
            type: dto.type === 'FULL_TEST' ? 'FULL_TEST' : 'PRACTICE_BY_PART',
            difficulty: dto.difficulty ?? 'medium',
            durationSeconds: dto.durationSeconds ?? 7200,
            createdBy,
            examId: exam.id,
            publicationStatus: QuizPublicationStatus.DRAFT,
          },
        });
      }

      if (variantCode === 'TOEIC_SW' || variantCode === 'TOEIC_4_SKILLS') {
        const category = await tx.speakingCategory.findFirst({
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
        });
        if (!category)
          throw new ConflictException(
            'Chưa có taxonomy Speaking để tạo nguồn nội bộ',
          );
        const speaking = await tx.speakingPracticeSet.create({
          data: {
            id: `exam-${exam.id}-speaking`,
            title: `${title} — Speaking`,
            description:
              'Nguồn Speaking nội bộ của đề thi; chưa có câu hỏi production.',
            category: category.code,
            categoryId: category.id,
            level: 'B1-C1',
            scope: SpeakingPracticeScope.EXAM_INTERNAL,
            publicationStatus: QuizPublicationStatus.DRAFT,
          },
        });
        const writing = await tx.toeicWritingSet.create({
          data: {
            title: `${title} — Writing`,
            description:
              'Nguồn Writing nội bộ của đề thi; chưa có câu hỏi production.',
            createdBy,
            publicationStatus: QuizPublicationStatus.DRAFT,
          },
        });
        const components: Prisma.ToeicAssessmentComponentCreateManyInput[] = [
          ...(lr
            ? [
                {
                  kind: 'LISTENING_READING' as const,
                  order: 1,
                  required: true,
                  assessmentId: 0,
                  lrExamSetId: lr.id,
                },
              ]
            : []),
          {
            kind: 'SPEAKING',
            order: lr ? 2 : 1,
            required: true,
            assessmentId: 0,
            speakingPracticeSetId: speaking.id,
          },
          {
            kind: 'WRITING',
            order: lr ? 3 : 2,
            required: true,
            assessmentId: 0,
            writingSetId: writing.id,
          },
        ];
        const assessment = await tx.toeicAssessment.create({
          data: {
            title,
            description: dto.description,
            productFamily:
              variantCode === 'TOEIC_SW' ? 'TOEIC_SW' : 'TOEIC_4_SKILLS',
            createdBy,
            examId: exam.id,
            publicationStatus: QuizPublicationStatus.DRAFT,
            components: {
              create: components.map((component) => {
                const { assessmentId, ...withoutAssessmentId } = component;
                void assessmentId;
                return withoutAssessmentId;
              }),
            },
          },
          include: { components: true },
        });
        return {
          ...this.project({
            ...exam,
            toeicExamSet: lr,
            toeicAssessment: assessment,
          }),
          id: exam.id,
        };
      }
      return this.project({ ...exam, toeicExamSet: lr, toeicAssessment: null });
    });
  }

  async update(id: number, dto: UpdateGenericExamDto) {
    const exam = await this.findExam(id);
    const child = exam.toeicExamSet;
    const updated = await this.prisma.exam.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
      },
      include: this.include,
    });
    if (child) {
      await this.prisma.toeicExamSet.update({
        where: { id: child.id },
        data: {
          ...(dto.title !== undefined && { title: dto.title }),
          ...(dto.description !== undefined && {
            description: dto.description,
          }),
          ...(dto.type !== undefined && { type: dto.type as any }),
          ...(dto.difficulty !== undefined && { difficulty: dto.difficulty }),
          ...(dto.durationSeconds !== undefined && {
            durationSeconds: dto.durationSeconds,
          }),
        },
      });
    }
    if (dto.title !== undefined) await this.renameSources(exam, dto.title);
    return this.project(updated);
  }

  /** Learners read the assessment's title, not the exam's. */
  private async renameSources(exam: ProductRecord, title: string) {
    const assessment = exam.toeicAssessment;
    if (!assessment) return;
    await this.prisma.toeicAssessment.update({
      where: { id: assessment.id },
      data: { title },
    });
    const components: any[] = assessment.components ?? [];
    const speaking = components.find(
      (component) => component.kind === 'SPEAKING',
    )?.speakingPracticeSet;
    const writing = components.find(
      (component) => component.kind === 'WRITING',
    )?.writingSet;
    if (speaking)
      await this.prisma.speakingPracticeSet.update({
        where: { id: speaking.id },
        data: { title: `${title} — Speaking` },
      });
    if (writing)
      await this.prisma.toeicWritingSet.update({
        where: { id: writing.id },
        data: { title: `${title} — Writing` },
      });
  }

  async publish(id: number) {
    const exam = await this.findExam(id);
    const readiness = this.productReadiness(exam);
    if (!readiness.learnerReady) {
      throw new BadRequestException({
        message: 'Exam chưa đủ điều kiện xuất bản',
        issues: readiness.lrValidation.issues,
        readiness: readiness.readiness,
      });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.exam.update({
        where: { id },
        data: { publicationStatus: QuizPublicationStatus.PUBLISHED },
      });
      if (exam.toeicExamSet && this.lrSource(exam)?.id === exam.toeicExamSet.id)
        await tx.toeicExamSet.update({
          where: { id: exam.toeicExamSet.id },
          data: { publicationStatus: QuizPublicationStatus.PUBLISHED },
        });
      if (exam.toeicAssessment)
        await tx.toeicAssessment.update({
          where: { id: exam.toeicAssessment.id },
          data: { publicationStatus: QuizPublicationStatus.PUBLISHED },
        });
      await this.publishInternalSources(tx, exam);
    });
    return this.getAdmin(id);
  }

  /** Speaking and Writing belong to the exam, so they go live with it. */
  private async publishInternalSources(
    tx: Prisma.TransactionClient,
    exam: ProductRecord,
  ) {
    const components: any[] = exam.toeicAssessment?.components ?? [];
    const speaking = components.find(
      (component) => component.kind === 'SPEAKING',
    )?.speakingPracticeSet;
    const writing = components.find(
      (component) => component.kind === 'WRITING',
    )?.writingSet;
    const data = { publicationStatus: QuizPublicationStatus.PUBLISHED };
    if (speaking) {
      await tx.speakingPracticeSet.update({
        where: { id: speaking.id },
        data,
      });
      await tx.speakingExercise.updateMany({
        where: { practiceSetId: speaking.id },
        data,
      });
    }
    if (writing) {
      await tx.quiz.updateMany({
        where: {
          id: { in: writing.items.map((item: any) => item.writingQuizId) },
        },
        data,
      });
      await tx.toeicWritingSet.update({ where: { id: writing.id }, data });
    }
  }

  async unpublish(id: number) {
    const exam = await this.findExam(id);
    await this.assertExamCanReturnToDraft(exam);
    await this.setPublicationStatus(exam, QuizPublicationStatus.DRAFT);
    return this.getAdmin(id);
  }

  /**
   * Stops new attempts on an exam. Unlike unpublish it is allowed after
   * learners have attempted it: their attempts finish and stay reviewable.
   */
  async retire(id: number) {
    const exam = await this.findExam(id);
    if (exam.publicationStatus !== QuizPublicationStatus.PUBLISHED) {
      throw new ConflictException(
        'Chỉ đề đang xuất bản mới có thể ngừng phát hành.',
      );
    }
    await this.setPublicationStatus(exam, QuizPublicationStatus.ARCHIVED);
    return this.getAdmin(id);
  }

  async restore(id: number) {
    const exam = await this.findExam(id);
    if (exam.publicationStatus !== QuizPublicationStatus.ARCHIVED) {
      throw new ConflictException('Đề này không ở trạng thái ngừng phát hành.');
    }
    await this.setPublicationStatus(exam, QuizPublicationStatus.PUBLISHED);
    return this.getAdmin(id);
  }

  private async setPublicationStatus(
    exam: ProductRecord,
    publicationStatus: QuizPublicationStatus,
  ) {
    await this.prisma.$transaction([
      this.prisma.exam.update({
        where: { id: exam.id },
        data: { publicationStatus },
      }),
      ...(exam.toeicExamSet && this.lrSource(exam)?.id === exam.toeicExamSet.id
        ? [
            this.prisma.toeicExamSet.update({
              where: { id: exam.toeicExamSet.id },
              data: { publicationStatus },
            }),
          ]
        : []),
      ...(exam.toeicAssessment
        ? [
            this.prisma.toeicAssessment.update({
              where: { id: exam.toeicAssessment.id },
              data: { publicationStatus },
            }),
          ]
        : []),
    ]);
  }

  async delete(id: number) {
    const exam = await this.findExam(id);
    if (await this.hasLearnerAttempts(exam)) {
      throw new ConflictException(
        'Exam đã có lịch sử làm bài, không thể xóa sản phẩm',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      if (exam.toeicAssessment) {
        await tx.toeicAssessment.delete({
          where: { id: exam.toeicAssessment.id },
        });
      }
      if (exam.toeicExamSet) {
        await tx.toeicExamSet.delete({ where: { id: exam.toeicExamSet.id } });
      }
      await tx.exam.delete({ where: { id } });
    });
    return { success: true, id };
  }

  /**
   * "Tạo phiên bản mới" / "Nhân bản đề" — the lightweight replacement for a
   * full revision system. Clones Exam-owned structure/content (L&R groups
   * and questions; EXAM_INTERNAL Speaking/Writing sources and their items)
   * into a brand-new DRAFT Exam with 0 attempts and a new identity.
   * Never clones: ExamAttempt, answers, scores, submissions, AI job
   * history. The original Exam is left completely unchanged.
   */
  async duplicate(id: number, adminId?: number) {
    const exam = await this.findExam(id);
    const newExamId = await this.prisma.$transaction(async (tx) => {
      const newExam = await tx.exam.create({
        data: {
          title: `${exam.title} — Bản mới`,
          description: exam.description,
          familyCode: exam.familyCode,
          variantCode: exam.variantCode,
          templateKey: exam.templateKey,
          publicationStatus: QuizPublicationStatus.DRAFT,
          createdBy: adminId,
        },
      });

      // A 4-skill exam may read its L&R from another exam; the copy owns its own.
      const lrSource = this.lrSource(exam);
      let newLrId: number | null = null;
      if (lrSource) {
        const newLr = await tx.toeicExamSet.create({
          data: {
            title: `${lrSource.title} — Bản mới`,
            description: lrSource.description,
            type: lrSource.type,
            difficulty: lrSource.difficulty,
            durationSeconds: lrSource.durationSeconds,
            createdBy: adminId,
            examId: newExam.id,
            publicationStatus: QuizPublicationStatus.DRAFT,
          },
        });
        newLrId = newLr.id;
        for (const group of lrSource.groups as any[]) {
          await tx.toeicQuestionGroup.create({
            data: {
              examId: newLr.id,
              part: group.part,
              canonicalAccent: group.canonicalAccent,
              audioUrl: group.audioUrl,
              imageUrl: group.imageUrl,
              passageText: group.passageText,
              transcriptText: group.transcriptText,
              imageBrief: group.imageBrief,
              mediaMetadata: group.mediaMetadata ?? Prisma.JsonNull,
              groupOrder: group.groupOrder,
              questions: {
                create: (group.questions as any[]).map((question) => ({
                  questionNumber: question.questionNumber,
                  text: question.text,
                  options: question.options,
                  correctIndex: question.correctIndex,
                  explanation: question.explanation,
                })),
              },
            },
          });
        }
      }

      if (exam.toeicAssessment) {
        const newAssessment = await tx.toeicAssessment.create({
          data: {
            title: `${exam.toeicAssessment.title} — Bản mới`,
            description: exam.toeicAssessment.description,
            productFamily: exam.toeicAssessment.productFamily,
            createdBy: adminId,
            examId: newExam.id,
            publicationStatus: QuizPublicationStatus.DRAFT,
          },
        });
        for (const component of exam.toeicAssessment.components as any[]) {
          if (component.kind === 'LISTENING_READING' && newLrId) {
            await tx.toeicAssessmentComponent.create({
              data: {
                assessmentId: newAssessment.id,
                kind: 'LISTENING_READING',
                order: component.order,
                required: component.required,
                lrExamSetId: newLrId,
              },
            });
          }
          if (component.kind === 'SPEAKING' && component.speakingPracticeSet) {
            const source = component.speakingPracticeSet;
            const newSpeaking = await tx.speakingPracticeSet.create({
              data: {
                id: `exam-${newExam.id}-speaking`,
                title: `${source.title} — Bản mới`,
                description: source.description,
                category: source.category,
                categoryId: source.categoryId,
                level: source.level,
                scope: source.scope,
                publicationStatus: QuizPublicationStatus.DRAFT,
              },
            });
            for (const exercise of source.exercises as any[]) {
              await tx.speakingExercise.create({
                data: {
                  title: exercise.title,
                  targetText: exercise.targetText,
                  imageUrl: exercise.imageUrl,
                  audioUrl: exercise.audioUrl,
                  isPremiumContent: exercise.isPremiumContent,
                  difficulty: exercise.difficulty,
                  category: exercise.category,
                  taskType: exercise.taskType,
                  categoryId: exercise.categoryId,
                  practiceSetId: newSpeaking.id,
                  order: exercise.order,
                  stimulusId: exercise.stimulusId,
                  publicationStatus: QuizPublicationStatus.DRAFT,
                },
              });
            }
            await tx.toeicAssessmentComponent.create({
              data: {
                assessmentId: newAssessment.id,
                kind: 'SPEAKING',
                order: component.order,
                required: component.required,
                speakingPracticeSetId: newSpeaking.id,
              },
            });
          }
          if (component.kind === 'WRITING' && component.writingSet) {
            const source = component.writingSet;
            const newWriting = await tx.toeicWritingSet.create({
              data: {
                title: `${source.title} — Bản mới`,
                description: source.description,
                publicationStatus: QuizPublicationStatus.DRAFT,
                createdBy: adminId,
              },
            });
            for (const item of source.items as any[]) {
              const sourceQuiz = item.writingQuiz;
              const newQuiz = await tx.quiz.create({
                data: {
                  title: sourceQuiz.title,
                  description: sourceQuiz.description,
                  theoryContent: sourceQuiz.theoryContent,
                  bilingualContent:
                    sourceQuiz.bilingualContent ?? Prisma.JsonNull,
                  type: sourceQuiz.type,
                  isPremiumContent: sourceQuiz.isPremiumContent,
                  publicationStatus: QuizPublicationStatus.DRAFT,
                  timeLimit: sourceQuiz.timeLimit,
                  questions: {
                    create: (sourceQuiz.questions as any[]).map((q) => ({
                      type: q.type,
                      content: q.content ?? Prisma.JsonNull,
                      order: q.order,
                    })),
                  },
                },
              });
              await tx.toeicWritingSetItem.create({
                data: {
                  writingSetId: newWriting.id,
                  order: item.order,
                  taskKind: item.taskKind,
                  writingQuizId: newQuiz.id,
                },
              });
            }
            await tx.toeicAssessmentComponent.create({
              data: {
                assessmentId: newAssessment.id,
                kind: 'WRITING',
                order: component.order,
                required: component.required,
                writingSetId: newWriting.id,
              },
            });
          }
        }
      }

      return newExam.id;
    });
    return this.getAdmin(newExamId);
  }
}
