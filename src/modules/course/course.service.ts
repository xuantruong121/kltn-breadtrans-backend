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
  Role,
} from '@prisma/client';
import { buildCourseCurriculum } from './course-curriculum';

@Injectable()
export class CourseService {
  constructor(private readonly prisma: PrismaService) {}

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
        where: { userId },
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
      active ? course.quizzes : [],
      active ? course.activities : [],
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
      classes: safeClasses,
      curriculum,
      progress: active
        ? await this.getCourseProgressFromCurriculum(id, userId!, curriculum)
        : null,
      lessons: course.lessons.map((lesson) => ({
        ...lesson,
        videoUrl: active ? lesson.videoUrl : null,
        materials: lesson.materials.map((material) => ({
          ...material,
          fileUrl: active ? material.fileUrl : null,
        })),
      })),
      quizzes: active ? course.quizzes : [],
    };
  }

  async getCourseProgress(courseId: number, userId: number) {
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
    const activityIds = curriculum.lessons
      .flatMap((lesson) => lesson.activities)
      .map((activity) => activity.sourceId)
      .filter((id): id is number => typeof id === 'number');
    const quizIds = activityIds;
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
    const activities = curriculum.lessons
      .flatMap((lesson) => lesson.activities)
      .map((activity) => {
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
    const nextActivity =
      required.find((activity) => !activity.completed) ?? null;
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
      activities,
    };
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
    if (dto.kind === 'SPEAKING') {
      if (!speakingPracticeSetId || quizId)
        throw new BadRequestException(
          'Speaking activity phải trỏ tới practice set',
        );
      const set = await this.prisma.speakingPracticeSet.findUnique({
        where: { id: speakingPracticeSetId },
        include: { exercises: { select: { id: true } } },
      });
      if (!set || !set.exercises.length)
        throw new BadRequestException('Speaking practice set không hợp lệ');
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

  async getPublicCatalog() {
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
    return courses.map((course) => ({
      ...course,
      upcomingClassCount: course.classes.length,
    }));
  }

  async getPublicCourseDetail(id: number) {
    const course = await this.prisma.course.findFirst({
      where: { id, status: CourseStatus.PUBLISHED },
      select: {
        id: true,
        title: true,
        description: true,
        thumbnail: true,
        level: true,
        curriculumType: true,
        status: true,
        createdAt: true,
        lessons: {
          select: { id: true, title: true, description: true, order: true },
          orderBy: { order: 'asc' },
        },
        quizzes: {
          where: { publicationStatus: 'PUBLISHED' },
          select: {
            id: true,
            title: true,
            description: true,
            type: true,
            isPremiumContent: true,
            publicationStatus: true,
            courseId: true,
            _count: { select: { questions: true } },
          },
          orderBy: { id: 'asc' },
        },
        activities: {
          include: {
            quiz: { include: { _count: { select: { questions: true } } } },
            speakingPracticeSet: {
              include: { exercises: { select: { id: true } } },
            },
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
    if (!course)
      throw new NotFoundException(
        'Khóa học không tồn tại hoặc chưa được công khai',
      );
    const { activities: _activities, ...publicCourse } = course;
    void _activities;
    return {
      ...publicCourse,
      curriculum: buildCourseCurriculum(
        course.lessons,
        course.quizzes,
        course.activities,
        course.curriculumType,
      ),
      classes: course.classes.map(({ enrollments, ...cls }) => {
        const current = enrollments.length;
        const remaining =
          cls.capacity === null ? null : Math.max(0, cls.capacity - current);
        return {
          ...cls,
          currentEnrollmentCount: current,
          remainingSeats: remaining,
          isSoldOut: remaining !== null && remaining <= 0,
        };
      }),
    };
  }
}
