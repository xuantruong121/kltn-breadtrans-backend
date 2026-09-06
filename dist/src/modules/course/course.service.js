"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CourseService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const events_gateway_1 = require("../events/events.gateway");
const client_1 = require("@prisma/client");
let CourseService = class CourseService {
    prisma;
    eventsGateway;
    constructor(prisma, eventsGateway) {
        this.prisma = prisma;
        this.eventsGateway = eventsGateway;
    }
    async createCourse(dto, user) {
        if (user.role !== client_1.Role.TEACHER && user.role !== client_1.Role.ADMIN) {
            throw new common_1.ForbiddenException('Chỉ Giáo viên hoặc Admin mới có quyền tạo khóa học');
        }
        let teacherId = undefined;
        if (user.role === client_1.Role.TEACHER) {
            teacherId = user.id;
        }
        else if (user.role === client_1.Role.ADMIN) {
            if (dto.teacherId) {
                const teacher = await this.prisma.user.findUnique({
                    where: { id: dto.teacherId },
                });
                if (!teacher) {
                    throw new common_1.NotFoundException('Teacher not found');
                }
                if (teacher.role !== client_1.Role.TEACHER) {
                    throw new common_1.BadRequestException('User được chỉ định không phải là Giáo viên (role TEACHER)');
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
                status: client_1.CourseStatus.DRAFT,
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
    async getAllCourses(userId, role) {
        if (role === client_1.Role.TEACHER && userId) {
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
        if (role === client_1.Role.STUDENT && userId) {
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
            const watchedItems = watchTracking?.items || {};
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
                    calculatedProgress = Math.round((completedLessons / totalLessons) * 100);
                    if (calculatedProgress !== e.progress) {
                        this.prisma.enrollment
                            .update({
                            where: { id: e.id },
                            data: { progress: calculatedProgress },
                        })
                            .catch(() => { });
                    }
                }
                const isEnrolledActive = e.status === client_1.EnrollmentStatus.ACTIVE;
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
    async getCourseById(id, userId, role) {
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
                            where: { status: client_1.EnrollmentStatus.ACTIVE },
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
        if (!course)
            throw new common_1.NotFoundException('Course not found');
        const isStaff = role === client_1.Role.ADMIN ||
            (role === client_1.Role.TEACHER && course.teacherId === userId);
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
    async updateCourse(id, dto, user) {
        const course = await this.prisma.course.findUnique({ where: { id } });
        if (!course)
            throw new common_1.NotFoundException('Course not found');
        if (user.role === client_1.Role.TEACHER) {
            if (course.teacherId !== user.id) {
                throw new common_1.ForbiddenException('Bạn không có quyền chỉnh sửa khóa học của giáo viên khác');
            }
            if (course.status === client_1.CourseStatus.PENDING_REVIEW) {
                throw new common_1.BadRequestException('Khóa học đang chờ duyệt, không thể chỉnh sửa');
            }
            if (course.status === client_1.CourseStatus.PUBLISHED) {
                if (dto.title !== undefined || dto.level !== undefined) {
                    throw new common_1.BadRequestException('Khóa học đã xuất bản không cho phép sửa đổi tiêu đề hoặc trình độ trực tiếp. Vui lòng chuyển khóa học về Bản nháp để chỉnh sửa.');
                }
            }
            if (dto.status && dto.status === client_1.CourseStatus.PUBLISHED) {
                throw new common_1.BadRequestException('Giáo viên không được tự ý duyệt khóa học thành PUBLISHED');
            }
        }
        let teacherId = dto.teacherId;
        if (user.role === client_1.Role.ADMIN && dto.teacherId !== undefined) {
            if (dto.teacherId !== null) {
                const teacher = await this.prisma.user.findUnique({
                    where: { id: dto.teacherId },
                });
                if (!teacher)
                    throw new common_1.NotFoundException('Teacher not found');
                if (teacher.role !== client_1.Role.TEACHER) {
                    throw new common_1.BadRequestException('User được chỉ định không phải là Giáo viên');
                }
            }
        }
        else if (user.role === client_1.Role.TEACHER) {
            teacherId = user.id;
        }
        const updated = await this.prisma.course.update({
            where: { id },
            data: {
                title: dto.title !== undefined ? dto.title.trim() : undefined,
                description: dto.description,
                thumbnail: dto.thumbnail,
                level: dto.level,
                teacherId,
                status: user.role === client_1.Role.ADMIN && dto.status ? dto.status : undefined,
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
    async revertCourseToDraft(id, user) {
        const course = await this.prisma.course.findUnique({ where: { id } });
        if (!course)
            throw new common_1.NotFoundException('Course not found');
        if (user.role === client_1.Role.TEACHER && course.teacherId !== user.id) {
            throw new common_1.ForbiddenException('Bạn không có quyền thao tác trên khóa học của giáo viên khác');
        }
        if (course.status === client_1.CourseStatus.DRAFT) {
            return course;
        }
        if (course.status === client_1.CourseStatus.PENDING_REVIEW) {
            throw new common_1.BadRequestException('Khóa học đang chờ Admin duyệt và không thể chuyển về Bản nháp.');
        }
        const ongoingCount = await this.prisma.class.count({
            where: {
                courseId: id,
                status: client_1.ClassStatus.ONGOING,
            },
        });
        if (ongoingCount > 0) {
            throw new common_1.BadRequestException(`Khóa học đang có ${ongoingCount} lớp học đang diễn ra (ONGOING). Không thể chuyển về Bản nháp để sửa giáo trình.`);
        }
        const updated = await this.prisma.course.update({
            where: { id },
            data: { status: client_1.CourseStatus.DRAFT },
        });
        this.eventsGateway.broadcastCourseUpdate();
        return updated;
    }
    async submitCourseForReview(id, user) {
        const course = await this.prisma.course.findUnique({ where: { id } });
        if (!course)
            throw new common_1.NotFoundException('Course not found');
        if (user.role === client_1.Role.TEACHER && course.teacherId !== user.id) {
            throw new common_1.ForbiddenException('Bạn không có quyền gửi duyệt khóa học của giáo viên khác');
        }
        if (course.status === client_1.CourseStatus.PUBLISHED) {
            throw new common_1.BadRequestException('Khóa học này đã được duyệt (PUBLISHED)');
        }
        if (course.status === client_1.CourseStatus.PENDING_REVIEW) {
            throw new common_1.BadRequestException('Khóa học đang trong hàng đợi chờ duyệt');
        }
        const updated = await this.prisma.course.update({
            where: { id },
            data: { status: client_1.CourseStatus.PENDING_REVIEW },
        });
        this.eventsGateway.broadcastCourseUpdate();
        return updated;
    }
    async reviewCourse(id, action, user) {
        if (user.role !== client_1.Role.ADMIN) {
            throw new common_1.ForbiddenException('Chỉ Admin mới có quyền duyệt khóa học');
        }
        const course = await this.prisma.course.findUnique({ where: { id } });
        if (!course)
            throw new common_1.NotFoundException('Course not found');
        const newStatus = action === 'APPROVE' ? client_1.CourseStatus.PUBLISHED : client_1.CourseStatus.REJECTED;
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
    async deleteCourse(id, user) {
        const course = await this.prisma.course.findUnique({ where: { id } });
        if (!course)
            throw new common_1.NotFoundException('Course not found');
        if (user.role === client_1.Role.TEACHER) {
            if (course.teacherId !== user.id) {
                throw new common_1.ForbiddenException('Bạn không có quyền xóa khóa học này');
            }
            if (course.status === client_1.CourseStatus.PUBLISHED) {
                throw new common_1.BadRequestException('Không thể xóa khóa học đã PUBLISHED. Vui lòng liên hệ Admin');
            }
        }
        const deleted = await this.prisma.course.delete({ where: { id } });
        this.eventsGateway.broadcastCourseUpdate();
        return deleted;
    }
    async updateCourseStatus(id, status) {
        const updated = await this.prisma.course.update({
            where: { id },
            data: { status },
        });
        this.eventsGateway.broadcastCourseUpdate();
        return updated;
    }
    async createClass(courseId, user, dto) {
        const course = await this.prisma.course.findUnique({
            where: { id: courseId },
        });
        if (!course) {
            throw new common_1.NotFoundException('Course not found');
        }
        if (course.status !== client_1.CourseStatus.PUBLISHED) {
            throw new common_1.BadRequestException('Chỉ có thể mở lớp cho khóa học đã được duyệt (PUBLISHED)');
        }
        let targetTeacherId;
        if (user.role === client_1.Role.TEACHER) {
            if (course.teacherId !== user.id) {
                throw new common_1.ForbiddenException('Bạn không có quyền mở lớp cho khóa học của giáo viên khác');
            }
            targetTeacherId = user.id;
        }
        else if (user.role === client_1.Role.ADMIN) {
            const assignedId = dto.teacherId || course.teacherId;
            if (!assignedId) {
                throw new common_1.BadRequestException('Vui lòng chọn giáo viên phụ trách lớp học');
            }
            const teacherUser = await this.prisma.user.findUnique({
                where: { id: assignedId },
            });
            if (!teacherUser) {
                throw new common_1.NotFoundException('Teacher not found');
            }
            if (teacherUser.role !== client_1.Role.TEACHER) {
                throw new common_1.BadRequestException('User được chỉ định không phải là Giáo viên (role TEACHER)');
            }
            targetTeacherId = assignedId;
        }
        else {
            throw new common_1.ForbiddenException('Không có quyền tạo lớp học');
        }
        if (dto.startDate && dto.endDate) {
            if (new Date(dto.startDate) >= new Date(dto.endDate)) {
                throw new common_1.BadRequestException('Ngày kết thúc (endDate) phải sau ngày bắt đầu (startDate)');
            }
        }
        const existingClass = await this.prisma.class.findFirst({
            where: {
                courseId,
                name: dto.name.trim(),
            },
        });
        if (existingClass) {
            throw new common_1.ConflictException('Lớp học với tên này đã tồn tại trong khóa học');
        }
        if (dto.capacity !== undefined && dto.capacity <= 0) {
            throw new common_1.BadRequestException('Sức chứa tối đa (capacity) phải lớn hơn 0');
        }
        const capacity = dto.capacity || 30;
        if (dto.tuitionFeeVnd !== undefined && dto.tuitionFeeVnd < 0) {
            throw new common_1.BadRequestException('Học phí (tuitionFeeVnd) không được âm');
        }
        const tuitionFeeVnd = dto.tuitionFeeVnd ?? 0;
        let status = client_1.ClassStatus.UPCOMING;
        if (dto.startDate && new Date(dto.startDate) <= new Date()) {
            status = client_1.ClassStatus.ONGOING;
        }
        const dailyDomain = process.env.DAILY_DOMAIN || 'breadtrans-kltn.daily.co';
        const randomCode = Math.random().toString(36).substring(2, 10);
        const meetingLink = dto.meetingLink ||
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
    async updateClass(classId, user, dto) {
        const classData = await this.prisma.class.findUnique({
            where: { id: classId },
        });
        if (!classData)
            throw new common_1.NotFoundException('Class not found');
        if (classData.status === client_1.ClassStatus.COMPLETED ||
            classData.status === client_1.ClassStatus.CANCELLED) {
            throw new common_1.BadRequestException('Không thể chỉnh sửa lớp học đã kết thúc (COMPLETED) hoặc đã bị hủy (CANCELLED)');
        }
        if (user.role === client_1.Role.TEACHER) {
            if (classData.teacherId !== user.id) {
                throw new common_1.ForbiddenException('Bạn không có quyền chỉnh sửa lớp học của giáo viên khác');
            }
            if (dto.teacherId !== undefined && dto.teacherId !== user.id) {
                throw new common_1.ForbiddenException('Giáo viên không có quyền chuyển giao lớp học cho giáo viên khác. Chỉ Quản trị viên mới được phép.');
            }
        }
        if (classData.status === client_1.ClassStatus.ONGOING) {
            if (dto.startDate &&
                classData.startDate &&
                new Date(dto.startDate).getTime() !==
                    new Date(classData.startDate).getTime()) {
                throw new common_1.BadRequestException('Lớp học đang diễn ra (ONGOING), không thể thay đổi ngày bắt đầu đã xảy ra.');
            }
        }
        if (dto.endDate) {
            const latestSession = await this.prisma.session.findFirst({
                where: { classId },
                orderBy: { endTime: 'desc' },
            });
            if (latestSession && new Date(dto.endDate) < latestSession.endTime) {
                throw new common_1.BadRequestException(`Ngày kết thúc lớp học (${new Date(dto.endDate).toLocaleDateString('vi-VN')}) không được trước thời gian kết thúc của buổi học muộn nhất (${latestSession.endTime.toLocaleDateString('vi-VN')}).`);
            }
        }
        const sDate = dto.startDate ? new Date(dto.startDate) : classData.startDate;
        const eDate = dto.endDate ? new Date(dto.endDate) : classData.endDate;
        if (sDate && eDate && sDate >= eDate) {
            throw new common_1.BadRequestException('Ngày kết thúc (endDate) phải sau ngày bắt đầu (startDate)');
        }
        if (dto.capacity !== undefined) {
            if (dto.capacity <= 0) {
                throw new common_1.BadRequestException('Sức chứa tối đa (capacity) phải lớn hơn 0');
            }
            const activeEnrollments = await this.prisma.enrollment.count({
                where: {
                    classId,
                    status: client_1.EnrollmentStatus.ACTIVE,
                },
            });
            if (dto.capacity < activeEnrollments) {
                throw new common_1.BadRequestException(`Sức chứa mới (${dto.capacity}) không được nhỏ hơn số lượng học viên đang học (${activeEnrollments}).`);
            }
        }
        if (dto.tuitionFeeVnd !== undefined) {
            if (dto.tuitionFeeVnd < 0) {
                throw new common_1.BadRequestException('Học phí (tuitionFeeVnd) không được âm');
            }
            if (dto.tuitionFeeVnd !== classData.tuitionFeeVnd) {
                if (classData.status !== client_1.ClassStatus.UPCOMING) {
                    throw new common_1.BadRequestException('Chỉ có thể thay đổi học phí khi lớp học ở trạng thái UPCOMING');
                }
                const totalEnrollments = await this.prisma.enrollment.count({
                    where: { classId },
                });
                if (totalEnrollments > 0) {
                    throw new common_1.BadRequestException(`Không thể thay đổi học phí vì lớp học đã có ${totalEnrollments} lượt ghi danh (bảo vệ tính toàn vẹn học phí).`);
                }
            }
        }
        if (dto.name && dto.name.trim() !== classData.name) {
            const dup = await this.prisma.class.findFirst({
                where: {
                    courseId: classData.courseId,
                    name: dto.name.trim(),
                    NOT: { id: classId },
                },
            });
            if (dup) {
                throw new common_1.ConflictException('Lớp học với tên này đã tồn tại trong khóa học');
            }
        }
        let targetTeacherId = classData.teacherId;
        if (user.role === client_1.Role.ADMIN && dto.teacherId) {
            const teacher = await this.prisma.user.findUnique({
                where: { id: dto.teacherId },
            });
            if (!teacher)
                throw new common_1.NotFoundException('Teacher not found');
            if (teacher.role !== client_1.Role.TEACHER) {
                throw new common_1.BadRequestException('User được chỉ định không phải là Giáo viên');
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
                status: client_1.EnrollmentStatus.ACTIVE,
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
    async deleteClass(classId, user) {
        const classData = await this.prisma.class.findUnique({
            where: { id: classId },
        });
        if (!classData)
            throw new common_1.NotFoundException('Class not found');
        if (user.role === client_1.Role.TEACHER && classData.teacherId !== user.id) {
            throw new common_1.ForbiddenException('Bạn không có quyền xóa lớp học của giáo viên khác');
        }
        const enrollmentCount = await this.prisma.enrollment.count({
            where: { classId },
        });
        if (enrollmentCount > 0) {
            throw new common_1.BadRequestException(`Lớp học đã có ${enrollmentCount} học viên đăng ký. Không thể xóa trực tiếp, vui lòng chuyển trạng thái sang CANCELLED để bảo lưu lịch sử học tập.`);
        }
        return this.prisma.class.delete({ where: { id: classId } });
    }
    async getUserClasses(userId, role) {
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
                const activeEnrollmentCount = (c.enrollments || []).filter((e) => e.status === client_1.EnrollmentStatus.ACTIVE).length;
                return {
                    ...c,
                    activeEnrollmentCount,
                    totalEnrollmentCount,
                    hasEnrollments: totalEnrollmentCount > 0,
                    studentCount: activeEnrollmentCount,
                };
            });
        }
        else if (role === 'STUDENT') {
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
                meetingLink: e.status === client_1.EnrollmentStatus.ACTIVE ? e.class.meetingLink : null,
                enrollmentStatus: e.status,
                studentCount: e.class._count.enrollments,
            }));
        }
        return [];
    }
    async getClassById(classId, userId, role) {
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
        if (!classData)
            throw new common_1.NotFoundException('Class not found');
        if (role === 'STUDENT' && userId) {
            const enrollment = await this.prisma.enrollment.findFirst({
                where: {
                    classId,
                    userId,
                    status: { in: ['ACTIVE', 'COMPLETED'] },
                },
            });
            if (!enrollment) {
                throw new common_1.ForbiddenException('Bạn chưa ghi danh hoặc không có quyền truy cập bài giảng của lớp học này');
            }
        }
        else if (role === 'TEACHER' && userId) {
            if (classData.teacherId !== userId) {
                throw new common_1.ForbiddenException('Bạn không phải là giảng viên phụ trách lớp học này');
            }
        }
        return classData;
    }
    async getMyEnrollmentsInCourse(courseId, userId) {
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
    async enrollInClass(classId, userId, options) {
        return await this.prisma.$transaction(async (tx) => {
            const lockedClasses = await tx.$queryRaw `SELECT id, status, capacity, "tuitionFeeVnd" FROM "Class" WHERE id = ${classId} FOR UPDATE;`;
            if (!lockedClasses || lockedClasses.length === 0) {
                throw new common_1.NotFoundException('Lớp học không tồn tại');
            }
            const classData = lockedClasses[0];
            if (classData.status === client_1.ClassStatus.CANCELLED) {
                throw new common_1.BadRequestException('Không thể ghi danh vào lớp học đã bị hủy (CANCELLED)');
            }
            if (classData.status === client_1.ClassStatus.COMPLETED) {
                throw new common_1.BadRequestException('Không thể ghi danh vào lớp học đã kết thúc (COMPLETED)');
            }
            if (!options?.isAdminOverride) {
                if (classData.status !== client_1.ClassStatus.UPCOMING) {
                    throw new common_1.BadRequestException('Chỉ có thể ghi danh vào lớp học sắp khai giảng (UPCOMING)');
                }
            }
            else {
                if (classData.status !== client_1.ClassStatus.UPCOMING &&
                    classData.status !== client_1.ClassStatus.ONGOING) {
                    throw new common_1.BadRequestException('Admin chỉ có thể ghi danh học viên vào lớp UPCOMING hoặc ONGOING');
                }
            }
            const existing = await tx.enrollment.findUnique({
                where: {
                    userId_classId: {
                        userId,
                        classId,
                    },
                },
            });
            if (existing) {
                throw new common_1.ConflictException('Học viên đã ghi danh vào lớp học này rồi');
            }
            const activeEnrollmentsCount = await tx.enrollment.count({
                where: {
                    classId,
                    status: client_1.EnrollmentStatus.ACTIVE,
                },
            });
            if (classData.capacity !== null &&
                activeEnrollmentsCount >= classData.capacity) {
                throw new common_1.ConflictException('Lớp học đã đủ số lượng học viên tối đa (Full capacity)');
            }
            const tuitionFeeVnd = classData.tuitionFeeVnd ?? 0;
            let enrollmentStatus;
            let message;
            if (options?.isAdminOverride) {
                enrollmentStatus = client_1.EnrollmentStatus.ACTIVE;
                message = 'Admin đã ghi danh học viên vào lớp học thành công';
            }
            else if (tuitionFeeVnd === 0) {
                enrollmentStatus = client_1.EnrollmentStatus.ACTIVE;
                message = 'Ghi danh lớp học miễn phí thành công.';
            }
            else {
                enrollmentStatus = client_1.EnrollmentStatus.PENDING_PAYMENT;
                message =
                    'Ghi danh thành công. Vui lòng thanh toán học phí để hoàn tất kích hoạt lớp học.';
            }
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
                    status: enrollment.status,
                    tuitionFeeVnd,
                    accessGranted: enrollment.status === client_1.EnrollmentStatus.ACTIVE,
                    message,
                };
            }
            catch (error) {
                if (error.code === 'P2002') {
                    throw new common_1.ConflictException('Học viên đã ghi danh vào lớp học này rồi');
                }
                throw error;
            }
        });
    }
    async createLesson(courseId, user, dto) {
        const course = await this.prisma.course.findUnique({
            where: { id: courseId },
        });
        if (!course)
            throw new common_1.NotFoundException('Course not found');
        if (user.role === client_1.Role.TEACHER) {
            if (course.teacherId !== user.id) {
                throw new common_1.ForbiddenException('Bạn không có quyền thêm bài học vào khóa học của giáo viên khác');
            }
            if (course.status === client_1.CourseStatus.PENDING_REVIEW) {
                throw new common_1.BadRequestException('Khóa học đang chờ duyệt, nội dung đã bị khóa');
            }
            if (course.status === client_1.CourseStatus.PUBLISHED) {
                throw new common_1.BadRequestException('Khóa học đã xuất bản không thể thêm bài học trực tiếp. Vui lòng chuyển khóa học về Bản nháp để chỉnh sửa.');
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
    async updateLesson(lessonId, user, dto) {
        const lesson = await this.prisma.lesson.findUnique({
            where: { id: lessonId },
            include: { course: true },
        });
        if (!lesson)
            throw new common_1.NotFoundException('Lesson not found');
        if (user.role === client_1.Role.TEACHER) {
            if (lesson.course.teacherId !== user.id) {
                throw new common_1.ForbiddenException('Bạn không có quyền chỉnh sửa bài học của khóa học khác');
            }
            if (lesson.course.status === client_1.CourseStatus.PENDING_REVIEW) {
                throw new common_1.BadRequestException('Khóa học đang chờ duyệt, nội dung đã bị khóa');
            }
            if (lesson.course.status === client_1.CourseStatus.PUBLISHED) {
                throw new common_1.BadRequestException('Khóa học đã xuất bản không thể sửa bài học trực tiếp. Vui lòng chuyển khóa học về Bản nháp để chỉnh sửa.');
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
    async deleteLesson(lessonId, user) {
        const lesson = await this.prisma.lesson.findUnique({
            where: { id: lessonId },
            include: { course: true },
        });
        if (!lesson)
            throw new common_1.NotFoundException('Lesson not found');
        if (user.role === client_1.Role.TEACHER) {
            if (lesson.course.teacherId !== user.id) {
                throw new common_1.ForbiddenException('Bạn không có quyền xóa bài học của khóa học khác');
            }
            if (lesson.course.status === client_1.CourseStatus.PENDING_REVIEW) {
                throw new common_1.BadRequestException('Khóa học đang chờ duyệt, nội dung đã bị khóa');
            }
            if (lesson.course.status === client_1.CourseStatus.PUBLISHED) {
                throw new common_1.BadRequestException('Khóa học đã xuất bản không thể xóa bài học trực tiếp. Vui lòng chuyển khóa học về Bản nháp để chỉnh sửa.');
            }
        }
        return this.prisma.lesson.delete({ where: { id: lessonId } });
    }
    async reorderLessons(courseId, user, lessonIds) {
        const course = await this.prisma.course.findUnique({
            where: { id: courseId },
        });
        if (!course)
            throw new common_1.NotFoundException('Course not found');
        if (user.role === client_1.Role.TEACHER) {
            if (course.teacherId !== user.id) {
                throw new common_1.ForbiddenException('Bạn không có quyền sắp xếp bài học của khóa học khác');
            }
            if (course.status === client_1.CourseStatus.PENDING_REVIEW) {
                throw new common_1.BadRequestException('Khóa học đang chờ duyệt, nội dung đã bị khóa');
            }
            if (course.status === client_1.CourseStatus.PUBLISHED) {
                throw new common_1.BadRequestException('Khóa học đã xuất bản không thể sắp xếp bài học trực tiếp. Vui lòng chuyển khóa học về Bản nháp.');
            }
        }
        await this.prisma.$transaction(lessonIds.map((id, index) => this.prisma.lesson.update({
            where: { id, courseId },
            data: { order: index + 1 },
        })));
        return { success: true, message: 'Đã cập nhật thứ tự bài học thành công' };
    }
    async createMaterial(lessonId, user, dto) {
        const lesson = await this.prisma.lesson.findUnique({
            where: { id: lessonId },
            include: { course: true },
        });
        if (!lesson)
            throw new common_1.NotFoundException('Lesson not found');
        if (user.role === client_1.Role.TEACHER) {
            if (lesson.course.teacherId !== user.id) {
                throw new common_1.ForbiddenException('Bạn không có quyền thêm tài liệu vào khóa học khác');
            }
            if (lesson.course.status === client_1.CourseStatus.PENDING_REVIEW) {
                throw new common_1.BadRequestException('Khóa học đang chờ duyệt, nội dung đã bị khóa');
            }
            if (lesson.course.status === client_1.CourseStatus.PUBLISHED) {
                throw new common_1.BadRequestException('Khóa học đã xuất bản không thể thêm tài liệu trực tiếp. Vui lòng chuyển khóa học về Bản nháp.');
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
    async updateMaterial(materialId, user, dto) {
        const material = await this.prisma.material.findUnique({
            where: { id: materialId },
            include: { lesson: { include: { course: true } } },
        });
        if (!material)
            throw new common_1.NotFoundException('Material not found');
        if (user.role === client_1.Role.TEACHER) {
            if (material.lesson.course.teacherId !== user.id) {
                throw new common_1.ForbiddenException('Bạn không có quyền chỉnh sửa tài liệu của khóa học khác');
            }
            if (material.lesson.course.status === client_1.CourseStatus.PENDING_REVIEW) {
                throw new common_1.BadRequestException('Khóa học đang chờ duyệt, nội dung đã bị khóa');
            }
            if (material.lesson.course.status === client_1.CourseStatus.PUBLISHED) {
                throw new common_1.BadRequestException('Khóa học đã xuất bản không thể sửa tài liệu trực tiếp. Vui lòng chuyển khóa học về Bản nháp.');
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
    async deleteMaterial(materialId, user) {
        const material = await this.prisma.material.findUnique({
            where: { id: materialId },
            include: { lesson: { include: { course: true } } },
        });
        if (!material)
            throw new common_1.NotFoundException('Material not found');
        if (user.role === client_1.Role.TEACHER) {
            if (material.lesson.course.teacherId !== user.id) {
                throw new common_1.ForbiddenException('Bạn không có quyền xóa tài liệu của khóa học khác');
            }
            if (material.lesson.course.status === client_1.CourseStatus.PENDING_REVIEW) {
                throw new common_1.BadRequestException('Khóa học đang chờ duyệt, nội dung đã bị khóa');
            }
            if (material.lesson.course.status === client_1.CourseStatus.PUBLISHED) {
                throw new common_1.BadRequestException('Khóa học đã xuất bản không thể xóa tài liệu trực tiếp. Vui lòng chuyển khóa học về Bản nháp.');
            }
        }
        return this.prisma.material.delete({ where: { id: materialId } });
    }
    async getPublicCatalog() {
        const courses = await this.prisma.course.findMany({
            where: { status: client_1.CourseStatus.PUBLISHED },
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
                    where: { status: client_1.ClassStatus.UPCOMING },
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
    async getPublicCourseDetail(id) {
        const course = await this.prisma.course.findFirst({
            where: { id, status: client_1.CourseStatus.PUBLISHED },
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
                    where: { status: client_1.ClassStatus.UPCOMING },
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
                            where: { status: client_1.EnrollmentStatus.ACTIVE },
                            select: { id: true },
                        },
                    },
                    orderBy: { startDate: 'asc' },
                },
            },
        });
        if (!course) {
            throw new common_1.NotFoundException('Khóa học không tồn tại hoặc chưa được công khai');
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
};
exports.CourseService = CourseService;
exports.CourseService = CourseService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        events_gateway_1.EventsGateway])
], CourseService);
//# sourceMappingURL=course.service.js.map