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
exports.QuizController = void 0;
const common_1 = require("@nestjs/common");
const quiz_service_1 = require("./quiz.service");
const quiz_dto_1 = require("./dto/quiz.dto");
const swagger_1 = require("@nestjs/swagger");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const roles_guard_1 = require("../../common/guards/roles.guard");
const roles_decorator_1 = require("../../common/decorators/roles.decorator");
const client_1 = require("@prisma/client");
let QuizController = class QuizController {
    quizService;
    constructor(quizService) {
        this.quizService = quizService;
    }
    createQuiz(dto, req) {
        return this.quizService.createQuiz(dto, req.user);
    }
    updateQuiz(id, dto, req) {
        return this.quizService.updateQuiz(id, dto, req.user);
    }
    deleteQuiz(id, req) {
        return this.quizService.deleteQuiz(id, req.user);
    }
    getAllQuizzes() {
        return this.quizService.getAllQuizzes();
    }
    getListeningPractices(req) {
        return this.quizService.getListeningPractices(req.user.id);
    }
    getQuizById(id, req) {
        const isStaff = req.user?.role === client_1.Role.ADMIN || req.user?.role === client_1.Role.TEACHER;
        return this.quizService.getQuizById(id, isStaff);
    }
    createQuestion(quizId, dto) {
        return this.quizService.createQuestion(quizId, dto);
    }
    updateQuestion(questionId, dto) {
        return this.quizService.updateQuestion(questionId, dto);
    }
    deleteQuestion(questionId) {
        return this.quizService.deleteQuestion(questionId);
    }
    submitQuiz(quizId, dto, req) {
        return this.quizService.submitQuiz(quizId, req.user.id, dto);
    }
    getSubmissionAnalytics(id) {
        return this.quizService.getSubmissionAnalytics(id);
    }
    calculateToeicScore(listeningCorrect, readingCorrect) {
        return this.quizService.calculateToeicScore(listeningCorrect, readingCorrect);
    }
};
exports.QuizController = QuizController;
__decorate([
    (0, common_1.Post)(),
    (0, roles_decorator_1.Roles)(client_1.Role.ADMIN, client_1.Role.TEACHER),
    (0, swagger_1.ApiBearerAuth)(),
    (0, swagger_1.ApiOperation)({ summary: 'Tạo bài trắc nghiệm (chỉ ADMIN/TEACHER)' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [quiz_dto_1.CreateQuizDto, Object]),
    __metadata("design:returntype", void 0)
], QuizController.prototype, "createQuiz", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, roles_decorator_1.Roles)(client_1.Role.ADMIN, client_1.Role.TEACHER),
    (0, swagger_1.ApiBearerAuth)(),
    (0, swagger_1.ApiOperation)({ summary: 'Cập nhật đề thi (chỉ ADMIN/TEACHER)' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object, Object]),
    __metadata("design:returntype", void 0)
], QuizController.prototype, "updateQuiz", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, roles_decorator_1.Roles)(client_1.Role.ADMIN, client_1.Role.TEACHER),
    (0, swagger_1.ApiBearerAuth)(),
    (0, swagger_1.ApiOperation)({ summary: 'Xóa đề thi (chỉ ADMIN/TEACHER)' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", void 0)
], QuizController.prototype, "deleteQuiz", null);
__decorate([
    (0, common_1.Get)(),
    (0, roles_decorator_1.Roles)(client_1.Role.ADMIN, client_1.Role.TEACHER),
    (0, swagger_1.ApiBearerAuth)(),
    (0, swagger_1.ApiOperation)({ summary: 'Lấy tất cả quizzes (chỉ ADMIN/TEACHER)' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], QuizController.prototype, "getAllQuizzes", null);
__decorate([
    (0, common_1.Get)('listening-practice'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, swagger_1.ApiOperation)({ summary: 'Lấy danh sách các bài Luyện Nghe (Nghe Chép)' }),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], QuizController.prototype, "getListeningPractices", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, swagger_1.ApiOperation)({ summary: 'Lấy chi tiết Quiz và danh sách Questions' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", void 0)
], QuizController.prototype, "getQuizById", null);
__decorate([
    (0, common_1.Post)(':id/questions'),
    (0, roles_decorator_1.Roles)(client_1.Role.ADMIN, client_1.Role.TEACHER),
    (0, swagger_1.ApiBearerAuth)(),
    (0, swagger_1.ApiOperation)({ summary: 'Thêm câu hỏi vào Quiz' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, quiz_dto_1.CreateQuestionDto]),
    __metadata("design:returntype", void 0)
], QuizController.prototype, "createQuestion", null);
__decorate([
    (0, common_1.Patch)('questions/:questionId'),
    (0, roles_decorator_1.Roles)(client_1.Role.ADMIN, client_1.Role.TEACHER),
    (0, swagger_1.ApiBearerAuth)(),
    (0, swagger_1.ApiOperation)({ summary: 'Cập nhật câu hỏi trong Quiz' }),
    __param(0, (0, common_1.Param)('questionId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", void 0)
], QuizController.prototype, "updateQuestion", null);
__decorate([
    (0, common_1.Delete)('questions/:questionId'),
    (0, roles_decorator_1.Roles)(client_1.Role.ADMIN, client_1.Role.TEACHER),
    (0, swagger_1.ApiBearerAuth)(),
    (0, swagger_1.ApiOperation)({ summary: 'Xóa câu hỏi khỏi Quiz' }),
    __param(0, (0, common_1.Param)('questionId', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", void 0)
], QuizController.prototype, "deleteQuestion", null);
__decorate([
    (0, common_1.Post)(':id/submit'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, swagger_1.ApiOperation)({ summary: 'Nộp bài và chấm điểm tự động (cơ bản)' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, quiz_dto_1.SubmitQuizDto, Object]),
    __metadata("design:returntype", void 0)
], QuizController.prototype, "submitQuiz", null);
__decorate([
    (0, common_1.Get)('submissions/:id/analytics'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, swagger_1.ApiOperation)({
        summary: 'Báo cáo phân tích điểm mạnh, điểm yếu và lỗ hổng kiến thức sau khi nộp bài',
    }),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", void 0)
], QuizController.prototype, "getSubmissionAnalytics", null);
__decorate([
    (0, common_1.Post)('score-conversion'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, swagger_1.ApiOperation)({
        summary: 'Quy đổi số câu đúng Listening/Reading ra thang điểm TOEIC (10 - 990)',
    }),
    __param(0, (0, common_1.Body)('listeningCorrect')),
    __param(1, (0, common_1.Body)('readingCorrect')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Number]),
    __metadata("design:returntype", void 0)
], QuizController.prototype, "calculateToeicScore", null);
exports.QuizController = QuizController = __decorate([
    (0, swagger_1.ApiTags)('quizzes'),
    (0, common_1.Controller)('quizzes'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, swagger_1.ApiBearerAuth)(),
    __metadata("design:paramtypes", [quiz_service_1.QuizService])
], QuizController);
//# sourceMappingURL=quiz.controller.js.map