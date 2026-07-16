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
let CourseService = class CourseService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async createCourse(dto) {
        return this.prisma.course.create({ data: dto });
    }
    async getAllCourses() {
        return this.prisma.course.findMany({
            include: { classes: true },
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
    async createClass(courseId, teacherId, dto) {
        return this.prisma.class.create({
            data: {
                ...dto,
                courseId,
                teacherId,
            },
        });
    }
    async getClassById(classId) {
        const classData = await this.prisma.class.findUnique({
            where: { id: classId },
            include: {
                lessons: {
                    include: { materials: true },
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
    async createLesson(classId, dto) {
        return this.prisma.lesson.create({
            data: {
                ...dto,
                classId,
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
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], CourseService);
//# sourceMappingURL=course.service.js.map