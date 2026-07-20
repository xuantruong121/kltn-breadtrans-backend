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
exports.ReadingController = void 0;
const common_1 = require("@nestjs/common");
const reading_service_1 = require("./reading.service");
const client_1 = require("@prisma/client");
const swagger_1 = require("@nestjs/swagger");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
let ReadingController = class ReadingController {
    readingService;
    constructor(readingService) {
        this.readingService = readingService;
    }
    getTopicsByCategory(category, req) {
        return this.readingService.getTopicsByCategory(category, req.user.id);
    }
    getTopicDetails(id) {
        return this.readingService.getTopicDetails(id);
    }
    getQuizTheory(id) {
        return this.readingService.getQuizTheory(id);
    }
    getBilingualProgress(req) {
        return this.readingService.getBilingualProgress(req.user.id);
    }
};
exports.ReadingController = ReadingController;
__decorate([
    (0, common_1.Get)('topics'),
    (0, swagger_1.ApiOperation)({ summary: 'Lấy danh sách các chủ đề (kèm tiến độ học tập)' }),
    (0, swagger_1.ApiQuery)({ name: 'category', enum: client_1.TopicCategory }),
    __param(0, (0, common_1.Query)('category')),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], ReadingController.prototype, "getTopicsByCategory", null);
__decorate([
    (0, common_1.Get)('topics/:id'),
    (0, swagger_1.ApiOperation)({
        summary: 'Lấy chi tiết một chủ đề (gồm các bài Quizzes con)',
    }),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", void 0)
], ReadingController.prototype, "getTopicDetails", null);
__decorate([
    (0, common_1.Get)('quizzes/:id/theory'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, swagger_1.ApiOperation)({ summary: 'Lấy nội dung bài học lý thuyết của Quiz' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", void 0)
], ReadingController.prototype, "getQuizTheory", null);
__decorate([
    (0, common_1.Get)('bilingual-progress'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, swagger_1.ApiOperation)({ summary: 'Lấy thống kê Tiến độ phần Đọc Song Ngữ' }),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], ReadingController.prototype, "getBilingualProgress", null);
exports.ReadingController = ReadingController = __decorate([
    (0, swagger_1.ApiTags)('reading'),
    (0, common_1.Controller)('reading'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiBearerAuth)(),
    __metadata("design:paramtypes", [reading_service_1.ReadingService])
], ReadingController);
//# sourceMappingURL=reading.controller.js.map