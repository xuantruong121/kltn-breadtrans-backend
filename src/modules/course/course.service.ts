import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateCourseDto,
  UpdateCourseDto,
  CreateClassDto,
  UpdateClassDto,
  CreateLessonDto,
  UpdateLessonDto,
  CreateMaterialDto,
  UpdateMaterialDto,
  CreateCourseActivityDto,
  UpdateCourseActivityDto,
  EnrollResponseDto,
} from './dto/course.dto';
import {
  ClassStatus,
  CourseStatus,
  EnrollmentStatus,
  PaymentStatus,
  PlanFeatureKey,
  Role,
} from '@prisma/client';
import { buildCourseCurriculum } from './course-curriculum';
import { SubscriptionService } from '../subscription/subscription.service';
import {
  getCourseLearningProfile,
  getLessonTheory,
} from './course-learning-content';

const COURSE_LIBRARY_ACCESS = 'COURSE_LIBRARY_ACCESS' as PlanFeatureKey;

@Injectable()
export class CourseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionService?: SubscriptionService,
  ) {}

  private async hasLegacyCourseOwnership(userId: number, courseId: number) {
    const owned = await this.prisma.enrollment.findFirst({
      where: {
        userId,
        class: { courseId },
        status: { in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED] },
        payment: { status: PaymentStatus.CONFIRMED },
      },
      select: { id: true },
    });
    return Boolean(owned);
  }

  private async resolveCourseAccess(
    courseId: number,
    userId?: number,
    role?: string,
  ): Promise<{
    canAccess: boolean;
    accessSource: 'ADMIN' | 'PRO_SUBSCRIPTION' | 'LEGACY_PURCHASE' | null;
    requiresPro: boolean;
  }> {
    if (role === Role.ADMIN) {
      return { canAccess: true, accessSource: 'ADMIN', requiresPro: false };
    }
    if (!userId) {
      return { canAccess: false, accessSource: null, requiresPro: true };
    }
    if (
      this.subscriptionService &&
      (await this.subscriptionService.hasFeature(userId, COURSE_LIBRARY_ACCESS))
    ) {
      return {
        canAccess: true,
        accessSource: 'PRO_SUBSCRIPTION',
        requiresPro: false,
      };
    }
    if (await this.hasLegacyCourseOwnership(userId, courseId)) {
      return {
        canAccess: true,
        accessSource: 'LEGACY_PURCHASE',
        requiresPro: false,
      };
    }
    return { canAccess: false, accessSource: null, requiresPro: true };
  }

  private async ensureSelfStudyEnrollment(courseId: number, userId: number) {
    const existing = await this.prisma.enrollment.findFirst({
      where: {
        userId,
        class: { courseId },
        status: { in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED] },
      },
      orderBy: { joinedAt: 'asc' },
    });
    if (existing) return existing;

    return this.prisma.$transaction(async (tx) => {
      const course = await tx.course.findUnique({
        where: { id: courseId },
        select: { title: true },
      });
      if (!course) throw new NotFoundException('Course not found');
      let selfStudy = await tx.class.findFirst({
        where: {
          courseId,
          tuitionFeeVnd: 0,
          status: { in: [ClassStatus.ONGOING, ClassStatus.UPCOMING] },
          name: { startsWith: 'PRO Self Study' },
        },
      });
      if (!selfStudy) {
        selfStudy = await tx.class.create({
          data: {
            courseId,
            name: `PRO Self Study — ${course.title}`,
            tuitionFeeVnd: 0,
            capacity: null,
            status: ClassStatus.ONGOING,
          },
        });
      }
      return tx.enrollment.upsert({
        where: { userId_classId: { userId, classId: selfStudy.id } },
        create: {
          userId,
          classId: selfStudy.id,
          status: EnrollmentStatus.ACTIVE,
          progress: 0,
        },
        update: {},
      });
    });
  }

  private requireAdmin(role: Role) {
    if (role !== Role.ADMIN) {
      throw new ForbiddenException('Chỉ Quản trị viên mới có quyền thao tác');
    }
  }

  async createCourse(dto: CreateCourseDto, user: { id: number; role: Role }) {
    this.requireAdmin(user.role);
    return this.prisma.course.create({
      data: {
        title: dto.title.trim(),
        description: dto.description,
        thumbnail: dto.thumbnail,
        level: dto.level,
        curriculumType: dto.curriculumType,
        status: CourseStatus.DRAFT,
      },
    });
  }

  async getAllCourses(userId?: number, role?: string) {
    if (role === Role.STUDENT && userId) {
      const enrollments = await this.prisma.enrollment.findMany({
        where: {
          userId,
        },
        include: {
          class: {
            include: {
              course: { include: { lessons: { select: { videoUrl: true } } } },
              _count: { select: { enrollments: true } },
            },
          },
        },
        orderBy: { joinedAt: 'desc' },
      });
      return enrollments.map((e) => ({
        classId: e.classId,
        className: e.class.name,
        classStatus: e.class.status,
        startDate: e.class.startDate,
        endDate: e.class.endDate,
        capacity: e.class.capacity,
        progress: e.progress,
        enrollmentStatus: e.status,
        tuitionFeeVnd: e.class.tuitionFeeVnd,
        joinedAt: e.joinedAt,
        studentCount: e.class._count.enrollments,
        course: {
          ...e.class.course,
          lessons:
            e.status === EnrollmentStatus.ACTIVE ||
            e.status === EnrollmentStatus.COMPLETED
              ? e.class.course.lessons
              : [],
        },
      }));
    }

    return this.prisma.course.findMany({
      where:
        role === Role.ADMIN ? undefined : { status: CourseStatus.PUBLISHED },
      include: {
        classes: { include: { _count: { select: { enrollments: true } } } },
        _count: { select: { classes: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getUserClasses(userId: number, role: string) {
    if (role !== Role.STUDENT) return [];
    return this.prisma.enrollment.findMany({
      where: {
        userId,
        status: { in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED] },
      },
      include: { class: { include: { course: true } } },
      orderBy: { joinedAt: 'desc' },
    });
  }

  async getMyEnrollmentsInCourse(courseId: number, userId: number) {
    return this.prisma.enrollment.findMany({
      where: { userId, class: { courseId } },
      select: { id: true, classId: true, status: true, joinedAt: true },
    });
  }

  async getCourseById(id: number, userId?: number, role?: string) {
    const course = await this.prisma.course.findUnique({
      where: { id },
      include: {
        classes: {
          include: {
            _count: { select: { enrollments: true } },
            enrollments: {
              where: { status: EnrollmentStatus.ACTIVE },
              select: { id: true },
            },
          },
        },
        lessons: { include: { materials: true }, orderBy: { order: 'asc' } },
        quizzes: {
          include: { _count: { select: { questions: true } } },
          orderBy: { id: 'asc' },
        },
        activities: {
          include: {
            quiz: { include: { _count: { select: { questions: true } } } },
            speakingPracticeSet: {
              include: { exercises: { select: { id: true } } },
            },
            toeicExam: { include: { groups: { select: { id: true } } } },
            grammarTopic: { include: { questions: { select: { id: true } } } },
          },
          orderBy: { order: 'asc' },
        },
      },
    });
    if (!course) throw new NotFoundException('Course not found');

    if (role === Role.ADMIN) {
      return {
        ...course,
        curriculum: buildCourseCurriculum(
          course.lessons,
          course.quizzes,
          course.activities,
          course.curriculumType,
        ),
      };
    }

    const access = await this.resolveCourseAccess(id, userId, role);
    if (course.status !== CourseStatus.PUBLISHED && !access.canAccess) {
      throw new NotFoundException('Course not found');
    }
    const active = userId
      ? await this.prisma.enrollment.findFirst({
          where: {
            userId,
            class: { courseId: id },
            status: {
              in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED],
            },
          },
        })
      : null;

    const curriculum = buildCourseCurriculum(
      course.lessons,
      access.canAccess ? course.quizzes : [],
      access.canAccess ? course.activities : [],
      course.curriculumType,
    );
    const { activities: _activities, ...courseWithoutRawActivities } = course;
    void _activities;
    const safeClasses = course.classes.map(
      ({ enrollments: _enrollments, ...cls }) => {
        void _enrollments;
        return cls;
      },
    );
    return {
      ...courseWithoutRawActivities,
      learning: getCourseLearningProfile(id, course.title),
      classes: role === Role.ADMIN ? safeClasses : [],
      curriculum,
      progress: active
        ? await this.getCourseProgressFromCurriculum(id, userId!, curriculum)
        : null,
      canAccess: access.canAccess,
      accessSource: access.accessSource,
      requiresPro: access.requiresPro,
      isStarted: Boolean(active),
      isCompleted: Boolean(active?.status === EnrollmentStatus.COMPLETED),
      lockedReason: access.canAccess ? null : 'PRO_REQUIRED',
      lessons: course.lessons.map((lesson) => ({
        ...lesson,
        videoUrl: access.canAccess ? lesson.videoUrl : null,
        materials: lesson.materials.map((material) => ({
          ...material,
          fileUrl: access.canAccess ? material.fileUrl : null,
        })),
      })),
      quizzes: access.canAccess ? course.quizzes : [],
    };
  }

  async getCourseLesson(
    courseId: number,
    lessonId: number,
    user: { id: number; role: Role },
  ) {
    const detail = await this.getCourseById(courseId, user.id, user.role);
    if (!('canAccess' in detail) || !detail.canAccess) {
      throw new ForbiddenException('Khóa học này cần gói PRO đang hoạt động');
    }
    const lesson = detail.curriculum.lessons.find(
      (item) => item.id === lessonId,
    );
    if (!lesson) throw new NotFoundException('Course lesson not found');

    const progressActivities =
      'progress' in detail ? (detail.progress?.activities ?? []) : [];
    const lockedActivity = lesson.activities.find((activity) => {
      const state = progressActivities.find((item) => item.id === activity.id);
      return activity.required && state?.unlocked === false;
    });
    if (lockedActivity) {
      throw new ForbiddenException(
        'Hãy hoàn thành bài học bắt buộc trước đó để mở lesson này',
      );
    }

    const lessons = detail.curriculum.lessons;
    const index = lessons.findIndex((item) => item.id === lessonId);
    const previous = index > 0 ? lessons[index - 1] : null;
    const next =
      index >= 0 && index < lessons.length - 1 ? lessons[index + 1] : null;
    const material = lesson.materials[0];
    return {
      courseId,
      lesson: {
        id: lesson.id,
        order: lesson.order,
        title: lesson.title,
        description: lesson.description,
        materials: lesson.materials,
        theory: getLessonTheory(
          lesson.title,
          lesson.description,
          material?.objective,
          material?.contentText,
        ),
        activities: lesson.activities.map((activity) => ({
          ...activity,
          ...progressActivities.find((item) => item.id === activity.id),
        })),
      },
      course: {
        id: courseId,
        title: detail.title,
        level: detail.level,
        learning: 'learning' in detail ? detail.learning : undefined,
      },
      progress: 'progress' in detail ? detail.progress : null,
      navigation: {
        previousLessonId: previous?.id ?? null,
        nextLessonId: next?.id ?? null,
      },
    };
  }

  async getCourseProgress(courseId: number, userId: number) {
    const access = await this.resolveCourseAccess(
      courseId,
      userId,
      Role.STUDENT,
    );
    if (!access.canAccess) {
      throw new ForbiddenException('Gói PRO đang cần để truy cập lộ trình này');
    }
    const enrollment = await this.prisma.enrollment.findFirst({
      where: {
        userId,
        class: { courseId },
        status: { in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED] },
      },
    });
    if (!enrollment) throw new ForbiddenException('Bạn chưa ghi danh khóa học');
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      include: {
        lessons: { include: { materials: true }, orderBy: { order: 'asc' } },
        quizzes: { include: { _count: { select: { questions: true } } } },
        activities: {
          include: {
            quiz: { include: { _count: { select: { questions: true } } } },
            speakingPracticeSet: {
              include: { exercises: { select: { id: true } } },
            },
            toeicExam: { include: { groups: { select: { id: true } } } },
            grammarTopic: { include: { questions: { select: { id: true } } } },
          },
          orderBy: { order: 'asc' },
        },
      },
    });
    if (!course) throw new NotFoundException('Course not found');
    const curriculum = buildCourseCurriculum(
      course.lessons,
      course.quizzes,
      course.activities,
      course.curriculumType,
    );
    return this.getCourseProgressFromCurriculum(courseId, userId, curriculum);
  }

  private async getCourseProgressFromCurriculum(
    courseId: number,
    userId: number,
    curriculum: ReturnType<typeof buildCourseCurriculum>,
  ) {
    const curriculumActivities = curriculum.lessons.flatMap(
      (lesson) => lesson.activities,
    );
    const quizIds = curriculumActivities
      .filter(
        (activity) =>
          activity.kind === 'LISTENING' ||
          activity.kind === 'READING' ||
          activity.kind === 'WRITING',
      )
      .map((activity) => activity.sourceId)
      .filter((id): id is number => typeof id === 'number');
    const submissions = await this.prisma.submission.findMany({
      where: { userId, quizId: { in: quizIds } },
      include: { results: { select: { questionId: true } } },
    });
    const completeQuizIds = new Set<number>();
    for (const submission of submissions) {
      const quiz = await this.prisma.quiz.findUnique({
        where: { id: submission.quizId },
        select: { questions: { select: { id: true } } },
      });
      if (!quiz || !quiz.questions.length) continue;
      const results = new Set(
        submission.results.map((result) => result.questionId),
      );
      if (
        quiz.questions.every((question) => results.has(question.id)) &&
        results.size === quiz.questions.length
      )
        completeQuizIds.add(submission.quizId);
    }
    const toeicExamIds = curriculumActivities
      .filter((activity) => activity.kind === 'TOEIC')
      .map((activity) => activity.sourceId)
      .filter((id): id is number => typeof id === 'number');
    const completedToeicExams = toeicExamIds.length
      ? new Set(
          (
            await this.prisma.toeicAttempt.findMany({
              where: {
                userId,
                examId: { in: toeicExamIds },
                status: 'SUBMITTED',
              },
              select: { examId: true },
            })
          ).map((attempt) => attempt.examId),
        )
      : new Set<number>();
    const grammarTopicIds = curriculumActivities
      .filter((activity) => activity.kind === 'GRAMMAR')
      .map((activity) => activity.sourceId)
      .filter((id): id is number => typeof id === 'number');
    const completedGrammarTopics = grammarTopicIds.length
      ? new Set(
          (
            await this.prisma.grammarAttempt.findMany({
              where: { userId, topicId: { in: grammarTopicIds } },
              select: { topicId: true },
            })
          ).map((attempt) => attempt.topicId),
        )
      : new Set<number>();
    const speakingSetIds = curriculum.lessons
      .flatMap((lesson) => lesson.activities)
      .map((activity) => activity.speakingPracticeSetId)
      .filter((id): id is string => Boolean(id));
    const speakingExerciseIds = speakingSetIds.length
      ? await this.prisma.speakingExercise.findMany({
          where: { practiceSetId: { in: speakingSetIds } },
          select: { id: true, practiceSetId: true },
        })
      : [];
    const speakingSubmissions = speakingExerciseIds.length
      ? await this.prisma.speakingSubmission.findMany({
          where: {
            userId,
            exerciseId: { in: speakingExerciseIds.map((row) => row.id) },
            status: 'COMPLETED',
          },
          select: { exerciseId: true },
        })
      : [];
    const completedSpeaking = new Set(
      speakingSubmissions.map((row) => row.exerciseId),
    );
    const activities = curriculumActivities.map((activity) => {
      const complete =
        activity.skill === 'SPEAKING'
          ? (() => {
              const setExercises = speakingExerciseIds.filter(
                (row) => row.practiceSetId === activity.speakingPracticeSetId,
              );
              return (
                setExercises.length > 0 &&
                setExercises.every((row) => completedSpeaking.has(row.id))
              );
            })()
          : activity.kind === 'TOEIC'
            ? typeof activity.sourceId === 'number' &&
              completedToeicExams.has(activity.sourceId)
            : activity.kind === 'GRAMMAR'
              ? typeof activity.sourceId === 'number' &&
                completedGrammarTopics.has(activity.sourceId)
              : typeof activity.sourceId === 'number' &&
                completeQuizIds.has(activity.sourceId);
      return {
        id: activity.id,
        lessonId: activity.lessonId,
        order: activity.order,
        kind: activity.kind,
        title: activity.title,
        required: activity.required,
        completed: complete,
        route: activity.route,
      };
    });
    const required = activities.filter((activity) => activity.required);
    const optional = activities.filter((activity) => !activity.required);
    let blocked = false;
    const sequencedActivities = activities.map((activity) => {
      const unlocked = !blocked;
      if (activity.required && !activity.completed) blocked = true;
      return {
        ...activity,
        unlocked,
        lockedReason: unlocked ? null : 'COMPLETE_PREVIOUS_REQUIRED_ACTIVITY',
      };
    });
    const nextActivity =
      sequencedActivities.find(
        (activity) => activity.required && !activity.completed,
      ) ?? null;
    return {
      requiredCompleted: required.filter((activity) => activity.completed)
        .length,
      requiredTotal: required.length,
      optionalCompleted: optional.filter((activity) => activity.completed)
        .length,
      optionalTotal: optional.length,
      percentage: required.length
        ? Math.round(
            (required.filter((activity) => activity.completed).length /
              required.length) *
              100,
          )
        : 0,
      isComplete:
        required.length > 0 && required.every((activity) => activity.completed),
      nextActivity,
      activities: sequencedActivities,
    };
  }

  async startCourse(courseId: number, user: { id: number; role: Role }) {
    if (user.role !== Role.STUDENT) {
      throw new ForbiddenException('Chỉ học viên mới có thể bắt đầu khóa học');
    }
    const access = await this.resolveCourseAccess(courseId, user.id, user.role);
    if (!access.canAccess) {
      throw new ForbiddenException('Khóa học này cần gói PRO đang hoạt động');
    }
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      include: {
        lessons: { include: { materials: true }, orderBy: { order: 'asc' } },
        quizzes: { include: { _count: { select: { questions: true } } } },
        activities: {
          include: {
            quiz: { include: { _count: { select: { questions: true } } } },
            speakingPracticeSet: {
              include: { exercises: { select: { id: true } } },
            },
            toeicExam: { include: { groups: { select: { id: true } } } },
            grammarTopic: { include: { questions: { select: { id: true } } } },
          },
          orderBy: { order: 'asc' },
        },
      },
    });
    if (!course || course.status !== CourseStatus.PUBLISHED) {
      throw new NotFoundException('Course is not learner-ready');
    }
    const curriculum = buildCourseCurriculum(
      course.lessons,
      course.quizzes,
      course.activities,
      course.curriculumType,
    );
    if (
      curriculum.readiness !== 'READY' &&
      curriculum.readiness !== 'FOCUSED' &&
      curriculum.readiness !== 'TOEIC'
    ) {
      throw new ConflictException('Khóa học chưa sẵn sàng cho học viên');
    }
    const enrollment = await this.ensureSelfStudyEnrollment(courseId, user.id);
    const progress = await this.getCourseProgressFromCurriculum(
      courseId,
      user.id,
      curriculum,
    );
    return {
      courseId,
      enrollmentId: enrollment.id,
      accessSource: access.accessSource,
      progress,
    };
  }

  async getCourseActivityAccess(
    courseId: number,
    activityId: number,
    user: { id: number; role: Role },
  ) {
    const access = await this.resolveCourseAccess(courseId, user.id, user.role);
    if (!access.canAccess) {
      throw new ForbiddenException('Khóa học này cần gói PRO đang hoạt động');
    }
    const detail = await this.getCourseById(courseId, user.id, user.role);
    const activity = detail.curriculum.lessons
      .flatMap((lesson) => lesson.activities)
      .find((candidate) => candidate.id === `activity:${activityId}`);
    if (!activity) throw new NotFoundException('Course activity not found');
    const progressActivity = (
      'progress' in detail ? detail.progress : null
    )?.activities.find((item) => item.id === activity.id);
    if (progressActivity && progressActivity.unlocked === false) {
      throw new ForbiddenException(
        'Hãy hoàn thành hoạt động bắt buộc trước đó',
      );
    }
    return { allowed: true, route: activity.route, activity };
  }

  async updateCourse(
    id: number,
    dto: UpdateCourseDto,
    user: { id: number; role: Role },
  ) {
    this.requireAdmin(user.role);
    const course = await this.prisma.course.findUnique({ where: { id } });
    if (!course) throw new NotFoundException('Course not found');
    return this.prisma.course.update({
      where: { id },
      data: {
        title: dto.title?.trim(),
        description: dto.description,
        thumbnail: dto.thumbnail,
        level: dto.level,
        curriculumType: dto.curriculumType,
        status: dto.status,
      },
    });
  }

  async revertCourseToDraft(id: number, user: { id: number; role: Role }) {
    this.requireAdmin(user.role);
    return this.prisma.course.update({
      where: { id },
      data: { status: CourseStatus.DRAFT },
    });
  }

  async submitCourseForReview(id: number, user: { id: number; role: Role }) {
    this.requireAdmin(user.role);
    return this.prisma.course.update({
      where: { id },
      data: { status: CourseStatus.DRAFT },
    });
  }

  async reviewCourse(
    id: number,
    action: 'APPROVE' | 'REJECT',
    user: { id: number; role: Role },
  ) {
    this.requireAdmin(user.role);
    return this.prisma.course.update({
      where: { id },
      data: {
        status:
          action === 'APPROVE' ? CourseStatus.PUBLISHED : CourseStatus.DRAFT,
      },
    });
  }

  async updateCourseStatus(id: number, status: CourseStatus) {
    return this.prisma.course.update({ where: { id }, data: { status } });
  }

  async deleteCourse(id: number, user: { id: number; role: Role }) {
    this.requireAdmin(user.role);
    const payments = await this.prisma.payment.count({
      where: { enrollment: { class: { courseId: id } } },
    });
    if (payments > 0)
      throw new ConflictException(
        'Không thể xóa khóa học đã có lịch sử thanh toán',
      );
    return this.prisma.course.delete({ where: { id } });
  }

  async createClass(
    courseId: number,
    user: { id: number; role: Role },
    dto: CreateClassDto,
  ) {
    this.requireAdmin(user.role);
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
    });
    if (!course) throw new NotFoundException('Course not found');
    if (course.status !== CourseStatus.PUBLISHED) {
      throw new BadRequestException(
        'Chỉ có thể mở gói học cho khóa học PUBLISHED',
      );
    }
    if (
      dto.startDate &&
      dto.endDate &&
      new Date(dto.startDate) >= new Date(dto.endDate)
    ) {
      throw new BadRequestException('endDate phải sau startDate');
    }
    if (dto.capacity !== undefined && dto.capacity <= 0) {
      throw new BadRequestException('capacity phải lớn hơn 0');
    }
    if (dto.tuitionFeeVnd !== undefined && dto.tuitionFeeVnd < 0) {
      throw new BadRequestException('tuitionFeeVnd không được âm');
    }
    const duplicate = await this.prisma.class.findFirst({
      where: { courseId, name: dto.name.trim() },
    });
    if (duplicate) throw new ConflictException('Gói học đã tồn tại');
    return this.prisma.class.create({
      data: {
        courseId,
        name: dto.name.trim(),
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        capacity: dto.capacity ?? 30,
        tuitionFeeVnd: dto.tuitionFeeVnd ?? 0,
        // Offerings are self-paced; publishing a package makes it available
        // immediately. Date windows can still be supplied for reporting.
        status: ClassStatus.ONGOING,
      },
      include: { course: { select: { id: true, title: true } } },
    });
  }

  async updateClass(
    classId: number,
    user: { id: number; role: Role },
    dto: UpdateClassDto,
  ) {
    this.requireAdmin(user.role);
    const current = await this.prisma.class.findUnique({
      where: { id: classId },
    });
    if (!current) throw new NotFoundException('Class not found');
    if (
      current.status === ClassStatus.COMPLETED ||
      current.status === ClassStatus.CANCELLED
    ) {
      throw new BadRequestException(
        'Không thể chỉnh sửa gói học đã kết thúc hoặc bị hủy',
      );
    }
    const data: Record<string, unknown> = {
      name: dto.name?.trim(),
      startDate: dto.startDate ? new Date(dto.startDate) : undefined,
      endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      capacity: dto.capacity,
      tuitionFeeVnd: dto.tuitionFeeVnd,
      status: dto.status,
    };
    if (dto.capacity !== undefined) {
      const active = await this.prisma.enrollment.count({
        where: { classId, status: EnrollmentStatus.ACTIVE },
      });
      if (dto.capacity < active)
        throw new BadRequestException('capacity không được nhỏ hơn số ACTIVE');
    }
    if (
      dto.tuitionFeeVnd !== undefined &&
      dto.tuitionFeeVnd !== current.tuitionFeeVnd
    ) {
      const total = await this.prisma.enrollment.count({ where: { classId } });
      const isModifiableStatus =
        current.status === ClassStatus.UPCOMING ||
        current.status === ClassStatus.ONGOING;
      if (!isModifiableStatus || total > 0) {
        throw new BadRequestException(
          'Không thể thay đổi học phí sau khi gói học đã được sử dụng',
        );
      }
    }
    return this.prisma.class.update({
      where: { id: classId },
      data: data as never,
    });
  }

  async deleteClass(classId: number, user: { id: number; role: Role }) {
    this.requireAdmin(user.role);
    const payments = await this.prisma.payment.count({
      where: { enrollment: { classId } },
    });
    if (payments > 0)
      throw new ConflictException('Không thể xóa gói học đã có thanh toán');
    return this.prisma.class.delete({ where: { id: classId } });
  }

  async enrollInClass(
    classId: number,
    userId: number,
    options?: { isAdminOverride?: boolean },
  ): Promise<EnrollResponseDto> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: number;
          status: ClassStatus;
          capacity: number | null;
          tuitionFeeVnd: number;
        }>
      >`SELECT id, status, capacity, "tuitionFeeVnd" FROM "Class" WHERE id = ${classId} FOR UPDATE`;
      const current = rows[0];
      if (!current) throw new NotFoundException('Lớp học không tồn tại');
      if (
        current.status === ClassStatus.CANCELLED ||
        current.status === ClassStatus.COMPLETED
      ) {
        throw new BadRequestException('Không thể ghi danh vào gói học đã đóng');
      }
      const duplicate = await tx.enrollment.findUnique({
        where: { userId_classId: { userId, classId } },
      });
      if (duplicate)
        throw new ConflictException('Học viên đã ghi danh vào gói học này');
      const active = await tx.enrollment.count({
        where: { classId, status: EnrollmentStatus.ACTIVE },
      });
      if (current.capacity !== null && active >= current.capacity) {
        throw new ConflictException('Gói học đã đủ sức chứa');
      }
      const status =
        options?.isAdminOverride || current.tuitionFeeVnd === 0
          ? EnrollmentStatus.ACTIVE
          : EnrollmentStatus.PENDING_PAYMENT;
      const enrollment = await tx.enrollment.create({
        data: { userId, classId, status, progress: 0 },
      });
      if (!options?.isAdminOverride && current.tuitionFeeVnd > 0) {
        await tx.payment.create({
          data: {
            enrollmentId: enrollment.id,
            amountVnd: current.tuitionFeeVnd,
            transferCode: `BT-${enrollment.id}`,
            status: PaymentStatus.PENDING,
          },
        });
      }
      return {
        enrollmentId: enrollment.id,
        classId,
        status: status,
        tuitionFeeVnd: current.tuitionFeeVnd,
        accessGranted: status === EnrollmentStatus.ACTIVE,
        message:
          status === EnrollmentStatus.ACTIVE
            ? 'Ghi danh thành công'
            : 'Vui lòng thanh toán để kích hoạt',
      };
    });
  }

  async getClassById(classId: number, userId?: number, role?: string) {
    const cls = await this.prisma.class.findUnique({
      where: { id: classId },
      include: {
        course: {
          include: {
            lessons: {
              include: { materials: true },
              orderBy: { order: 'asc' },
            },
          },
        },
        assignments: {
          include: { submissions: userId ? { where: { userId } } : true },
        },
        enrollments: {
          where: { userId },
          select: { userId: true, status: true },
        },
      },
    });
    if (!cls) throw new NotFoundException('Không tìm thấy gói học');
    if (role === Role.STUDENT) {
      const enrollment = cls.enrollments[0];
      if (
        !enrollment ||
        (enrollment.status !== EnrollmentStatus.ACTIVE &&
          enrollment.status !== EnrollmentStatus.COMPLETED)
      ) {
        throw new ForbiddenException(
          'Bạn chưa có quyền truy cập nội dung riêng tư',
        );
      }
    }
    return cls;
  }

  async createLesson(
    courseId: number,
    user: { id: number; role: Role },
    dto: CreateLessonDto,
  ) {
    this.requireAdmin(user.role);
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
    });
    if (!course) throw new NotFoundException('Course not found');
    const order =
      dto.order ??
      (await this.prisma.lesson.count({ where: { courseId } })) + 1;
    return this.prisma.lesson.create({
      data: {
        courseId,
        title: dto.title.trim(),
        description: dto.description,
        order,
        videoUrl: dto.videoUrl,
      },
      include: { materials: true },
    });
  }

  async updateLesson(
    lessonId: number,
    user: { id: number; role: Role },
    dto: UpdateLessonDto,
  ) {
    this.requireAdmin(user.role);
    return this.prisma.lesson.update({
      where: { id: lessonId },
      data: {
        title: dto.title?.trim(),
        description: dto.description,
        order: dto.order,
        videoUrl: dto.videoUrl,
      },
      include: { materials: true },
    });
  }

  async deleteLesson(lessonId: number, user: { id: number; role: Role }) {
    this.requireAdmin(user.role);
    return this.prisma.lesson.delete({ where: { id: lessonId } });
  }

  async reorderLessons(
    courseId: number,
    user: { id: number; role: Role },
    lessonIds: number[],
  ) {
    this.requireAdmin(user.role);
    await this.prisma.$transaction(
      lessonIds.map((id, index) =>
        this.prisma.lesson.update({
          where: { id },
          data: { order: index + 1 },
        }),
      ),
    );
    return { success: true };
  }

  async createMaterial(
    lessonId: number,
    user: { id: number; role: Role },
    dto: CreateMaterialDto,
  ) {
    this.requireAdmin(user.role);
    return this.prisma.material.create({
      data: {
        lessonId,
        title: dto.title.trim(),
        fileUrl: dto.fileUrl.trim(),
        fileType: dto.fileType,
        objective: dto.objective,
        contentText: dto.contentText,
      },
    });
  }

  async updateMaterial(
    materialId: number,
    user: { id: number; role: Role },
    dto: UpdateMaterialDto,
  ) {
    this.requireAdmin(user.role);
    return this.prisma.material.update({
      where: { id: materialId },
      data: {
        title: dto.title?.trim(),
        fileUrl: dto.fileUrl?.trim(),
        fileType: dto.fileType,
        objective: dto.objective,
        contentText: dto.contentText,
      },
    });
  }

  async deleteMaterial(materialId: number, user: { id: number; role: Role }) {
    this.requireAdmin(user.role);
    return this.prisma.material.delete({ where: { id: materialId } });
  }

  async createCourseActivity(
    courseId: number,
    dto: CreateCourseActivityDto,
    user: { id: number; role: Role },
  ) {
    this.requireAdmin(user.role);
    const [course, lesson] = await Promise.all([
      this.prisma.course.findUnique({ where: { id: courseId } }),
      this.prisma.lesson.findUnique({ where: { id: dto.lessonId } }),
    ]);
    if (!course) throw new NotFoundException('Course not found');
    if (!lesson || lesson.courseId !== courseId)
      throw new BadRequestException('Lesson không thuộc course');
    const order =
      dto.order ??
      (await this.prisma.courseActivity.count({
        where: { lessonId: dto.lessonId },
      })) + 1;
    if (
      await this.prisma.courseActivity.findUnique({
        where: { lessonId_order: { lessonId: dto.lessonId, order } },
      })
    )
      throw new ConflictException('Thứ tự activity đã tồn tại trong lesson');
    const quizId: number | null = dto.quizId ?? null;
    const speakingPracticeSetId: string | null =
      dto.speakingPracticeSetId ?? null;
    const toeicExamId: number | null = dto.toeicExamId ?? null;
    const grammarTopicId: number | null = dto.grammarTopicId ?? null;
    if (dto.kind === 'SPEAKING') {
      if (!speakingPracticeSetId || quizId || toeicExamId || grammarTopicId)
        throw new BadRequestException(
          'Speaking activity phải trỏ tới practice set',
        );
      const set = await this.prisma.speakingPracticeSet.findUnique({
        where: { id: speakingPracticeSetId },
        include: { exercises: { select: { id: true } } },
      });
      if (!set || !set.exercises.length)
        throw new BadRequestException('Speaking practice set không hợp lệ');
    } else if (dto.kind === 'TOEIC') {
      if (quizId || speakingPracticeSetId || grammarTopicId || !toeicExamId)
        throw new BadRequestException(
          'TOEIC activity phải trỏ tới một đề TOEIC',
        );
      const exam = await this.prisma.toeicExamSet.findUnique({
        where: { id: toeicExamId },
        include: { groups: { select: { id: true } } },
      });
      if (!exam || !exam.groups.length)
        throw new BadRequestException('Đề TOEIC không hợp lệ');
    } else if (dto.kind === 'GRAMMAR') {
      if (quizId || speakingPracticeSetId || toeicExamId || !grammarTopicId)
        throw new BadRequestException(
          'Grammar activity phải trỏ tới một chủ đề ngữ pháp',
        );
      const topic = await this.prisma.grammarTopic.findUnique({
        where: { id: grammarTopicId },
        include: { questions: { select: { id: true } } },
      });
      if (!topic || !topic.questions.length)
        throw new BadRequestException('Chủ đề ngữ pháp không hợp lệ');
    } else {
      if (!quizId || speakingPracticeSetId)
        throw new BadRequestException('Skill activity phải trỏ tới quiz');
      const quiz = await this.prisma.quiz.findUnique({ where: { id: quizId } });
      if (!quiz || quiz.courseId !== courseId)
        throw new BadRequestException('Quiz không thuộc course');
      const expected =
        quiz.type === 'LISTENING_PRACTICE'
          ? 'LISTENING'
          : quiz.type === 'BILINGUAL_READING'
            ? 'READING'
            : ['WRITING_EMAIL', 'WRITING_PICTURE'].includes(quiz.type)
              ? 'WRITING'
              : null;
      if (expected !== dto.kind)
        throw new BadRequestException('Kind không khớp loại quiz');
    }
    return this.prisma.courseActivity.create({
      data: {
        courseId,
        lessonId: dto.lessonId,
        order,
        kind: dto.kind,
        title: dto.title?.trim(),
        isRequired: dto.isRequired ?? true,
        quizId,
        speakingPracticeSetId,
        toeicExamId,
        grammarTopicId,
      },
    });
  }

  async updateCourseActivity(
    activityId: number,
    dto: UpdateCourseActivityDto,
    user: { id: number; role: Role },
  ) {
    this.requireAdmin(user.role);
    const existing = await this.prisma.courseActivity.findUnique({
      where: { id: activityId },
    });
    if (!existing) throw new NotFoundException('Không tìm thấy activity');
    if (
      dto.order !== undefined &&
      dto.order !== existing.order &&
      (await this.prisma.courseActivity.findUnique({
        where: {
          lessonId_order: { lessonId: existing.lessonId, order: dto.order },
        },
      }))
    )
      throw new ConflictException('Thứ tự activity đã tồn tại trong lesson');
    return this.prisma.courseActivity.update({
      where: { id: activityId },
      data: {
        order: dto.order,
        isRequired: dto.isRequired,
        title: dto.title?.trim(),
      },
    });
  }

  async deleteCourseActivity(
    activityId: number,
    user: { id: number; role: Role },
  ) {
    this.requireAdmin(user.role);
    return this.prisma.courseActivity.delete({ where: { id: activityId } });
  }

  async getPublicCatalog(userId?: number, role?: string) {
    const courses = await this.prisma.course.findMany({
      where: { status: CourseStatus.PUBLISHED },
      select: {
        id: true,
        title: true,
        description: true,
        thumbnail: true,
        level: true,
        curriculumType: true,
        status: true,
        createdAt: true,
        lessons: { include: { materials: true }, orderBy: { order: 'asc' } },
        quizzes: { include: { _count: { select: { questions: true } } } },
        activities: {
          include: {
            quiz: { include: { _count: { select: { questions: true } } } },
            speakingPracticeSet: {
              include: { exercises: { select: { id: true } } },
            },
            toeicExam: { include: { groups: { select: { id: true } } } },
            grammarTopic: { include: { questions: { select: { id: true } } } },
          },
          orderBy: { order: 'asc' },
        },
        classes: {
          where: { status: ClassStatus.UPCOMING },
          select: {
            id: true,
            name: true,
            capacity: true,
            tuitionFeeVnd: true,
            _count: { select: { enrollments: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    const visible = [];
    for (const course of courses) {
      const curriculum = buildCourseCurriculum(
        course.lessons,
        course.quizzes,
        course.activities,
        course.curriculumType,
      );
      const access = await this.resolveCourseAccess(course.id, userId, role);
      visible.push({
        id: course.id,
        title: course.title,
        description: course.description,
        thumbnail: course.thumbnail,
        level: course.level,
        curriculumType: course.curriculumType,
        learning: getCourseLearningProfile(course.id, course.title),
        status: course.status,
        createdAt: course.createdAt,
        curriculum,
        classes: (course.classes || []).map((cls) => ({
          ...cls,
          currentEnrollmentCount: cls._count.enrollments,
          remainingSeats:
            cls.capacity === null
              ? null
              : Math.max(0, cls.capacity - cls._count.enrollments),
          isSoldOut:
            cls.capacity !== null && cls.capacity - cls._count.enrollments <= 0,
        })),
        canAccess: access.canAccess,
        accessSource: access.accessSource,
        requiresPro: access.requiresPro,
        isSelfPaced: true,
        upcomingClassCount: course.classes?.length ?? 0,
      });
    }
    return visible;
  }

  async getPublicCourseDetail(id: number, userId?: number, role?: string) {
    const course = await this.prisma.course.findFirst({
      where: { id },
      select: {
        id: true,
        title: true,
        description: true,
        thumbnail: true,
        level: true,
        curriculumType: true,
        status: true,
        createdAt: true,
        lessons: { include: { materials: true }, orderBy: { order: 'asc' } },
        quizzes: { include: { _count: { select: { questions: true } } } },
        activities: {
          include: {
            quiz: { include: { _count: { select: { questions: true } } } },
            speakingPracticeSet: {
              include: { exercises: { select: { id: true } } },
            },
            toeicExam: { include: { groups: { select: { id: true } } } },
            grammarTopic: { include: { questions: { select: { id: true } } } },
          },
          orderBy: { order: 'asc' },
        },
        classes: {
          where: { status: ClassStatus.UPCOMING },
          select: {
            id: true,
            name: true,
            startDate: true,
            endDate: true,
            capacity: true,
            status: true,
            tuitionFeeVnd: true,
            enrollments: {
              where: { status: EnrollmentStatus.ACTIVE },
              select: { id: true },
            },
          },
          orderBy: { startDate: 'asc' },
        },
      },
    });
    if (!course) {
      throw new NotFoundException(
        'Khóa học không tồn tại hoặc chưa được công khai',
      );
    }
    const access = await this.resolveCourseAccess(id, userId, role);
    const curriculum = buildCourseCurriculum(
      course.lessons,
      access.canAccess ? course.quizzes : [],
      access.canAccess ? course.activities : [],
      course.curriculumType,
    );
    if (course.status !== CourseStatus.PUBLISHED && !access.canAccess) {
      throw new NotFoundException(
        'Khóa học không tồn tại hoặc chưa được công khai',
      );
    }
    return {
      id: course.id,
      title: course.title,
      description: course.description,
      thumbnail: course.thumbnail,
      level: course.level,
      curriculumType: course.curriculumType,
      learning: getCourseLearningProfile(id, course.title),
      status: course.status,
      createdAt: course.createdAt,
      lessons: course.lessons.map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
        description: lesson.description,
        order: lesson.order,
        activities:
          curriculum.lessons.find((item) => item.id === lesson.id)
            ?.activities ?? [],
      })),
      curriculum,
      classes: (course.classes || []).map(({ enrollments, ...cls }) => {
        const current = enrollments?.length ?? 0;
        const remaining =
          cls.capacity === null ? null : Math.max(0, cls.capacity - current);
        return {
          ...cls,
          currentEnrollmentCount: current,
          remainingSeats: remaining,
          isSoldOut: remaining !== null && remaining <= 0,
        };
      }),
      canAccess: access.canAccess,
      accessSource: access.accessSource,
      requiresPro: access.requiresPro,
      isSelfPaced: true,
    };
  }
}
