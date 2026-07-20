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
exports.SpeakingController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const swagger_1 = require("@nestjs/swagger");
const speaking_service_1 = require("./speaking.service");
const create_exercise_dto_1 = require("./dto/create-exercise.dto");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const roles_guard_1 = require("../../common/guards/roles.guard");
const roles_decorator_1 = require("../../common/decorators/roles.decorator");
const client_1 = require("@prisma/client");
let SpeakingController = class SpeakingController {
    speakingService;
    constructor(speakingService) {
        this.speakingService = speakingService;
    }
    createExercise(dto) {
        return this.speakingService.createExercise(dto);
    }
    findAllExercises(category) {
        return this.speakingService.findAllExercises(category);
    }
    findOne(id) {
        return this.speakingService.findExerciseById(id);
    }
    submitAudio(exerciseId, req, audio) {
        return this.speakingService.submitAudio(exerciseId, req.user.id, audio);
    }
    getMySubmissions(req) {
        return this.speakingService.getMySubmissions(req.user.id);
    }
};
exports.SpeakingController = SpeakingController;
__decorate([
    (0, common_1.Post)('exercises'),
    (0, common_1.UseGuards)(roles_guard_1.RolesGuard),
    (0, roles_decorator_1.Roles)(client_1.Role.ADMIN, client_1.Role.TEACHER),
    (0, swagger_1.ApiOperation)({ summary: '[Admin/Teacher] Tạo bài tập phát âm mới' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_exercise_dto_1.CreateExerciseDto]),
    __metadata("design:returntype", void 0)
], SpeakingController.prototype, "createExercise", null);
__decorate([
    (0, common_1.Get)('exercises'),
    (0, swagger_1.ApiOperation)({ summary: 'Lấy danh sách bài tập phát âm' }),
    (0, swagger_1.ApiQuery)({
        name: 'category',
        required: false,
        enum: ['IELTS', 'TOEIC', 'GENERAL'],
    }),
    __param(0, (0, common_1.Query)('category')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], SpeakingController.prototype, "findAllExercises", null);
__decorate([
    (0, common_1.Get)('exercises/:id'),
    (0, swagger_1.ApiOperation)({ summary: 'Lấy thông tin chi tiết một bài tập' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", void 0)
], SpeakingController.prototype, "findOne", null);
__decorate([
    (0, common_1.Post)('exercises/:id/submit'),
    (0, swagger_1.ApiOperation)({
        summary: 'Nộp audio để AI chấm phát âm (Azure Speech)',
        description: 'Upload file audio WAV (16kHz). Hệ thống sẽ dùng Azure để lấy điểm chi tiết và Gemini để sinh lời khuyên.',
    }),
    (0, swagger_1.ApiConsumes)('multipart/form-data'),
    (0, swagger_1.ApiBody)({
        description: 'File audio giọng đọc',
        schema: {
            type: 'object',
            required: ['audio'],
            properties: {
                audio: {
                    type: 'string',
                    format: 'binary',
                    description: 'File audio (.wav) - tối đa 10MB',
                },
            },
        },
    }),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('audio')),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Request)()),
    __param(2, (0, common_1.UploadedFile)(new common_1.ParseFilePipe({
        validators: [new common_1.MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 })],
    }))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object, Object]),
    __metadata("design:returntype", void 0)
], SpeakingController.prototype, "submitAudio", null);
__decorate([
    (0, common_1.Get)('my-submissions'),
    (0, swagger_1.ApiOperation)({ summary: 'Xem lịch sử bài luyện phát âm của tôi' }),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], SpeakingController.prototype, "getMySubmissions", null);
exports.SpeakingController = SpeakingController = __decorate([
    (0, swagger_1.ApiTags)('Speaking Practice'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Controller)('speaking'),
    __metadata("design:paramtypes", [speaking_service_1.SpeakingService])
], SpeakingController);
//# sourceMappingURL=speaking.controller.js.map