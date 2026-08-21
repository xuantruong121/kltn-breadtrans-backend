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
let CourseService = class CourseService {
    prisma;
    eventsGateway;
    constructor(prisma, eventsGateway) {
        this.prisma = prisma;
        this.eventsGateway = eventsGateway;
    }
    async createCourse(dto) {
        return this.prisma.course.create({ data: dto });
    }
    async getAllCourses(userId, role) {
        if (role === 'TEACHER' && userId) {
            return this.prisma.course.findMany({
                where: { teacherId: userId },
                include: {
                    classes: {
                        include: {
                            _count: { select: { enrollments: true } },
                        },
                    },
                    teacher: { select: { id: true, email: true, profile: true } },
                },
                orderBy: { createdAt: 'desc' },
            });
        }
        if (role === 'STUDENT' && userId) {
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
                return {
                    classId: e.classId,
                    className: e.class.name,
                    classStatus: e.class.status,
                    meetingLink: e.class.meetingLink,
                    startDate: e.class.startDate,
                    endDate: e.class.endDate,
                    progress: calculatedProgress,
                    enrollmentStatus: e.status,
                    joinedAt: e.joinedAt,
                    studentCount: e.class._count.enrollments,
                    teacher: e.class.teacher,
                    course: e.class.course,
                };
            });
        }
        return this.prisma.course.findMany({
            include: {
                classes: true,
                teacher: { select: { id: true, email: true, profile: true } },
            },
            orderBy: { createdAt: 'desc' },
        });
    }
    async getCourseById(id) {
        const course = await this.prisma.course.findUnique({
            where: { id },
            include: {
                classes: {
                    include: {
                        teacher: { select: { id: true, email: true, profile: true } },
                    },
                },
                quizzes: true,
            },
        });
        if (!course)
            throw new common_1.NotFoundException('Course not found');
        return course;
    }
    async deleteCourse(id) {
        return this.prisma.course.delete({ where: { id } });
    }
    async updateCourseStatus(id, status) {
        const updated = await this.prisma.course.update({
            where: { id },
            data: { status },
        });
        this.eventsGateway.broadcastCourseUpdate();
        return updated;
    }
    async getUserClasses(userId, role) {
        if (role === 'TEACHER' || role === 'ADMIN') {
            const classes = await this.prisma.class.findMany({
                where: { teacherId: userId },
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
            return classes.map((c) => ({
                ...c,
                studentCount: c._count.enrollments,
            }));
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
                studentCount: e.class._count.enrollments,
            }));
        }
        return [];
    }
    async createClass(courseId, teacherId, dto) {
        const dailyDomain = process.env.DAILY_DOMAIN || 'breadtrans-kltn.daily.co';
        const randomCode = Math.random().toString(36).substring(2, 10);
        const meetingLink = dto.meetingLink ||
            `https://${dailyDomain}/class-course-${courseId}-${randomCode}`;
        return this.prisma.class.create({
            data: {
                ...dto,
                courseId,
                teacherId,
                meetingLink,
            },
        });
    }
    async getClassById(classId) {
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
        return classData;
    }
    async deleteClass(id) {
        return this.prisma.class.delete({ where: { id } });
    }
    async createLesson(courseId, dto) {
        return this.prisma.lesson.create({
            data: {
                ...dto,
                courseId,
            },
        });
    }
    async createMaterial(lessonId, dto) {
        return this.prisma.material.create({
            data: {
                ...dto,
                lessonId,
            },
        });
    }
};
exports.CourseService = CourseService;
exports.CourseService = CourseService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        events_gateway_1.EventsGateway])
], CourseService);
//# sourceMappingURL=course.service.js.map