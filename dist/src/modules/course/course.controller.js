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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CourseController = void 0;
const common_1 = require("@nestjs/common");
const course_service_1 = require("./course.service");
const course_dto_1 = require("./dto/course.dto");
const swagger_1 = require("@nestjs/swagger");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const roles_guard_1 = require("../../common/guards/roles.guard");
const roles_decorator_1 = require("../../common/decorators/roles.decorator");
const client_1 = require("@prisma/client");
let CourseController = class CourseController {
    courseService;
    constructor(courseService) {
        this.courseService = courseService;
    }
    createCourse(createCourseDto, req) {
        return this.courseService.createCourse(createCourseDto, req.user);
    }
    getAllCourses(req, role) {
        const userId = req.user?.id;
        const userRole = role || req.user?.role;
        return this.courseService.getAllCourses(userId, userRole);
    }
    getMyCourses(req) {
        return this.courseService.getAllCourses(req.user.id, req.user.role);
    }
    getUserClasses(req) {
        return this.courseService.getUserClasses(req.user.id, req.user.role);
    }
    getMyEnrollmentsInCourse(courseId, req) {
        return this.courseService.getMyEnrollmentsInCourse(courseId, req.user.id);
    }
    getCourseById(id, req) {
        return this.courseService.getCourseById(id, req.user?.id, req.user?.role);
    }
    updateCourse(id, dto, req) {
        return this.courseService.updateCourse(id, dto, req.user);
    }
    submitCourseForReview(id, req) {
        return this.courseService.submitCourseForReview(id, req.user);
    }
    revertCourseToDraft(id, req) {
        return this.courseService.revertCourseToDraft(id, req.user);
    }
    reviewCourse(id, dto, req) {
        return this.courseService.reviewCourse(id, dto.action, req.user);
    }
    updateCourseStatus(id, status) {
        return this.courseService.updateCourseStatus(id, status);
    }
    deleteCourse(id, req) {
        return this.courseService.deleteCourse(id, req.user);
    }
    createClass(courseId, dto, req) {
        return this.courseService.createClass(courseId, req.user, dto);
    }
    updateClass(classId, dto, req) {
        return this.courseService.updateClass(classId, req.user, dto);
    }
    deleteClass(classId, req) {
        return this.courseService.deleteClass(classId, req.user);
    }
    enrollInClass(classId, req) {
        return this.courseService.enrollInClass(classId, req.user.id);
    }
    getClassById(classId, req) {
        return this.courseService.getClassById(classId, req.user?.id, req.user?.role);
    }
    createLesson(courseId, dto, req) {
        return this.courseService.createLesson(courseId, req.user, dto);
    }
    updateLesson(lessonId, dto, req) {
        return this.courseService.updateLesson(lessonId, req.user, dto);
    }
    deleteLesson(lessonId, req) {
        return this.courseService.deleteLesson(lessonId, req.user);
    }
    reorderLessons(courseId, dto, req) {
        return this.courseService.reorderLessons(courseId, req.user, dto.lessonIds);
    }
    createMaterial(lessonId, dto, req) {
        return this.courseService.createMaterial(lessonId, req.user, dto);
    }
    updateMaterial(materialId, dto, req) {
        return this.courseService.updateMaterial(materialId, req.user, dto);
    }
    deleteMaterial(materialId, req) {
        return this.courseService.deleteMaterial(materialId, req.user);
    }
};
exports.CourseController = CourseController;
__decorate([
    (0, common_1.Post)(),
    (0, roles_decorator_1.Roles)(client_1.Role.ADMIN, client_1.Role.TEACHER),
    (0, swagger_1.ApiOperation)({
        summary: 'Tạo khóa học mới (TEACHER tạo mặc định DRAFT, ADMIN có thể chỉ định teacher)',
    }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [course_dto_1.CreateCourseDto, Object]),
    __metadata("design:returntype", void 0)
], CourseController.prototype, "createCourse", null);
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'Lấy danh sách tất cả khóa học' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('role')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], CourseController.prototype, "getAllCourses", null);
__decorate([
    (0, common_1.Get)('my-courses'),
    (0, roles_decorator_1.Roles)(client_1.Role.ADMIN, client_1.Role.TEACHER),
    (0, swagger_1.ApiOperation)({ summary: 'Lấy danh sách khóa học do mình tạo (Teacher)' }),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], CourseController.prototype, "getMyCourses", null);
__decorate([
    (0, common_1.Get)('classes'),
    (0, swagger_1.ApiOperation)({
        summary: 'Lấy danh sách các lớp học của người dùng (Giáo viên hoặc Học sinh)',
    }),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], CourseController.prototype, "getUserClasses", null);
__decorate([
    (0, common_1.Get)(':courseId/my-enrollments'),
    (0, roles_decorator_1.Roles)(client_1.Role.STUDENT),
    (0, swagger_1.ApiOperation)({
        summary: 'Lấy trạng thái ghi danh của học viên trong các lớp của khóa học',
    }),
    __param(0, (0, common_1.Param)('courseId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", void 0)
], CourseController.prototype, "getMyEnrollmentsInCourse", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Lấy chi tiết một khóa học' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", void 0)
], CourseController.prototype, "getCourseById", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, roles_decorator_1.Roles)(client_1.Role.ADMIN, client_1.Role.TEACHER),
    (0, swagger_1.ApiOperation)({
        summary: 'Cập nhật khóa học (Teacher cập nhật của mình, Admin cập nhật tất cả)',
    }),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, course_dto_1.UpdateCourseDto, Object]),
    __metadata("design:returntype", void 0)
], CourseController.prototype, "updateCourse", null);
__decorate([
    (0, common_1.Post)(':id/submit-review'),
    (0, roles_decorator_1.Roles)(client_1.Role.ADMIN, client_1.Role.TEACHER),
    (0, swagger_1.ApiOperation)({
        summary: 'Gửi khóa học để Admin duyệt (DRAFT -> PENDING_REVIEW)',
    }),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", void 0)
], CourseController.prototype, "submitCourseForReview", null);
__decorate([
    (0, common_1.Post)(':id/revert-to-draft'),
    (0, roles_decorator_1.Roles)(client_1.Role.ADMIN, client_1.Role.TEACHER),
    (0, swagger_1.ApiOperation)({
        summary: 'Chuyển khóa học về Bản nháp (DRAFT) để chỉnh sửa giáo trình',
    }),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", void 0)
], CourseController.prototype, "revertCourseToDraft", null);
__decorate([
    (0, common_1.Post)(':id/review'),
    (0, roles_decorator_1.Roles)(client_1.Role.ADMIN),
    (0, swagger_1.ApiOperation)({
        summary: 'Admin duyệt hoặc từ chối khóa học (APPROVE -> PUBLISHED, REJECT -> DRAFT)',
    }),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, course_dto_1.ReviewCourseDto, Object]),
    __metadata("design:returntype", void 0)
], CourseController.prototype, "reviewCourse", null);
__decorate([
    (0, common_1.Post)(':id/status'),
    (0, roles_decorator_1.Roles)(client_1.Role.ADMIN),
    (0, swagger_1.ApiOperation)({ summary: 'Cập nhật trạng thái khóa học (Duyệt/Từ chối)' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)('status')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, String]),
    __metadata("design:returntype", void 0)
], CourseController.prototype, "updateCourseStatus", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, roles_decorator_1.Roles)(client_1.Role.ADMIN, client_1.Role.TEACHER),
    (0, swagger_1.ApiOperation)({
        summary: 'Xóa khóa học (Admin xóa tự do, Teacher xóa khóa học draft của mình)',
    }),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", void 0)
], CourseController.prototype, "deleteCourse", null);
__decorate([
    (0, common_1.Post)(':courseId/classes'),
    (0, roles_decorator_1.Roles)(client_1.Role.ADMIN, client_1.Role.TEACHER),
    (0, swagger_1.ApiOperation)({
        summary: 'Tạo lớp học mới cho khóa học (Bắt buộc Course PUBLISHED, kiểm tra quyền sở hữu)',
    }),
    __param(0, (0, common_1.Param)('courseId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, course_dto_1.CreateClassDto, Object]),
    __metadata("design:returntype", void 0)
], CourseController.prototype, "createClass", null);
__decorate([
    (0, common_1.Patch)('classes/:classId'),
    (0, roles_decorator_1.Roles)(client_1.Role.ADMIN, client_1.Role.TEACHER),
    (0, swagger_1.ApiOperation)({ summary: 'Cập nhật thông tin lớp học (kiểm tra ownership)' }),
    __param(0, (0, common_1.Param)('classId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, course_dto_1.UpdateClassDto, Object]),
    __metadata("design:returntype", void 0)
], CourseController.prototype, "updateClass", null);
__decorate([
    (0, common_1.Delete)('classes/:classId'),
    (0, roles_decorator_1.Roles)(client_1.Role.ADMIN, client_1.Role.TEACHER),
    (0, swagger_1.ApiOperation)({ summary: 'Xóa lớp học (kiểm tra ownership)' }),
    __param(0, (0, common_1.Param)('classId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", void 0)
], CourseController.prototype, "deleteClass", null);
__decorate([
    (0, common_1.Post)('classes/:classId/enroll'),
    (0, roles_decorator_1.Roles)(client_1.Role.STUDENT),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, swagger_1.ApiOperation)({
        summary: 'Học viên ghi danh vào lớp học (Kiểm tra trạng thái & capacity)',
    }),
    __param(0, (0, common_1.Param)('classId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", void 0)
], CourseController.prototype, "enrollInClass", null);
__decorate([
    (0, common_1.Get)('classes/:classId'),
    (0, swagger_1.ApiOperation)({ summary: 'Lấy chi tiết lớp học (chứa Lessons và Materials)' }),
    __param(0, (0, common_1.Param)('classId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", void 0)
], CourseController.prototype, "getClassById", null);
__decorate([
    (0, common_1.Post)(':courseId/lessons'),
    (0, roles_decorator_1.Roles)(client_1.Role.ADMIN, client_1.Role.TEACHER),
    (0, swagger_1.ApiOperation)({ summary: 'Tạo bài học mới cho khóa học' }),
    __param(0, (0, common_1.Param)('courseId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, course_dto_1.CreateLessonDto, Object]),
    __metadata("design:returntype", void 0)
], CourseController.prototype, "createLesson", null);
__decorate([
    (0, common_1.Patch)('lessons/:lessonId'),
    (0, roles_decorator_1.Roles)(client_1.Role.ADMIN, client_1.Role.TEACHER),
    (0, swagger_1.ApiOperation)({ summary: 'Cập nhật thông tin bài học' }),
    __param(0, (0, common_1.Param)('lessonId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, course_dto_1.UpdateLessonDto, Object]),
    __metadata("design:returntype", void 0)
], CourseController.prototype, "updateLesson", null);
__decorate([
    (0, common_1.Delete)('lessons/:lessonId'),
    (0, roles_decorator_1.Roles)(client_1.Role.ADMIN, client_1.Role.TEACHER),
    (0, swagger_1.ApiOperation)({ summary: 'Xóa bài học' }),
    __param(0, (0, common_1.Param)('lessonId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", void 0)
], CourseController.prototype, "deleteLesson", null);
__decorate([
    (0, common_1.Post)(':courseId/lessons/reorder'),
    (0, roles_decorator_1.Roles)(client_1.Role.ADMIN, client_1.Role.TEACHER),
    (0, swagger_1.ApiOperation)({ summary: 'Sắp xếp thứ tự các bài học trong khóa học' }),
    __param(0, (0, common_1.Param)('courseId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, course_dto_1.ReorderLessonsDto, Object]),
    __metadata("design:returntype", void 0)
], CourseController.prototype, "reorderLessons", null);
__decorate([
    (0, common_1.Post)('lessons/:lessonId/materials'),
    (0, roles_decorator_1.Roles)(client_1.Role.ADMIN, client_1.Role.TEACHER),
    (0, swagger_1.ApiOperation)({ summary: 'Thêm tài liệu cho bài học' }),
    __param(0, (0, common_1.Param)('lessonId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, course_dto_1.CreateMaterialDto, Object]),
    __metadata("design:returntype", void 0)
], CourseController.prototype, "createMaterial", null);
__decorate([
    (0, common_1.Patch)('materials/:materialId'),
    (0, roles_decorator_1.Roles)(client_1.Role.ADMIN, client_1.Role.TEACHER),
    (0, swagger_1.ApiOperation)({ summary: 'Cập nhật tài liệu học tập' }),
    __param(0, (0, common_1.Param)('materialId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, course_dto_1.UpdateMaterialDto, Object]),
    __metadata("design:returntype", void 0)
], CourseController.prototype, "updateMaterial", null);
__decorate([
    (0, common_1.Delete)('materials/:materialId'),
    (0, roles_decorator_1.Roles)(client_1.Role.ADMIN, client_1.Role.TEACHER),
    (0, swagger_1.ApiOperation)({ summary: 'Xóa tài liệu học tập' }),
    __param(0, (0, common_1.Param)('materialId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", void 0)
], CourseController.prototype, "deleteMaterial", null);
exports.CourseController = CourseController = __decorate([
    (0, swagger_1.ApiTags)('courses'),
    (0, common_1.Controller)('courses'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, swagger_1.ApiBearerAuth)(),
    __metadata("design:paramtypes", [course_service_1.CourseService])
], CourseController);
//# sourceMappingURL=course.controller.js.map