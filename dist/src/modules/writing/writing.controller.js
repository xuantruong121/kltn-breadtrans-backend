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
exports.WritingController = void 0;
const common_1 = require("@nestjs/common");
const writing_service_1 = require("./writing.service");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const swagger_1 = require("@nestjs/swagger");
let WritingController = class WritingController {
    writingService;
    constructor(writingService) {
        this.writingService = writingService;
    }
    getTopics() {
        return this.writingService.getTopics();
    }
    getQuizDetails(id) {
        return this.writingService.getQuizDetails(id);
    }
    getCommunitySubmissions(id) {
        return this.writingService.getCommunitySubmissions(id);
    }
    submitWriting(id, req, answer) {
        return this.writingService.submitWriting(id, req.user.id, answer);
    }
};
exports.WritingController = WritingController;
__decorate([
    (0, common_1.Get)('topics'),
    (0, swagger_1.ApiOperation)({
        summary: 'Lấy danh sách các chủ điểm và bài viết Writing Part 1',
    }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], WritingController.prototype, "getTopics", null);
__decorate([
    (0, common_1.Get)('quizzes/:id'),
    (0, swagger_1.ApiOperation)({ summary: 'Lấy chi tiết 1 bài tập Writing Part 1' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", void 0)
], WritingController.prototype, "getQuizDetails", null);
__decorate([
    (0, common_1.Get)('quizzes/:id/community'),
    (0, swagger_1.ApiOperation)({ summary: 'Lấy bài nộp của cộng đồng cho 1 bài tập' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", void 0)
], WritingController.prototype, "getCommunitySubmissions", null);
__decorate([
    (0, common_1.Post)('quizzes/:id/submit'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiBearerAuth)(),
    (0, swagger_1.ApiOperation)({ summary: 'Nộp bài và chấm điểm bằng AI' }),
    (0, swagger_1.ApiBody)({
        schema: { type: 'object', properties: { answer: { type: 'string' } } },
    }),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Request)()),
    __param(2, (0, common_1.Body)('answer')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object, String]),
    __metadata("design:returntype", void 0)
], WritingController.prototype, "submitWriting", null);
exports.WritingController = WritingController = __decorate([
    (0, swagger_1.ApiTags)('Writing'),
    (0, common_1.Controller)('writing'),
    __metadata("design:paramtypes", [writing_service_1.WritingService])
], WritingController);
//# sourceMappingURL=writing.controller.js.map