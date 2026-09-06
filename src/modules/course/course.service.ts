import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
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
  EnrollResponseDto,
} from './dto/course.dto';
import { EventsGateway } from '../events/events.gateway';
import {
  Role,
  CourseStatus,
  ClassStatus,
  EnrollmentStatus,
} from '@prisma/client';

@Injectable()
export class CourseService {
  constructor(
    private prisma: PrismaService,
    private eventsGateway: EventsGateway,
  ) {}

  // ================= COURSES =================

  async createCourse(dto: CreateCourseDto, user: { id: number; role: Role }) {
    if (user.role !== Role.TEACHER && user.role !== Role.ADMIN) {
      throw new ForbiddenException(
        'Chỉ Giáo viên hoặc Admin mới có quyền tạo khóa học',
      );
    }
    let teacherId: number | undefined = undefined;

    if (user.role === Role.TEACHER) {
      teacherId = user.id;
    } else if (user.role === Role.ADMIN) {
      if (dto.teacherId) {
        const teacher = await this.prisma.user.findUnique({
          where: { id: dto.teacherId },
        });
        if (!teacher) {
          throw new NotFoundException('Teacher not found');
        }
        if (teacher.role !== Role.TEACHER) {
          throw new BadRequestException(
            'User được chỉ định không phải là Giáo viên (role TEACHER)',
          );
        }
        teacherId = dto.teacherId;
      }
    }

    const course = await this.prisma.course.create({
      data: {
        title: dto.title.trim(),
        description: dto.description,
        thumbnail: dto.thumbnail,
        level: dto.level,
        teacherId,
        status: CourseStatus.DRAFT,
      },
      include: {
        teacher: {
          select: {
            id: true,
            email: true,
            profile: { select: { fullName: true, avatar: true } },
          },
        },
      },
    });

    this.eventsGateway.broadcastCourseUpdate();
    return course;
  }

  async getAllCourses(userId?: number, role?: string) {
    // TEACHER: only their own courses
    if (role === Role.TEACHER && userId) {
      return this.prisma.course.findMany({
        where: { teacherId: userId },
        include: {
          classes: {
            include: {
              _count: { select: { enrollments: true } },
            },
          },
          teacher: {
            select: {
              id: true,
              email: true,
              profile: { select: { fullName: true, avatar: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    // STUDENT: enrolled courses & public published courses
    if (role === Role.STUDENT && userId) {
      const enrollments = await this.prisma.enrollment.findMany({
        where: { userId },
        include: {
          class: {
            include: {
              course: {
                include: {
                  teacher: { select: { id: true, email: true, profile: true } },
                  lessons: { select: { videoUrl: true } },
                },
              },
              teacher: {
                select: {
                  id: true,
                  email: true,
                  profile: { select: { fullName: true, avatar: true } },
                },
              },
              _count: { select: { enrollments: true } },
            },
          },
        },
        orderBy: { joinedAt: 'desc' },
      });

      const watchTracking = await this.prisma.watchTracking.findUnique({
        where: { userId },
      });
      const watchedItems = (watchTracking?.items as Record<string, any>) || {};

      return enrollments.map((e) => {
        let calculatedProgress = e.progress;
        if (e.class.course.lessons && e.class.course.lessons.length > 0) {
          const totalLessons = e.class.course.lessons.length;
          let completedLessons = 0;
          e.class.course.lessons.forEach((lesson) => {
            if (lesson.videoUrl && watchedItems[lesson.videoUrl]) {
              const watchedData = watchedItems[lesson.videoUrl];
              if (watchedData.played >= 0.9) {
                completedLessons++;
              }
            }
          });
          calculatedProgress = Math.round(
            (completedLessons / totalLessons) * 100,
          );

          if (calculatedProgress !== e.progress) {
            this.prisma.enrollment
              .update({
                where: { id: e.id },
                data: { progress: calculatedProgress },
              })
              .catch(() => {});
          }
        }

        const isEnrolledActive = e.status === EnrollmentStatus.ACTIVE;
        return {
          classId: e.classId,
          className: e.class.name,
          classStatus: e.class.status,
          meetingLink: isEnrolledActive ? e.class.meetingLink : null,
          startDate: e.class.startDate,
          endDate: e.class.endDate,
          capacity: e.class.capacity,
          progress: calculatedProgress,
          enrollmentStatus: e.status,
          tuitionFeeVnd: e.class.tuitionFeeVnd ?? 0,
          joinedAt: e.joinedAt,
          studentCount: e.class._count.enrollments,
          teacher: e.class.teacher,
          course: {
            ...e.class.course,
            lessons: isEnrolledActive ? e.class.course.lessons : [],
          },
        };
      });
    }

    // ADMIN or General:
    return this.prisma.course.findMany({
      include: {
        classes: {
          include: {
            _count: { select: { enrollments: true } },
          },
        },
        teacher: {
          select: {
            id: true,
            email: true,
            profile: { select: { fullName: true, avatar: true } },
          },
        },
        _count: { select: { classes: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getCourseById(id: number, userId?: number, role?: string) {
    const course = await this.prisma.course.findUnique({
      where: { id },
      include: {
        classes: {
          include: {
            teacher: {
              select: {
                id: true,
                email: true,
                profile: { select: { fullName: true, avatar: true } },
              },
            },
            _count: { select: { enrollments: true } },
            enrollments: {
              where: { status: EnrollmentStatus.ACTIVE },
              select: { id: true },
            },
          },
        },
        lessons: {
          include: { materials: true },
          orderBy: { order: 'asc' },
        },
        quizzes: true,
        teacher: {
          select: {
            id: true,
            email: true,
            profile: { select: { fullName: true, avatar: true } },
          },
        },
      },
    });
    if (!course) throw new NotFoundException('Course not found');

    const isStaff =
      role === Role.ADMIN ||
      (role === Role.TEACHER && course.teacherId === userId);

    if (isStaff) {
      return {
        ...course,
        classes: (course.classes || []).map((cls) => {
          const totalEnrollmentCount = cls._count?.enrollments ?? 0;
          const activeEnrollmentCount = cls.enrollments?.length ?? 0;
          return {
            ...cls,
            tuitionFeeVnd: cls.tuitionFeeVnd ?? 0,
            activeEnrollmentCount,
            totalEnrollmentCount,
            hasEnrollments: totalEnrollmentCount > 0,
            studentCount: activeEnrollmentCount,
          };
        }),
      };
    }

    // Sanitize for Students and non-owner users:
    // Strip private learning assets (videoUrl, material fileUrl, meetingLink, quizzes)
    const safeLessons = (course.lessons || []).map((lesson) => ({
      id: lesson.id,
      courseId: lesson.courseId,
      title: lesson.title,
      description: lesson.description,
      order: lesson.order,
      videoUrl: null,
      createdAt: lesson.createdAt,
      materials: (lesson.materials || []).map((m) => ({
        id: m.id,
        lessonId: m.lessonId,
        title: m.title,
        fileType: m.fileType,
        fileUrl: null,
      })),
    }));

    const safeClasses = (course.classes || []).map((cls) => {
      const totalEnrollmentCount = cls._count?.enrollments ?? 0;
      const activeEnrollmentCount = cls.enrollments?.length ?? 0;
      return {
        id: cls.id,
        courseId: cls.courseId,
        name: cls.name,
        status: cls.status,
        startDate: cls.startDate,
        endDate: cls.endDate,
        capacity: cls.capacity,
        tuitionFeeVnd: cls.tuitionFeeVnd ?? 0,
        meetingLink: null,
        teacher: cls.teacher,
        activeEnrollmentCount,
        totalEnrollmentCount,
        hasEnrollments: totalEnrollmentCount > 0,
        studentCount: activeEnrollmentCount,
        _count: cls._count,
      };
    });

    return {
      ...course,
      lessons: safeLessons,
      classes: safeClasses,
      quizzes: [],
    };
  }

  async updateCourse(
    id: number,
    dto: UpdateCourseDto,
    user: { id: number; role: Role },
  ) {
    const course = await this.prisma.course.findUnique({ where: { id } });
    if (!course) throw new NotFoundException('Course not found');

    if (user.role === Role.TEACHER) {
      if (course.teacherId !== user.id) {
        throw new ForbiddenException(
          'Bạn không có quyền chỉnh sửa khóa học của giáo viên khác',
        );
      }
      if (course.status === CourseStatus.PENDING_REVIEW) {
        throw new BadRequestException(
          'Khóa học đang chờ duyệt, không thể chỉnh sửa',
        );
      }
      if (course.status === CourseStatus.PUBLISHED) {
        if (dto.title !== undefined || dto.level !== undefined) {
          throw new BadRequestException(
            'Khóa học đã xuất bản không cho phép sửa đổi tiêu đề hoặc trình độ trực tiếp. Vui lòng chuyển khóa học về Bản nháp để chỉnh sửa.',
          );
        }
      }
      if (dto.status && dto.status === CourseStatus.PUBLISHED) {
        throw new BadRequestException(
          'Giáo viên không được tự ý duyệt khóa học thành PUBLISHED',
        );
      }
    }

    let teacherId = dto.teacherId;
    if (user.role === Role.ADMIN && dto.teacherId !== undefined) {
      if (dto.teacherId !== null) {
        const teacher = await this.prisma.user.findUnique({
          where: { id: dto.teacherId },
        });
        if (!teacher) throw new NotFoundException('Teacher not found');
        if (teacher.role !== Role.TEACHER) {
          throw new BadRequestException(
            'User được chỉ định không phải là Giáo viên',
          );
        }
      }
    } else if (user.role === Role.TEACHER) {
      teacherId = user.id; // cannot change teacherId
    }

    const updated = await this.prisma.course.update({
      where: { id },
      data: {
        title: dto.title !== undefined ? dto.title.trim() : undefined,
        description: dto.description,
        thumbnail: dto.thumbnail,
        level: dto.level,
        teacherId,
        status: user.role === Role.ADMIN && dto.status ? dto.status : undefined,
      },
      include: {
        teacher: {
          select: {
            id: true,
            email: true,
            profile: { select: { fullName: true } },
          },
        },
      },
    });

    this.eventsGateway.broadcastCourseUpdate();
    return updated;
  }

  async revertCourseToDraft(id: number, user: { id: number; role: Role }) {
    const course = await this.prisma.course.findUnique({ where: { id } });
    if (!course) throw new NotFoundException('Course not found');

    if (user.role === Role.TEACHER && course.teacherId !== user.id) {
      throw new ForbiddenException(
        'Bạn không có quyền thao tác trên khóa học của giáo viên khác',
      );
    }

    if (course.status === CourseStatus.DRAFT) {
      return course;
    }

    if (course.status === CourseStatus.PENDING_REVIEW) {
      throw new BadRequestException(
        'Khóa học đang chờ Admin duyệt và không thể chuyển về Bản nháp.',
      );
    }

    // Safety rule: PUBLISHED + ONGOING Class -> Teacher cannot revert to DRAFT
    const ongoingCount = await this.prisma.class.count({
      where: {
        courseId: id,
        status: ClassStatus.ONGOING,
      },
    });
    if (ongoingCount > 0) {
      throw new BadRequestException(
        `Khóa học đang có ${ongoingCount} lớp học đang diễn ra (ONGOING). Không thể chuyển về Bản nháp để sửa giáo trình.`,
      );
    }

    const updated = await this.prisma.course.update({
      where: { id },
      data: { status: CourseStatus.DRAFT },
    });

    this.eventsGateway.broadcastCourseUpdate();
    return updated;
  }

  async submitCourseForReview(id: number, user: { id: number; role: Role }) {
    const course = await this.prisma.course.findUnique({ where: { id } });
    if (!course) throw new NotFoundException('Course not found');

    if (user.role === Role.TEACHER && course.teacherId !== user.id) {
      throw new ForbiddenException(
        'Bạn không có quyền gửi duyệt khóa học của giáo viên khác',
      );
    }

    if (course.status === CourseStatus.PUBLISHED) {
      throw new BadRequestException('Khóa học này đã được duyệt (PUBLISHED)');
    }
    if (course.status === CourseStatus.PENDING_REVIEW) {
      throw new BadRequestException('Khóa học đang trong hàng đợi chờ duyệt');
    }

    const updated = await this.prisma.course.update({
      where: { id },
      data: { status: CourseStatus.PENDING_REVIEW },
    });

    this.eventsGateway.broadcastCourseUpdate();
    return updated;
  }

  async reviewCourse(
    id: number,
    action: 'APPROVE' | 'REJECT',
    user: { id: number; role: Role },
  ) {
    if (user.role !== Role.ADMIN) {
      throw new ForbiddenException('Chỉ Admin mới có quyền duyệt khóa học');
    }

    const course = await this.prisma.course.findUnique({ where: { id } });
    if (!course) throw new NotFoundException('Course not found');

    const newStatus =
      action === 'APPROVE' ? CourseStatus.PUBLISHED : CourseStatus.REJECTED;

    const updated = await this.prisma.course.update({
      where: { id },
      data: { status: newStatus },
      include: {
        teacher: {
          select: {
            id: true,
            email: true,
            profile: { select: { fullName: true } },
          },
        },
      },
    });

    this.eventsGateway.broadcastCourseUpdate();
    return updated;
  }

  async deleteCourse(id: number, user: { id: number; role: Role }) {
    const course = await this.prisma.course.findUnique({ where: { id } });
    if (!course) throw new NotFoundException('Course not found');

    if (user.role === Role.TEACHER) {
      if (course.teacherId !== user.id) {
        throw new ForbiddenException('Bạn không có quyền xóa khóa học này');
      }
      if (course.status === CourseStatus.PUBLISHED) {
        throw new BadRequestException(
          'Không thể xóa khóa học đã PUBLISHED. Vui lòng liên hệ Admin',
        );
      }
    }

    const paymentCount = await this.prisma.payment.count({
      where: { enrollment: { class: { courseId: id } } },
    });
    if (paymentCount > 0) {
      throw new ConflictException(
        'Không thể xóa khóa học vì tồn tại lịch sử thanh toán cần được lưu giữ.',
      );
    }

    const deleted = await this.prisma.course.delete({ where: { id } });
    this.eventsGateway.broadcastCourseUpdate();
    return deleted;
  }

  async updateCourseStatus(id: number, status: CourseStatus) {
    const updated = await this.prisma.course.update({
      where: { id },
      data: { status },
    });

    this.eventsGateway.broadcastCourseUpdate();
    return updated;
  }

  // ================= CLASSES =================

  async createClass(
    courseId: number,
    user: { id: number; role: Role },
    dto: CreateClassDto,
  ) {
    // 1. Kiểm tra Course tồn tại
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
    });
    if (!course) {
      throw new NotFoundException('Course not found');
    }

    // 2. Kiểm tra Course status = PUBLISHED
    if (course.status !== CourseStatus.PUBLISHED) {
      throw new BadRequestException(
        'Chỉ có thể mở lớp cho khóa học đã được duyệt (PUBLISHED)',
      );
    }

    // 3. Quyền sở hữu và Teacher
    let targetTeacherId: number;
    if (user.role === Role.TEACHER) {
      if (course.teacherId !== user.id) {
        throw new ForbiddenException(
          'Bạn không có quyền mở lớp cho khóa học của giáo viên khác',
        );
      }
      targetTeacherId = user.id;
    } else if (user.role === Role.ADMIN) {
      const assignedId = dto.teacherId || course.teacherId;
      if (!assignedId) {
        throw new BadRequestException(
          'Vui lòng chọn giáo viên phụ trách lớp học',
        );
      }
      const teacherUser = await this.prisma.user.findUnique({
        where: { id: assignedId },
      });
      if (!teacherUser) {
        throw new NotFoundException('Teacher not found');
      }
      if (teacherUser.role !== Role.TEACHER) {
        throw new BadRequestException(
          'User được chỉ định không phải là Giáo viên (role TEACHER)',
        );
      }
      targetTeacherId = assignedId;
    } else {
      throw new ForbiddenException('Không có quyền tạo lớp học');
    }

    // 4. Validate Dates
    if (dto.startDate && dto.endDate) {
      if (new Date(dto.startDate) >= new Date(dto.endDate)) {
        throw new BadRequestException(
          'Ngày kết thúc (endDate) phải sau ngày bắt đầu (startDate)',
        );
      }
    }

    // 5. Check duplicate class name in course
    const existingClass = await this.prisma.class.findFirst({
      where: {
        courseId,
        name: dto.name.trim(),
      },
    });
    if (existingClass) {
      throw new ConflictException(
        'Lớp học với tên này đã tồn tại trong khóa học',
      );
    }

    // 6. Sức chứa & Học phí
    if (dto.capacity !== undefined && dto.capacity <= 0) {
      throw new BadRequestException(
        'Sức chứa tối đa (capacity) phải lớn hơn 0',
      );
    }
    const capacity = dto.capacity || 30;

    if (dto.tuitionFeeVnd !== undefined && dto.tuitionFeeVnd < 0) {
      throw new BadRequestException('Học phí (tuitionFeeVnd) không được âm');
    }
    const tuitionFeeVnd = dto.tuitionFeeVnd ?? 0;

    // 7. Initial status (không hardcode ONGOING)
    let status: ClassStatus = ClassStatus.UPCOMING;
    if (dto.startDate && new Date(dto.startDate) <= new Date()) {
      status = ClassStatus.ONGOING;
    }

    // 8. Meeting link
    const dailyDomain = process.env.DAILY_DOMAIN || 'breadtrans-kltn.daily.co';
    const randomCode = Math.random().toString(36).substring(2, 10);
    const meetingLink =
      dto.meetingLink ||
      `https://${dailyDomain}/class-course-${courseId}-${randomCode}`;

    return this.prisma.class.create({
      data: {
        name: dto.name.trim(),
        courseId,
        teacherId: targetTeacherId,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        meetingLink,
        capacity,
        tuitionFeeVnd,
        status,
      },
      include: {
        course: { select: { id: true, title: true } },
        teacher: {
          select: {
            id: true,
            email: true,
            profile: { select: { fullName: true } },
          },
        },
      },
    });
  }

  async updateClass(
    classId: number,
    user: { id: number; role: Role },
    dto: UpdateClassDto,
  ) {
    const classData = await this.prisma.class.findUnique({
      where: { id: classId },
    });
    if (!classData) throw new NotFoundException('Class not found');

    // 1. Status rule: COMPLETED and CANCELLED are read-only
    if (
      classData.status === ClassStatus.COMPLETED ||
      classData.status === ClassStatus.CANCELLED
    ) {
      throw new BadRequestException(
        'Không thể chỉnh sửa lớp học đã kết thúc (COMPLETED) hoặc đã bị hủy (CANCELLED)',
      );
    }

    // 2. Ownership & Teacher change protection
    if (user.role === Role.TEACHER) {
      if (classData.teacherId !== user.id) {
        throw new ForbiddenException(
          'Bạn không có quyền chỉnh sửa lớp học của giáo viên khác',
        );
      }
      if (dto.teacherId !== undefined && dto.teacherId !== user.id) {
        throw new ForbiddenException(
          'Giáo viên không có quyền chuyển giao lớp học cho giáo viên khác. Chỉ Quản trị viên mới được phép.',
        );
      }
    }

    // 3. ONGOING Class Schedule Safety: cannot alter historical startDate
    if (classData.status === ClassStatus.ONGOING) {
      if (
        dto.startDate &&
        classData.startDate &&
        new Date(dto.startDate).getTime() !==
          new Date(classData.startDate).getTime()
      ) {
        throw new BadRequestException(
          'Lớp học đang diễn ra (ONGOING), không thể thay đổi ngày bắt đầu đã xảy ra.',
        );
      }
    }

    // 4. Session Consistency: endDate must not precede the latest scheduled session's endTime
    if (dto.endDate) {
      const latestSession = await this.prisma.session.findFirst({
        where: { classId },
        orderBy: { endTime: 'desc' },
      });
      if (latestSession && new Date(dto.endDate) < latestSession.endTime) {
        throw new BadRequestException(
          `Ngày kết thúc lớp học (${new Date(dto.endDate).toLocaleDateString('vi-VN')}) không được trước thời gian kết thúc của buổi học muộn nhất (${latestSession.endTime.toLocaleDateString('vi-VN')}).`,
        );
      }
    }

    // 5. Date validation
    const sDate = dto.startDate ? new Date(dto.startDate) : classData.startDate;
    const eDate = dto.endDate ? new Date(dto.endDate) : classData.endDate;
    if (sDate && eDate && sDate >= eDate) {
      throw new BadRequestException(
        'Ngày kết thúc (endDate) phải sau ngày bắt đầu (startDate)',
      );
    }

    // 6. Capacity validation: must be > 0 and >= activeEnrollments (ACTIVE-only seat occupancy)
    if (dto.capacity !== undefined) {
      if (dto.capacity <= 0) {
        throw new BadRequestException(
          'Sức chứa tối đa (capacity) phải lớn hơn 0',
        );
      }
      const activeEnrollments = await this.prisma.enrollment.count({
        where: {
          classId,
          status: EnrollmentStatus.ACTIVE,
        },
      });
      if (dto.capacity < activeEnrollments) {
        throw new BadRequestException(
          `Sức chứa mới (${dto.capacity}) không được nhỏ hơn số lượng học viên đang học (${activeEnrollments}).`,
        );
      }
    }

    // 6.1 Tuition Fee Lock: only editable in UPCOMING status and with 0 total enrollments
    if (dto.tuitionFeeVnd !== undefined) {
      if (dto.tuitionFeeVnd < 0) {
        throw new BadRequestException('Học phí (tuitionFeeVnd) không được âm');
      }
      if (dto.tuitionFeeVnd !== classData.tuitionFeeVnd) {
        if (classData.status !== ClassStatus.UPCOMING) {
          throw new BadRequestException(
            'Chỉ có thể thay đổi học phí khi lớp học ở trạng thái UPCOMING',
          );
        }
        const totalEnrollments = await this.prisma.enrollment.count({
          where: { classId },
        });
        if (totalEnrollments > 0) {
          throw new BadRequestException(
            `Không thể thay đổi học phí vì lớp học đã có ${totalEnrollments} lượt ghi danh (bảo vệ tính toàn vẹn học phí).`,
          );
        }
      }
    }

    // 7. Duplicate check if renaming
    if (dto.name && dto.name.trim() !== classData.name) {
      const dup = await this.prisma.class.findFirst({
        where: {
          courseId: classData.courseId,
          name: dto.name.trim(),
          NOT: { id: classId },
        },
      });
      if (dup) {
        throw new ConflictException(
          'Lớp học với tên này đã tồn tại trong khóa học',
        );
      }
    }

    // 8. Teacher assignment (Admin only)
    let targetTeacherId = classData.teacherId;
    if (user.role === Role.ADMIN && dto.teacherId) {
      const teacher = await this.prisma.user.findUnique({
        where: { id: dto.teacherId },
      });
      if (!teacher) throw new NotFoundException('Teacher not found');
      if (teacher.role !== Role.TEACHER) {
        throw new BadRequestException(
          'User được chỉ định không phải là Giáo viên',
        );
      }
      targetTeacherId = dto.teacherId;
    }

    const updatedClass = await this.prisma.class.update({
      where: { id: classId },
      data: {
        name: dto.name !== undefined ? dto.name.trim() : undefined,
        teacherId: targetTeacherId,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        meetingLink: dto.meetingLink,
        capacity: dto.capacity,
        tuitionFeeVnd: dto.tuitionFeeVnd,
        status: dto.status,
      },
      include: {
        course: { select: { id: true, title: true } },
        teacher: {
          select: {
            id: true,
            email: true,
            profile: { select: { fullName: true } },
          },
        },
        _count: { select: { enrollments: true } },
      },
    });

    const activeEnrollmentCount = await this.prisma.enrollment.count({
      where: {
        classId,
        status: EnrollmentStatus.ACTIVE,
      },
    });
    const totalEnrollmentCount = updatedClass._count?.enrollments ?? 0;

    return {
      ...updatedClass,
      activeEnrollmentCount,
      totalEnrollmentCount,
      hasEnrollments: totalEnrollmentCount > 0,
      studentCount: activeEnrollmentCount,
    };
  }

  async deleteClass(classId: number, user: { id: number; role: Role }) {
    const classData = await this.prisma.class.findUnique({
      where: { id: classId },
    });
    if (!classData) throw new NotFoundException('Class not found');

    if (user.role === Role.TEACHER && classData.teacherId !== user.id) {
      throw new ForbiddenException(
        'Bạn không có quyền xóa lớp học của giáo viên khác',
      );
    }

    const enrollmentCount = await this.prisma.enrollment.count({
      where: { classId },
    });
    if (enrollmentCount > 0) {
      throw new BadRequestException(
        `Lớp học đã có ${enrollmentCount} học viên đăng ký hoặc lịch sử thanh toán. Không thể xóa trực tiếp, vui lòng chuyển trạng thái sang CANCELLED để bảo lưu lịch sử.`,
      );
    }

    return this.prisma.class.delete({ where: { id: classId } });
  }

  async getUserClasses(userId: number, role: string) {
    if (role === 'TEACHER' || role === 'ADMIN') {
      const classes = await this.prisma.class.findMany({
        where: role === 'TEACHER' ? { teacherId: userId } : {},
        include: {
          course: { select: { title: true } },
          sessions: {
            orderBy: { startTime: 'asc' },
          },
          _count: { select: { enrollments: true } },
          enrollments: {
            include: {
              user: {
                select: {
                  id: true,
                  email: true,
                  profile: { select: { fullName: true, avatar: true } },
                },
              },
            },
          },
        },
        orderBy: { startDate: 'desc' },
      });
      return classes.map((c) => {
        const totalEnrollmentCount = c._count.enrollments;
        const activeEnrollmentCount = (c.enrollments || []).filter(
          (e) => e.status === EnrollmentStatus.ACTIVE,
        ).length;
        return {
          ...c,
          activeEnrollmentCount,
          totalEnrollmentCount,
          hasEnrollments: totalEnrollmentCount > 0,
          studentCount: activeEnrollmentCount,
        };
      });
    } else if (role === 'STUDENT') {
      const enrollments = await this.prisma.enrollment.findMany({
        where: { userId },
        include: {
          class: {
            include: {
              course: { select: { title: true } },
              sessions: {
                orderBy: { startTime: 'asc' },
              },
              teacher: {
                select: {
                  email: true,
                  profile: { select: { fullName: true } },
                },
              },
              _count: { select: { enrollments: true } },
            },
          },
        },
        orderBy: { class: { startDate: 'desc' } },
      });
      return enrollments.map((e) => ({
        ...e.class,
        meetingLink:
          e.status === EnrollmentStatus.ACTIVE ? e.class.meetingLink : null,
        enrollmentStatus: e.status,
        studentCount: e.class._count.enrollments,
      }));
    }
    return [];
  }

  async getClassById(classId: number, userId?: number, role?: string) {
    const classData = await this.prisma.class.findUnique({
      where: { id: classId },
      include: {
        course: {
          include: {
            lessons: { include: { materials: true } },
          },
        },
        teacher: { select: { id: true, email: true, profile: true } },
      },
    });
    if (!classData) throw new NotFoundException('Class not found');

    if (role === 'STUDENT' && userId) {
      const enrollment = await this.prisma.enrollment.findFirst({
        where: {
          classId,
          userId,
          status: { in: ['ACTIVE', 'COMPLETED'] },
        },
      });
      if (!enrollment) {
        throw new ForbiddenException(
          'Bạn chưa ghi danh hoặc không có quyền truy cập bài giảng của lớp học này',
        );
      }
    } else if (role === 'TEACHER' && userId) {
      if (classData.teacherId !== userId) {
        throw new ForbiddenException(
          'Bạn không phải là giảng viên phụ trách lớp học này',
        );
      }
    }

    return classData;
  }

  // ================= ENROLLMENT =================

  async getMyEnrollmentsInCourse(courseId: number, userId: number) {
    return this.prisma.enrollment.findMany({
      where: {
        userId,
        class: {
          courseId,
        },
      },
      select: {
        id: true,
        classId: true,
        status: true,
        joinedAt: true,
      },
    });
  }

  async enrollInClass(
    classId: number,
    userId: number,
    options?: { isAdminOverride?: boolean },
  ): Promise<EnrollResponseDto> {
    return await this.prisma.$transaction(async (tx) => {
      // 1. Lock Class row using parameterized tagged template
      const lockedClasses = await tx.$queryRaw<
        Array<{
          id: number;
          status: ClassStatus;
          capacity: number | null;
          tuitionFeeVnd: number | null;
        }>
      >`SELECT id, status, capacity, "tuitionFeeVnd" FROM "Class" WHERE id = ${classId} FOR UPDATE;`;

      if (!lockedClasses || lockedClasses.length === 0) {
        throw new NotFoundException('Lớp học không tồn tại');
      }
      const classData = lockedClasses[0];

      // 2. Validate Class status
      if (classData.status === ClassStatus.CANCELLED) {
        throw new BadRequestException(
          'Không thể ghi danh vào lớp học đã bị hủy (CANCELLED)',
        );
      }
      if (classData.status === ClassStatus.COMPLETED) {
        throw new BadRequestException(
          'Không thể ghi danh vào lớp học đã kết thúc (COMPLETED)',
        );
      }

      if (!options?.isAdminOverride) {
        if (classData.status !== ClassStatus.UPCOMING) {
          throw new BadRequestException(
            'Chỉ có thể ghi danh vào lớp học sắp khai giảng (UPCOMING)',
          );
        }
      } else {
        // Admin override: UPCOMING or ONGOING only
        if (
          classData.status !== ClassStatus.UPCOMING &&
          classData.status !== ClassStatus.ONGOING
        ) {
          throw new BadRequestException(
            'Admin chỉ có thể ghi danh học viên vào lớp UPCOMING hoặc ONGOING',
          );
        }
      }

      // 3. Duplicate check (TX level)
      const existing = await tx.enrollment.findUnique({
        where: {
          userId_classId: {
            userId,
            classId,
          },
        },
      });
      if (existing) {
        throw new ConflictException('Học viên đã ghi danh vào lớp học này rồi');
      }

      // 4. Seat Occupancy Check (ACTIVE enrollments only!)
      const activeEnrollmentsCount = await tx.enrollment.count({
        where: {
          classId,
          status: EnrollmentStatus.ACTIVE,
        },
      });

      if (
        classData.capacity !== null &&
        activeEnrollmentsCount >= classData.capacity
      ) {
        throw new ConflictException(
          'Lớp học đã đủ số lượng học viên tối đa (Full capacity)',
        );
      }

      // 5. Determine Enrollment Status
      const tuitionFeeVnd = classData.tuitionFeeVnd ?? 0;
      let enrollmentStatus: EnrollmentStatus;
      let message: string;

      if (options?.isAdminOverride) {
        enrollmentStatus = EnrollmentStatus.ACTIVE;
        message = 'Admin đã ghi danh học viên vào lớp học thành công';
      } else if (tuitionFeeVnd === 0) {
        enrollmentStatus = EnrollmentStatus.ACTIVE;
        message = 'Ghi danh lớp học miễn phí thành công.';
      } else {
        enrollmentStatus = EnrollmentStatus.PENDING_PAYMENT;
        message =
          'Ghi danh thành công. Vui lòng thanh toán học phí để hoàn tất kích hoạt lớp học.';
      }

      // 6. Create enrollment inside tx
      try {
        const enrollment = await tx.enrollment.create({
          data: {
            userId,
            classId,
            status: enrollmentStatus,
            progress: 0,
          },
        });

        return {
          enrollmentId: enrollment.id,
          classId: enrollment.classId,
          status: enrollment.status as 'ACTIVE' | 'PENDING_PAYMENT',
          tuitionFeeVnd,
          accessGranted: enrollment.status === EnrollmentStatus.ACTIVE,
          message,
        };
      } catch (error: any) {
        if (error.code === 'P2002') {
          throw new ConflictException(
            'Học viên đã ghi danh vào lớp học này rồi',
          );
        }
        throw error;
      }
    });
  }

  // ================= LESSONS & MATERIALS =================

  async createLesson(
    courseId: number,
    user: { id: number; role: Role },
    dto: CreateLessonDto,
  ) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
    });
    if (!course) throw new NotFoundException('Course not found');

    if (user.role === Role.TEACHER) {
      if (course.teacherId !== user.id) {
        throw new ForbiddenException(
          'Bạn không có quyền thêm bài học vào khóa học của giáo viên khác',
        );
      }
      if (course.status === CourseStatus.PENDING_REVIEW) {
        throw new BadRequestException(
          'Khóa học đang chờ duyệt, nội dung đã bị khóa',
        );
      }
      if (course.status === CourseStatus.PUBLISHED) {
        throw new BadRequestException(
          'Khóa học đã xuất bản không thể thêm bài học trực tiếp. Vui lòng chuyển khóa học về Bản nháp để chỉnh sửa.',
        );
      }
    }

    let order = dto.order;
    if (order === undefined) {
      const lastLesson = await this.prisma.lesson.findFirst({
        where: { courseId },
        orderBy: { order: 'desc' },
      });
      order = (lastLesson?.order ?? 0) + 1;
    }

    return this.prisma.lesson.create({
      data: {
        ...dto,
        order,
        courseId,
      },
      include: { materials: true },
    });
  }

  async updateLesson(
    lessonId: number,
    user: { id: number; role: Role },
    dto: UpdateLessonDto,
  ) {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      include: { course: true },
    });
    if (!lesson) throw new NotFoundException('Lesson not found');

    if (user.role === Role.TEACHER) {
      if (lesson.course.teacherId !== user.id) {
        throw new ForbiddenException(
          'Bạn không có quyền chỉnh sửa bài học của khóa học khác',
        );
      }
      if (lesson.course.status === CourseStatus.PENDING_REVIEW) {
        throw new BadRequestException(
          'Khóa học đang chờ duyệt, nội dung đã bị khóa',
        );
      }
      if (lesson.course.status === CourseStatus.PUBLISHED) {
        throw new BadRequestException(
          'Khóa học đã xuất bản không thể sửa bài học trực tiếp. Vui lòng chuyển khóa học về Bản nháp để chỉnh sửa.',
        );
      }
    }

    return this.prisma.lesson.update({
      where: { id: lessonId },
      data: {
        title: dto.title !== undefined ? dto.title.trim() : undefined,
        description: dto.description,
        order: dto.order,
        videoUrl: dto.videoUrl,
      },
      include: { materials: true },
    });
  }

  async deleteLesson(lessonId: number, user: { id: number; role: Role }) {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      include: { course: true },
    });
    if (!lesson) throw new NotFoundException('Lesson not found');

    if (user.role === Role.TEACHER) {
      if (lesson.course.teacherId !== user.id) {
        throw new ForbiddenException(
          'Bạn không có quyền xóa bài học của khóa học khác',
        );
      }
      if (lesson.course.status === CourseStatus.PENDING_REVIEW) {
        throw new BadRequestException(
          'Khóa học đang chờ duyệt, nội dung đã bị khóa',
        );
      }
      if (lesson.course.status === CourseStatus.PUBLISHED) {
        throw new BadRequestException(
          'Khóa học đã xuất bản không thể xóa bài học trực tiếp. Vui lòng chuyển khóa học về Bản nháp để chỉnh sửa.',
        );
      }
    }

    return this.prisma.lesson.delete({ where: { id: lessonId } });
  }

  async reorderLessons(
    courseId: number,
    user: { id: number; role: Role },
    lessonIds: number[],
  ) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
    });
    if (!course) throw new NotFoundException('Course not found');

    if (user.role === Role.TEACHER) {
      if (course.teacherId !== user.id) {
        throw new ForbiddenException(
          'Bạn không có quyền sắp xếp bài học của khóa học khác',
        );
      }
      if (course.status === CourseStatus.PENDING_REVIEW) {
        throw new BadRequestException(
          'Khóa học đang chờ duyệt, nội dung đã bị khóa',
        );
      }
      if (course.status === CourseStatus.PUBLISHED) {
        throw new BadRequestException(
          'Khóa học đã xuất bản không thể sắp xếp bài học trực tiếp. Vui lòng chuyển khóa học về Bản nháp.',
        );
      }
    }

    await this.prisma.$transaction(
      lessonIds.map((id, index) =>
        this.prisma.lesson.update({
          where: { id, courseId },
          data: { order: index + 1 },
        }),
      ),
    );

    return { success: true, message: 'Đã cập nhật thứ tự bài học thành công' };
  }

  async createMaterial(
    lessonId: number,
    user: { id: number; role: Role },
    dto: CreateMaterialDto,
  ) {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      include: { course: true },
    });
    if (!lesson) throw new NotFoundException('Lesson not found');

    if (user.role === Role.TEACHER) {
      if (lesson.course.teacherId !== user.id) {
        throw new ForbiddenException(
          'Bạn không có quyền thêm tài liệu vào khóa học khác',
        );
      }
      if (lesson.course.status === CourseStatus.PENDING_REVIEW) {
        throw new BadRequestException(
          'Khóa học đang chờ duyệt, nội dung đã bị khóa',
        );
      }
      if (lesson.course.status === CourseStatus.PUBLISHED) {
        throw new BadRequestException(
          'Khóa học đã xuất bản không thể thêm tài liệu trực tiếp. Vui lòng chuyển khóa học về Bản nháp.',
        );
      }
    }

    return this.prisma.material.create({
      data: {
        title: dto.title.trim(),
        fileUrl: dto.fileUrl.trim(),
        fileType: dto.fileType,
        lessonId,
      },
    });
  }

  async updateMaterial(
    materialId: number,
    user: { id: number; role: Role },
    dto: UpdateMaterialDto,
  ) {
    const material = await this.prisma.material.findUnique({
      where: { id: materialId },
      include: { lesson: { include: { course: true } } },
    });
    if (!material) throw new NotFoundException('Material not found');

    if (user.role === Role.TEACHER) {
      if (material.lesson.course.teacherId !== user.id) {
        throw new ForbiddenException(
          'Bạn không có quyền chỉnh sửa tài liệu của khóa học khác',
        );
      }
      if (material.lesson.course.status === CourseStatus.PENDING_REVIEW) {
        throw new BadRequestException(
          'Khóa học đang chờ duyệt, nội dung đã bị khóa',
        );
      }
      if (material.lesson.course.status === CourseStatus.PUBLISHED) {
        throw new BadRequestException(
          'Khóa học đã xuất bản không thể sửa tài liệu trực tiếp. Vui lòng chuyển khóa học về Bản nháp.',
        );
      }
    }

    return this.prisma.material.update({
      where: { id: materialId },
      data: {
        title: dto.title !== undefined ? dto.title.trim() : undefined,
        fileUrl: dto.fileUrl !== undefined ? dto.fileUrl.trim() : undefined,
        fileType: dto.fileType !== undefined ? dto.fileType : undefined,
      },
    });
  }

  async deleteMaterial(materialId: number, user: { id: number; role: Role }) {
    const material = await this.prisma.material.findUnique({
      where: { id: materialId },
      include: { lesson: { include: { course: true } } },
    });
    if (!material) throw new NotFoundException('Material not found');

    if (user.role === Role.TEACHER) {
      if (material.lesson.course.teacherId !== user.id) {
        throw new ForbiddenException(
          'Bạn không có quyền xóa tài liệu của khóa học khác',
        );
      }
      if (material.lesson.course.status === CourseStatus.PENDING_REVIEW) {
        throw new BadRequestException(
          'Khóa học đang chờ duyệt, nội dung đã bị khóa',
        );
      }
      if (material.lesson.course.status === CourseStatus.PUBLISHED) {
        throw new BadRequestException(
          'Khóa học đã xuất bản không thể xóa tài liệu trực tiếp. Vui lòng chuyển khóa học về Bản nháp.',
        );
      }
    }

    return this.prisma.material.delete({ where: { id: materialId } });
  }

  // ================= PUBLIC DISCOVERY (PHASE 3A) =================

  async getPublicCatalog() {
    const courses = await this.prisma.course.findMany({
      where: { status: CourseStatus.PUBLISHED },
      select: {
        id: true,
        title: true,
        description: true,
        thumbnail: true,
        level: true,
        status: true,
        createdAt: true,
        teacher: {
          select: {
            id: true,
            profile: {
              select: {
                fullName: true,
                avatar: true,
              },
            },
          },
        },
        classes: {
          where: { status: ClassStatus.UPCOMING },
          select: { id: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return courses.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      thumbnail: c.thumbnail,
      level: c.level,
      status: c.status,
      createdAt: c.createdAt,
      teacher: {
        id: c.teacher?.id ?? null,
        fullName: c.teacher?.profile?.fullName ?? 'Giảng viên trung tâm',
        avatar: c.teacher?.profile?.avatar ?? null,
      },
      upcomingClassCount: c.classes.length,
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
        status: true,
        createdAt: true,
        teacher: {
          select: {
            id: true,
            profile: {
              select: {
                fullName: true,
                avatar: true,
                targetScore: true,
              },
            },
          },
        },
        lessons: {
          select: {
            id: true,
            title: true,
            description: true,
            order: true,
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
            teacher: {
              select: {
                id: true,
                profile: {
                  select: {
                    fullName: true,
                    avatar: true,
                  },
                },
              },
            },
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

    return {
      id: course.id,
      title: course.title,
      description: course.description,
      thumbnail: course.thumbnail,
      level: course.level,
      status: course.status,
      createdAt: course.createdAt,
      teacher: {
        id: course.teacher?.id ?? null,
        fullName: course.teacher?.profile?.fullName ?? 'Giảng viên trung tâm',
        avatar: course.teacher?.profile?.avatar ?? null,
        specialization: course.teacher?.profile?.targetScore ?? null,
      },
      lessons: course.lessons,
      classes: course.classes.map((cls) => {
        const capacity = cls.capacity ?? 30;
        const currentEnrollmentCount = cls.enrollments.length;
        const remainingSeats = Math.max(0, capacity - currentEnrollmentCount);
        return {
          id: cls.id,
          name: cls.name,
          startDate: cls.startDate,
          endDate: cls.endDate,
          capacity,
          tuitionFeeVnd: cls.tuitionFeeVnd ?? 0,
          currentEnrollmentCount,
          remainingSeats,
          isSoldOut: remainingSeats <= 0,
          status: cls.status,
          teacher: {
            id: cls.teacher?.id ?? null,
            fullName: cls.teacher?.profile?.fullName ?? 'Giảng viên',
            avatar: cls.teacher?.profile?.avatar ?? null,
          },
        };
      }),
    };
  }
}
