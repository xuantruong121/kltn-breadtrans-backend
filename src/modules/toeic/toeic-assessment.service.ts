import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { summarizeAssessmentSkills } from './toeic-assessment-result';
import {
  reviewSpeakingTasks,
  reviewWritingTasks,
} from './toeic-assessment-review';
import {
  Prisma,
  QuizPublicationStatus,
  Role,
  SpeakingPracticeScope,
  ToeicAssessmentAttemptComponentStatus,
  ToeicAssessmentAttemptStatus,
  ToeicAssessmentComponentKind,
  ToeicAssessmentProductFamily,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QuizContentAccessService } from '../quiz/quiz-content-access.service';
import {
  CompleteToeicAssessmentComponentDto,
  CreateToeicAssessmentDto,
  SetToeicAssessmentComponentsDto,
  UpdateToeicAssessmentDto,
} from './toeic-assessment.dto';

const FAMILY_KINDS: Record<
  ToeicAssessmentProductFamily,
  ToeicAssessmentComponentKind[]
> = {
  TOEIC_LR: [ToeicAssessmentComponentKind.LISTENING_READING],
  TOEIC_SW: [
    ToeicAssessmentComponentKind.SPEAKING,
    ToeicAssessmentComponentKind.WRITING,
  ],
  TOEIC_4_SKILLS: [
    ToeicAssessmentComponentKind.LISTENING_READING,
    ToeicAssessmentComponentKind.SPEAKING,
    ToeicAssessmentComponentKind.WRITING,
  ],
};

type ComponentInput = SetToeicAssessmentComponentsDto['components'][number];

@Injectable()
export class ToeicAssessmentService {
  constructor(
    private readonly db: PrismaService,
    private readonly quizAccess: QuizContentAccessService,
  ) {}

  async listAdmin() {
    const assessments = await this.db.toeicAssessment.findMany({
      include: this.componentInclude(),
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
    return Promise.all(
      assessments.map((assessment) => this.projectAdmin(assessment)),
    );
  }

  async listLearner(userId: number) {
    const assessments = await this.db.toeicAssessment.findMany({
      where: { publicationStatus: QuizPublicationStatus.PUBLISHED },
      include: this.componentInclude(),
      orderBy: { updatedAt: 'desc' },
    });
    const attempts = await this.db.toeicAssessmentAttempt.findMany({
      where: {
        userId,
        status: {
          in: [
            ToeicAssessmentAttemptStatus.IN_PROGRESS,
            ToeicAssessmentAttemptStatus.COMPLETED,
          ],
        },
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        assessmentId: true,
        status: true,
        startedAt: true,
        completedAt: true,
      },
    });
    const latest = new Map<number, (typeof attempts)[number]>();
    for (const attempt of attempts)
      if (!latest.has(attempt.assessmentId))
        latest.set(attempt.assessmentId, attempt);
    return Promise.all(
      assessments.map(async (assessment) => ({
        id: assessment.id,
        title: assessment.title,
        description: assessment.description,
        productFamily: assessment.productFamily,
        version: assessment.version,
        components: await this.projectComponents(assessment.components),
        attempt: latest.get(assessment.id) ?? null,
      })),
    );
  }

  async getAdmin(id: number) {
    const assessment = await this.findAssessment(id);
    return this.projectAdmin(assessment);
  }

  async getLearnerDetail(id: number, userId: number) {
    const assessment = await this.db.toeicAssessment.findFirst({
      where: { id, publicationStatus: QuizPublicationStatus.PUBLISHED },
      include: this.componentInclude(),
    });
    if (!assessment)
      throw new NotFoundException(
        'Không tìm thấy bài đánh giá TOEIC đã xuất bản',
      );
    const attempt = await this.db.toeicAssessmentAttempt.findFirst({
      where: { assessmentId: id, userId },
      orderBy: { updatedAt: 'desc' },
      include: this.attemptInclude(),
    });
    return {
      id: assessment.id,
      title: assessment.title,
      description: assessment.description,
      productFamily: assessment.productFamily,
      version: assessment.version,
      components: await this.projectComponents(assessment.components),
      attempt: attempt ? this.projectAttempt(attempt) : null,
    };
  }

  async create(dto: CreateToeicAssessmentDto, createdBy?: number) {
    const title = dto.title?.trim();
    if (!title)
      throw new BadRequestException('Tên bài đánh giá không được để trống');
    return this.db.toeicAssessment.create({
      data: {
        title,
        description: dto.description?.trim() || null,
        productFamily: dto.productFamily,
        createdBy: createdBy ?? null,
      },
      include: this.componentInclude(),
    });
  }

  async update(id: number, dto: UpdateToeicAssessmentDto) {
    const assessment = await this.findAssessment(id);
    this.assertDraft(assessment.publicationStatus);
    return this.db.toeicAssessment.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description?.trim() || null }
          : {}),
        ...(dto.productFamily !== undefined
          ? { productFamily: dto.productFamily }
          : {}),
      },
      include: this.componentInclude(),
    });
  }

  async setComponents(id: number, dto: SetToeicAssessmentComponentsDto) {
    const assessment = await this.findAssessment(id);
    this.assertDraft(assessment.publicationStatus);
    await this.assertNoAttempts(id);
    this.assertFamilyComponents(assessment.productFamily, dto.components);
    for (const component of dto.components)
      this.assertComponentSourceShape(component);
    await this.assertSourcesExist(dto.components);

    await this.db.$transaction(async (tx) => {
      await tx.toeicAssessmentComponent.deleteMany({
        where: { assessmentId: id },
      });
      await tx.toeicAssessmentComponent.createMany({
        data: dto.components.map((component) => ({
          assessmentId: id,
          kind: component.kind,
          order: component.order,
          required: component.required ?? true,
          lrExamSetId: component.lrExamSetId ?? null,
          speakingPracticeSetId: component.speakingPracticeSetId ?? null,
          writingSetId: component.writingSetId ?? null,
        })),
      });
    });
    return this.getAdmin(id);
  }

  async publish(id: number) {
    const assessment = await this.findAssessment(id);
    this.assertDraft(assessment.publicationStatus);
    await this.assertPublishable(assessment);
    return this.db.toeicAssessment.update({
      where: { id },
      data: { publicationStatus: QuizPublicationStatus.PUBLISHED },
      include: this.componentInclude(),
    });
  }

  async unpublish(id: number) {
    await this.findAssessment(id);
    if (
      await this.db.toeicAssessmentAttempt.count({
        where: { assessmentId: id },
      })
    ) {
      throw new ConflictException(
        'Bài đánh giá đã có lịch sử; hãy tạo phiên bản mới thay vì gỡ xuất bản',
      );
    }
    return this.db.toeicAssessment.update({
      where: { id },
      data: { publicationStatus: QuizPublicationStatus.DRAFT },
      include: this.componentInclude(),
    });
  }

  async startAttempt(
    assessmentId: number,
    userId: number,
    idempotencyKey?: string,
  ) {
    const assessment = await this.getPublishedAssessment(assessmentId);
    await this.assertLearnerEntitlements(assessment, userId);
    const key = idempotencyKey?.trim() || null;

    const attemptId = await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`toeic-assessment:${assessmentId}:${userId}`}))`;
      if (key) {
        const sameKey = await tx.toeicAssessmentAttempt.findFirst({
          where: { assessmentId, userId, idempotencyKey: key },
        });
        if (sameKey) return sameKey.id;
      }
      const active = await tx.toeicAssessmentAttempt.findFirst({
        where: {
          assessmentId,
          userId,
          status: ToeicAssessmentAttemptStatus.IN_PROGRESS,
        },
        orderBy: { createdAt: 'desc' },
      });
      if (active) return active.id;
      const created = await tx.toeicAssessmentAttempt.create({
        data: {
          assessmentId,
          userId,
          idempotencyKey: key,
          components: {
            create: assessment.components.map((component) => ({
              assessmentComponentId: component.id,
            })),
          },
        },
      });
      return created.id;
    });
    return this.getAttempt(attemptId, userId);
  }

  async getAttempt(attemptId: number, userId: number) {
    const attempt = await this.db.toeicAssessmentAttempt.findUnique({
      where: { id: attemptId },
      include: this.attemptInclude(),
    });
    if (!attempt)
      throw new NotFoundException('Không tìm thấy lượt làm bài đánh giá');
    if (attempt.userId !== userId)
      throw new ForbiddenException(
        'Bạn không có quyền truy cập lượt làm bài này',
      );
    const projected = this.projectAttempt(attempt);
    // Writing submissions are linked only when the section completes, so while
    // it is open "written" is derived the same way completion selects them:
    // this learner's graded submissions of the set's quizzes since the start.
    for (const component of projected.components) {
      if (
        component.kind !== 'WRITING' ||
        component.status === 'COMPLETED' ||
        component.writingQuizIds.length === 0
      )
        continue;
      const row = attempt.components.find((c: any) => c.id === component.id);
      const since = row?.startedAt ?? attempt.startedAt;
      const submissions = await this.db.submission.findMany({
        where: {
          userId,
          quizId: { in: component.writingQuizIds },
          submittedAt: { gte: since },
        },
        select: {
          quizId: true,
          score: true,
          results: { select: { score: true } },
        },
      });
      component.writtenQuizIds = [
        ...new Set(
          submissions
            .filter(
              (s) =>
                s.score !== null || s.results.some((r) => r.score !== null),
            )
            .map((s) => s.quizId),
        ),
      ];
    }
    return projected;
  }

  /**
   * Per-task result review of an attempt: the stored grade of every Speaking
   * and Writing task plus the child L&R attempt id. Read-only: grading is
   * never started or retried from here.
   */
  async getAttemptReview(attemptId: number, userId: number) {
    const attempt = await this.getOwnedAttempt(attemptId, userId);
    const sources = (attempt.assessment as any).components ?? [];
    const components = await Promise.all(
      attempt.components.map(async (component: any) => {
        const kind = component.assessmentComponent.kind;
        const source = sources.find(
          (c: any) => c.id === component.assessmentComponentId,
        );
        const base = {
          id: component.id,
          kind,
          order: component.assessmentComponent.order,
          status: component.status,
          startedAt: component.startedAt,
          completedAt: component.completedAt,
        };
        if (kind === 'LISTENING_READING')
          return {
            ...base,
            childAttemptId: component.toeicAttemptId ?? null,
            childStatus: component.toeicAttempt?.status ?? null,
          };
        // A completed section reviews exactly the submissions linked to it;
        // an open one shows this learner's work since the section started.
        const since = component.startedAt ?? attempt.startedAt;
        if (kind === 'SPEAKING') {
          const exercises = source?.speakingPracticeSet?.exercises ?? [];
          const rows = component.speakingSubmissions?.length
            ? component.speakingSubmissions.map(
                (l: any) => l.speakingSubmission,
              )
            : since
              ? await this.db.speakingSubmission.findMany({
                  where: {
                    userId,
                    exerciseId: { in: exercises.map((e: any) => e.id) },
                    submittedAt: { gte: since },
                  },
                })
              : [];
          return { ...base, tasks: reviewSpeakingTasks(exercises, rows) };
        }
        const items = source?.writingSet?.items ?? [];
        const rows = component.writingSubmissions?.length
          ? component.writingSubmissions.map((l: any) => l.submission)
          : since
            ? await this.db.submission.findMany({
                where: {
                  userId,
                  quizId: { in: items.map((i: any) => i.writingQuizId) },
                  submittedAt: { gte: since },
                },
              })
            : [];
        return { ...base, tasks: reviewWritingTasks(items, rows) };
      }),
    );
    return {
      id: attempt.id,
      assessmentId: attempt.assessmentId,
      assessment: {
        id: attempt.assessment.id,
        title: attempt.assessment.title,
        productFamily: attempt.assessment.productFamily,
      },
      status: attempt.status,
      startedAt: attempt.startedAt,
      completedAt: attempt.completedAt,
      skills: summarizeAssessmentSkills(attempt.components),
      components,
    };
  }

  async startComponent(attemptId: number, componentId: number, userId: number) {
    const attempt = await this.getOwnedAttempt(attemptId, userId);
    const state = attempt.components.find(
      (item) => item.assessmentComponentId === componentId,
    );
    if (!state)
      throw new NotFoundException('Component không thuộc lượt làm bài này');
    if (attempt.status === ToeicAssessmentAttemptStatus.COMPLETED)
      return this.getAttempt(attemptId, userId);

    const component = await this.db.toeicAssessmentComponent.findUnique({
      where: { id: componentId },
    });
    if (!component) throw new NotFoundException('Không tìm thấy component');
    const assessment = await this.getPublishedAssessment(attempt.assessmentId);
    await this.assertLearnerEntitlements(assessment, userId);

    await this.db.$transaction(async (tx) => {
      const current = await tx.toeicAssessmentAttemptComponent.findUnique({
        where: { id: state.id },
      });
      if (
        !current ||
        current.status === ToeicAssessmentAttemptComponentStatus.COMPLETED
      )
        return;
      const data: Prisma.ToeicAssessmentAttemptComponentUpdateInput = {
        status: ToeicAssessmentAttemptComponentStatus.IN_PROGRESS,
        startedAt: current.startedAt ?? new Date(),
      };
      if (
        component.kind === ToeicAssessmentComponentKind.LISTENING_READING &&
        !current.toeicAttemptId
      ) {
        const source = await tx.toeicExamSet.findUnique({
          where: { id: component.lrExamSetId! },
        });
        if (
          !source ||
          source.publicationStatus !== QuizPublicationStatus.PUBLISHED
        )
          throw new BadRequestException('Nguồn L&R chưa sẵn sàng');
        const child = await tx.toeicAttempt.create({
          data: {
            userId,
            examId: source.id,
            mode: 'FULL_TEST',
            status: 'PENDING_START',
            durationSeconds: source.durationSeconds,
          },
        });
        data.toeicAttempt = { connect: { id: child.id } };
      }
      await tx.toeicAssessmentAttemptComponent.update({
        where: { id: current.id },
        data,
      });
    });
    return this.getAttempt(attemptId, userId);
  }

  async completeComponent(
    attemptId: number,
    componentId: number,
    userId: number,
    dto: CompleteToeicAssessmentComponentDto,
  ) {
    const attempt = await this.getOwnedAttempt(attemptId, userId);
    const state = attempt.components.find(
      (item) => item.assessmentComponentId === componentId,
    );
    if (!state)
      throw new NotFoundException('Component không thuộc lượt làm bài này');
    if (state.status === ToeicAssessmentAttemptComponentStatus.COMPLETED)
      return this.getAttempt(attemptId, userId);
    const component = await this.db.toeicAssessmentComponent.findUnique({
      where: { id: componentId },
    });
    if (!component) throw new NotFoundException('Không tìm thấy component');

    await this.db.$transaction(async (tx) => {
      if (component.kind === ToeicAssessmentComponentKind.LISTENING_READING) {
        if (!state.toeicAttemptId)
          throw new BadRequestException('Component L&R chưa được khởi tạo');
        const child = await tx.toeicAttempt.findUnique({
          where: { id: state.toeicAttemptId },
        });
        if (!child || child.userId !== userId || child.status !== 'SUBMITTED')
          throw new BadRequestException('Bài L&R chưa được nộp hoàn tất');
      } else if (component.kind === ToeicAssessmentComponentKind.SPEAKING) {
        await this.attachSpeakingSubmissions(
          tx,
          state.id,
          component.speakingPracticeSetId!,
          userId,
          dto.speakingSubmissionIds ?? [],
          state.startedAt ?? attempt.startedAt,
        );
      } else {
        await this.attachWritingSubmissions(
          tx,
          state.id,
          component.writingSetId!,
          userId,
          dto.writingSubmissionIds ?? [],
          state.startedAt ?? attempt.startedAt,
        );
      }
      await tx.toeicAssessmentAttemptComponent.update({
        where: { id: state.id },
        data: {
          status: ToeicAssessmentAttemptComponentStatus.COMPLETED,
          submittedAt: new Date(),
          completedAt: new Date(),
        },
      });
      await this.completeParentIfReady(tx, attemptId);
    });
    return this.getAttempt(attemptId, userId);
  }

  async history(userId: number) {
    const attempts = await this.db.toeicAssessmentAttempt.findMany({
      where: { userId },
      orderBy: { startedAt: 'desc' },
      include: this.attemptInclude(),
    });
    return attempts.map((attempt) => this.projectAttempt(attempt));
  }

  private componentInclude(): Prisma.ToeicAssessmentInclude {
    return {
      components: {
        orderBy: { order: 'asc' as const },
        include: {
          lrExamSet: true,
          speakingPracticeSet: {
            include: {
              exercises: {
                orderBy: [{ order: 'asc' }, { id: 'asc' }],
                include: { stimulus: { select: { kind: true } } },
              },
            },
          },
          writingSet: {
            include: {
              items: {
                include: { writingQuiz: true },
                orderBy: { order: 'asc' as const },
              },
            },
          },
        },
      },
    };
  }

  private attemptInclude() {
    return {
      assessment: { include: this.componentInclude() },
      components: {
        orderBy: { assessmentComponent: { order: 'asc' as const } },
        include: {
          assessmentComponent: true,
          toeicAttempt: true,
          speakingSubmissions: { include: { speakingSubmission: true } },
          writingSubmissions: {
            include: { submission: { include: { results: true } } },
          },
        },
      },
    } as const;
  }

  private async findAssessment(id: number) {
    const assessment = await this.db.toeicAssessment.findUnique({
      where: { id },
      include: this.componentInclude(),
    });
    if (!assessment)
      throw new NotFoundException('Không tìm thấy bài đánh giá TOEIC');
    return assessment;
  }

  private async getPublishedAssessment(id: number) {
    const assessment = await this.findAssessment(id);
    if (assessment.publicationStatus !== QuizPublicationStatus.PUBLISHED)
      throw new NotFoundException('Bài đánh giá chưa được xuất bản');
    await this.assertPublishable(assessment);
    return assessment;
  }

  private async getOwnedAttempt(id: number, userId: number) {
    const attempt = await this.db.toeicAssessmentAttempt.findUnique({
      where: { id },
      include: this.attemptInclude(),
    });
    if (!attempt)
      throw new NotFoundException('Không tìm thấy lượt làm bài đánh giá');
    if (attempt.userId !== userId)
      throw new ForbiddenException(
        'Bạn không có quyền truy cập lượt làm bài này',
      );
    return attempt;
  }

  private assertDraft(status: QuizPublicationStatus) {
    if (status !== QuizPublicationStatus.DRAFT)
      throw new ConflictException(
        'Chỉ được chỉnh sửa composition ở trạng thái DRAFT',
      );
  }

  private async assertNoAttempts(id: number) {
    if (
      await this.db.toeicAssessmentAttempt.count({
        where: { assessmentId: id },
      })
    ) {
      throw new ConflictException(
        'Composition đã có lịch sử; không thể thay thế component',
      );
    }
  }

  private assertFamilyComponents(
    family: ToeicAssessmentProductFamily,
    components: ComponentInput[],
  ) {
    const expected = FAMILY_KINDS[family];
    const actual = [...components]
      .sort((a, b) => a.order - b.order)
      .map((component) => component.kind);
    if (
      actual.length !== expected.length ||
      actual.some((kind, index) => kind !== expected[index])
    ) {
      throw new BadRequestException(
        `Product family ${family} yêu cầu đúng component: ${expected.join(', ')}`,
      );
    }
    const orders = [...components]
      .sort((a, b) => a.order - b.order)
      .map((component) => component.order);
    if (orders.some((order, index) => order !== index + 1))
      throw new BadRequestException('Thứ tự component phải liên tục từ 1');
  }

  private assertComponentSourceShape(component: ComponentInput) {
    const sources = [
      component.lrExamSetId,
      component.speakingPracticeSetId,
      component.writingSetId,
    ].filter((value) => value !== undefined && value !== null);
    if (sources.length !== 1)
      throw new BadRequestException(
        'Mỗi component phải có đúng một nguồn authoritative',
      );
    if (
      component.kind === ToeicAssessmentComponentKind.LISTENING_READING &&
      component.lrExamSetId === undefined
    )
      throw new BadRequestException('L&R cần lrExamSetId');
    if (
      component.kind === ToeicAssessmentComponentKind.SPEAKING &&
      component.speakingPracticeSetId === undefined
    )
      throw new BadRequestException('Speaking cần speakingPracticeSetId');
    if (
      component.kind === ToeicAssessmentComponentKind.WRITING &&
      component.writingSetId === undefined
    )
      throw new BadRequestException('Writing cần writingSetId');
  }

  private async assertSourcesExist(components: ComponentInput[]) {
    for (const component of components) {
      if (
        component.lrExamSetId &&
        !(await this.db.toeicExamSet.findUnique({
          where: { id: component.lrExamSetId },
          select: { id: true },
        }))
      )
        throw new BadRequestException('Không tìm thấy nguồn L&R');
      if (component.speakingPracticeSetId) {
        const speakingSource = await this.db.speakingPracticeSet.findUnique({
          where: { id: component.speakingPracticeSetId },
          select: { id: true, scope: true },
        });
        if (!speakingSource)
          throw new BadRequestException('Không tìm thấy nguồn Speaking');
        // Standalone Skill Practice content (SKILL_PRACTICE) is open for
        // free learner practice and must never become the authoritative,
        // scored component of a TOEIC assessment — only EXAM_INTERNAL sets
        // are reserved/ring-fenced for exam composition.
        if (speakingSource.scope !== SpeakingPracticeScope.EXAM_INTERNAL)
          throw new BadRequestException(
            'Nguồn Speaking phải là nội dung dành riêng cho đề thi (EXAM_INTERNAL), không được dùng bộ luyện tập kỹ năng độc lập.',
          );
      }
      if (
        component.writingSetId &&
        !(await this.db.toeicWritingSet.findUnique({
          where: { id: component.writingSetId },
          select: { id: true },
        }))
      )
        throw new BadRequestException('Không tìm thấy Writing Set');
    }
  }

  private async assertPublishable(assessment: {
    productFamily: ToeicAssessmentProductFamily;
    components: any[];
  }) {
    this.assertFamilyComponents(
      assessment.productFamily,
      assessment.components.map((component) => ({
        ...component,
        required: component.required,
      })),
    );
    for (const component of assessment.components) {
      const readiness = await this.componentReadiness(component);
      if (!readiness.ready)
        throw new ConflictException(
          `Component #${component.order} chưa sẵn sàng: ${readiness.reason}`,
        );
    }
  }

  private async componentReadiness(component: any) {
    if (component.kind === ToeicAssessmentComponentKind.LISTENING_READING) {
      const source = component.lrExamSet?.groups
        ? component.lrExamSet
        : await this.db.toeicExamSet.findUnique({
            where: { id: component.lrExamSetId },
            include: {
              groups: { include: { questions: { select: { id: true } } } },
            },
          });
      const questionCount =
        source?.groups?.reduce(
          (total: number, group: any) => total + group.questions.length,
          0,
        ) ?? 0;
      return {
        ready:
          source?.publicationStatus === QuizPublicationStatus.PUBLISHED &&
          questionCount > 0,
        sourceTitle: source?.title ?? null,
        // Learner detail renders the real size of each component, so the count
        // is reported here instead of being hardcoded in the frontend.
        itemCount: questionCount,
        reason: !source
          ? 'Thiếu nguồn'
          : source.publicationStatus !== QuizPublicationStatus.PUBLISHED
            ? 'Nguồn chưa PUBLISHED'
            : questionCount === 0
              ? 'Nguồn chưa có câu hỏi'
              : null,
      };
    }
    if (component.kind === ToeicAssessmentComponentKind.SPEAKING) {
      const source = component.speakingPracticeSet?.exercises
        ? component.speakingPracticeSet
        : await this.db.speakingPracticeSet.findUnique({
            where: { id: component.speakingPracticeSetId },
            include: {
              exercises: {
                select: {
                  id: true,
                  title: true,
                  targetText: true,
                  taskType: true,
                  order: true,
                  imageUrl: true,
                  stimulusId: true,
                  stimulus: { select: { kind: true } },
                  publicationStatus: true,
                },
              },
            },
          });
      const exercises = source?.exercises ?? [];
      const coverage = this.speakingCoverage(exercises);
      const allPublished =
        exercises.length > 0 &&
        exercises.every(
          (exercise: any) =>
            exercise.publicationStatus === QuizPublicationStatus.PUBLISHED,
        );
      const valid =
        coverage.total === 11 &&
        coverage.readAloud === 2 &&
        coverage.describePicture === 2 &&
        coverage.respondToQuestions === 3 &&
        coverage.respondUsingInformation === 3 &&
        coverage.expressOpinion === 1 &&
        coverage.authoritativeOrderReady &&
        coverage.slotTaskTypesReady &&
        coverage.describePictureMediaReady &&
        coverage.sharedInformationStimulusReady;
      return {
        ready:
          source?.publicationStatus === QuizPublicationStatus.PUBLISHED &&
          allPublished &&
          valid,
        sourceTitle: source?.title ?? null,
        itemCount: exercises.length,
        coverage,
        reason: !source
          ? 'Thiếu nguồn'
          : source.publicationStatus !== QuizPublicationStatus.PUBLISHED
            ? 'Nguồn chưa PUBLISHED'
            : !allPublished
              ? 'Có exercise chưa PUBLISHED'
              : !valid
                ? 'Thiếu coverage TOEIC Speaking 1–11'
                : null,
      };
    }
    const source =
      component.writingSet ??
      (await this.db.toeicWritingSet.findUnique({
        where: { id: component.writingSetId },
        include: {
          items: {
            include: {
              writingQuiz: { select: { id: true, publicationStatus: true } },
            },
          },
        },
      }));
    const valid =
      source?.publicationStatus === QuizPublicationStatus.PUBLISHED &&
      source.items.length === 8 &&
      source.items.every(
        (item: any) =>
          item.writingQuiz.publicationStatus ===
          QuizPublicationStatus.PUBLISHED,
      );
    return {
      ready: valid,
      sourceTitle: source?.title ?? null,
      itemCount: source?.items.length ?? 0,
      reason: !source
        ? 'Thiếu Writing Set'
        : source.publicationStatus !== QuizPublicationStatus.PUBLISHED
          ? 'Writing Set chưa PUBLISHED'
          : source.items.length !== 8
            ? 'Writing Set cần đúng 8 task'
            : !valid
              ? 'Có writing source chưa PUBLISHED'
              : null,
    };
  }

  private speakingCoverage(
    exercises: Array<{
      order?: number | null;
      taskType?: string | null;
      targetText: string;
      imageUrl?: string | null;
      stimulusId?: number | null;
      stimulus?: { kind: string } | null;
    }>,
  ) {
    const expectedTaskTypes = [
      'READ_ALOUD',
      'READ_ALOUD',
      'DESCRIBE_PICTURE',
      'DESCRIBE_PICTURE',
      'RESPOND_TO_QUESTION',
      'RESPOND_TO_QUESTION',
      'RESPOND_TO_QUESTION',
      'RESPOND_USING_INFORMATION',
      'RESPOND_USING_INFORMATION',
      'RESPOND_USING_INFORMATION',
      'EXPRESS_OPINION',
    ];
    const ordered = exercises
      .slice()
      .sort(
        (a, b) =>
          (a.order ?? Number.MAX_SAFE_INTEGER) -
          (b.order ?? Number.MAX_SAFE_INTEGER),
      );
    const authoritativeOrderReady =
      exercises.length === expectedTaskTypes.length &&
      ordered.every((exercise, index) => exercise.order === index + 1);
    const count = (taskType: string) =>
      exercises.filter((exercise) => exercise.taskType === taskType).length;
    const informationExercises = exercises.filter(
      (exercise) => exercise.taskType === 'RESPOND_USING_INFORMATION',
    );
    const informationStimulusIds = [
      ...new Set(informationExercises.map((exercise) => exercise.stimulusId)),
    ];
    return {
      total: exercises.length,
      readAloud: count('READ_ALOUD'),
      describePicture: count('DESCRIBE_PICTURE'),
      respondToQuestions: count('RESPOND_TO_QUESTION'),
      respondUsingInformation: count('RESPOND_USING_INFORMATION'),
      expressOpinion: count('EXPRESS_OPINION'),
      authoritativeOrderReady,
      slotTaskTypesReady:
        authoritativeOrderReady &&
        ordered.every(
          (exercise, index) => exercise.taskType === expectedTaskTypes[index],
        ),
      describePictureMediaReady: exercises
        .filter((exercise) => exercise.taskType === 'DESCRIBE_PICTURE')
        .every((exercise) => Boolean(exercise.imageUrl?.trim())),
      sharedInformationStimulusReady:
        informationExercises.length === 3 &&
        informationStimulusIds.length === 1 &&
        informationStimulusIds[0] != null &&
        informationExercises.every(
          (exercise) => exercise.stimulus?.kind === 'INFORMATION',
        ),
    };
  }

  private async projectAdmin(assessment: any) {
    return {
      id: assessment.id,
      title: assessment.title,
      description: assessment.description,
      productFamily: assessment.productFamily,
      publicationStatus: assessment.publicationStatus,
      version: assessment.version,
      examId: assessment.examId ?? null,
      components: await this.projectComponents(assessment.components),
      readiness: await Promise.all(
        assessment.components.map((component: any) =>
          this.componentReadiness(component),
        ),
      ),
    };
  }

  private async projectComponents(components: any[]) {
    return Promise.all(
      components.map(async (component) => {
        const readiness = await this.componentReadiness(component);
        return {
          id: component.id,
          kind: component.kind,
          order: component.order,
          required: component.required,
          sourceId:
            component.lrExamSetId ??
            component.speakingPracticeSetId ??
            component.writingSetId,
          sourceTitle: readiness.sourceTitle ?? null,
          itemCount: readiness.itemCount ?? null,
          readiness,
        };
      }),
    );
  }

  private projectAttempt(attempt: any) {
    const assessmentSources = attempt.assessment?.components ?? [];
    const components = attempt.components.map((component: any) => {
      const source = assessmentSources.find(
        (candidate: any) => candidate.id === component.assessmentComponentId,
      );
      return {
        id: component.id,
        assessmentComponentId: component.assessmentComponentId,
        kind: component.assessmentComponent.kind,
        order: component.assessmentComponent.order,
        status: component.status,
        sourceId:
          source?.lrExamSetId ??
          source?.speakingPracticeSetId ??
          source?.writingSetId ??
          null,
        speakingExerciseIds:
          source?.speakingPracticeSet?.exercises?.map((item: any) => item.id) ??
          [],
        writingQuizIds:
          source?.writingSet?.items?.map((item: any) => item.writingQuizId) ??
          [],
        childAttemptId: component.toeicAttemptId ?? null,
        linkedSpeakingSubmissionIds:
          component.speakingSubmissions?.map(
            (link: any) => link.speakingSubmissionId,
          ) ?? [],
        linkedWritingSubmissionIds:
          component.writingSubmissions?.map((link: any) => link.submissionId) ??
          [],
        // Writing tasks already submitted in this attempt, so the learner
        // resumes at the first unwritten task instead of task 1.
        writtenQuizIds: [
          ...new Set<number>(
            (component.writingSubmissions ?? [])
              .map((link: any) => link.submission?.quizId)
              .filter((id: unknown): id is number => Number.isInteger(id)),
          ),
        ],
      };
    });
    return {
      id: attempt.id,
      assessmentId: attempt.assessmentId,
      assessment: {
        id: attempt.assessment.id,
        title: attempt.assessment.title,
        productFamily: attempt.assessment.productFamily,
      },
      status: attempt.status,
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
      completedAt: attempt.completedAt,
      components,
      currentComponent:
        components.find(
          (component: any) =>
            component.status !==
            ToeicAssessmentAttemptComponentStatus.COMPLETED,
        ) ?? null,
      nextComponent:
        components.find(
          (component: any) =>
            component.status !==
            ToeicAssessmentAttemptComponentStatus.COMPLETED,
        ) ?? null,
      result: {
        // Per-skill practice results from graded work; no overall score.
        skills: summarizeAssessmentSkills(attempt.components),
        components: components.map((component: any) => ({
          kind: component.kind,
          status: component.status,
          childAttemptId: component.childAttemptId,
          linkedSpeakingSubmissionCount:
            component.linkedSpeakingSubmissionIds.length,
          linkedWritingSubmissionCount:
            component.linkedWritingSubmissionIds.length,
        })),
      },
    };
  }

  private async assertLearnerEntitlements(assessment: any, userId: number) {
    for (const component of assessment.components) {
      if (component.kind !== ToeicAssessmentComponentKind.WRITING) continue;
      const writingSet =
        component.writingSet ??
        (await this.db.toeicWritingSet.findUnique({
          where: { id: component.writingSetId },
          include: { items: { include: { writingQuiz: true } } },
        }));
      for (const item of writingSet?.items ?? [])
        await this.quizAccess.assertAccess(
          item.writingQuiz,
          userId,
          Role.STUDENT,
        );
    }
  }

  private async attachSpeakingSubmissions(
    tx: Prisma.TransactionClient,
    attemptComponentId: number,
    practiceSetId: string,
    userId: number,
    submissionIds: number[],
    startedAt: Date,
  ) {
    const uniqueIds = [...new Set(submissionIds)];
    const [exercises, submissions] = await Promise.all([
      tx.speakingExercise.findMany({
        where: {
          practiceSetId,
          publicationStatus: QuizPublicationStatus.PUBLISHED,
        },
        select: { id: true },
      }),
      tx.speakingSubmission.findMany({
        where: {
          ...(uniqueIds.length > 0 ? { id: { in: uniqueIds } } : {}),
          exercise: {
            practiceSetId,
            publicationStatus: QuizPublicationStatus.PUBLISHED,
          },
          userId,
          status: 'COMPLETED',
          submittedAt: { gte: startedAt },
        },
        orderBy: { submittedAt: 'desc' },
        select: { id: true, exerciseId: true },
      }),
    ]);
    const latestByExercise = new Map<
      number,
      { id: number; exerciseId: number }
    >();
    for (const submission of submissions)
      if (!latestByExercise.has(submission.exerciseId))
        latestByExercise.set(submission.exerciseId, submission);
    const selectedSubmissions = [...latestByExercise.values()];
    if (
      exercises.length === 0 ||
      (uniqueIds.length > 0 &&
        selectedSubmissions.length !== uniqueIds.length) ||
      selectedSubmissions.length !== exercises.length ||
      !exercises.every((exercise) =>
        selectedSubmissions.some(
          (submission) => submission.exerciseId === exercise.id,
        ),
      )
    )
      throw new BadRequestException(
        'Speaking component chưa có đủ submission hoàn tất',
      );
    await tx.toeicAssessmentSpeakingSubmission.createMany({
      data: selectedSubmissions.map((submission) => ({
        attemptComponentId,
        speakingSubmissionId: submission.id,
      })),
      skipDuplicates: true,
    });
  }

  private async attachWritingSubmissions(
    tx: Prisma.TransactionClient,
    attemptComponentId: number,
    writingSetId: number,
    userId: number,
    submissionIds: number[],
    startedAt: Date,
  ) {
    const uniqueIds = [...new Set(submissionIds)];
    const set = await tx.toeicWritingSet.findUnique({
      where: { id: writingSetId },
      include: { items: { select: { writingQuizId: true } } },
    });
    const submissions = await tx.submission.findMany({
      where: { id: { in: uniqueIds }, userId, submittedAt: { gte: startedAt } },
      include: { results: true },
    });
    const candidateSubmissions = uniqueIds.length
      ? submissions
      : await tx.submission.findMany({
          where: {
            userId,
            submittedAt: { gte: startedAt },
            quizId: {
              in: set?.items.map((item: any) => item.writingQuizId) ?? [],
            },
          },
          orderBy: { submittedAt: 'desc' },
          include: { results: true },
        });
    const byQuiz = new Map<number, any>();
    for (const submission of candidateSubmissions)
      if (
        !byQuiz.has(submission.quizId) &&
        (submission.score !== null ||
          submission.results.some((result: any) => result.score !== null))
      )
        byQuiz.set(submission.quizId, submission);
    const selectedSubmissions = set
      ? set.items
          .map((item: any) => byQuiz.get(item.writingQuizId))
          .filter(Boolean)
      : [];
    const valid = Boolean(
      set &&
      set.items.length === 8 &&
      (uniqueIds.length === 0 || uniqueIds.length === 8) &&
      set.items.every((item) => {
        const submission = byQuiz.get(item.writingQuizId);
        return Boolean(submission);
      }),
    );
    if (!valid)
      throw new BadRequestException(
        'Writing component cần đủ 8 bài đã được chấm',
      );
    await tx.toeicAssessmentWritingSubmission.createMany({
      data: selectedSubmissions.map((submission) => ({
        attemptComponentId,
        submissionId: submission.id,
      })),
      skipDuplicates: true,
    });
  }

  private async completeParentIfReady(
    tx: Prisma.TransactionClient,
    attemptId: number,
  ) {
    const required = await tx.toeicAssessmentAttemptComponent.findMany({
      where: { assessmentAttemptId: attemptId },
      include: { assessmentComponent: true },
    });
    if (
      required.length > 0 &&
      required
        .filter((component) => component.assessmentComponent.required)
        .every(
          (component) =>
            component.status ===
            ToeicAssessmentAttemptComponentStatus.COMPLETED,
        )
    ) {
      await tx.toeicAssessmentAttempt.update({
        where: { id: attemptId },
        data: {
          status: ToeicAssessmentAttemptStatus.COMPLETED,
          submittedAt: new Date(),
          completedAt: new Date(),
        },
      });
    }
  }
}
