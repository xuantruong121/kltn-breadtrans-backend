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
exports.AiController = exports.GenerateToeicDto = exports.ChatDto = void 0;
const common_1 = require("@nestjs/common");
const ai_service_1 = require("./ai.service");
const swagger_1 = require("@nestjs/swagger");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const class_validator_1 = require("class-validator");
class ChatDto {
    prompt;
}
exports.ChatDto = ChatDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'Can you explain the difference between present perfect and past simple?',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], ChatDto.prototype, "prompt", void 0);
class GenerateToeicDto {
    topic;
    part;
    count;
}
exports.GenerateToeicDto = GenerateToeicDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'Office Equipment' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], GenerateToeicDto.prototype, "topic", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 5 }),
    __metadata("design:type", Number)
], GenerateToeicDto.prototype, "part", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 5 }),
    __metadata("design:type", Number)
], GenerateToeicDto.prototype, "count", void 0);
let AiController = class AiController {
    aiService;
    constructor(aiService) {
        this.aiService = aiService;
    }
    async chat(chatDto) {
        const reply = await this.aiService.chat(chatDto.prompt);
        return { reply };
    }
    async generateToeicQuiz(dto) {
        const questions = await this.aiService.generateToeicQuestions(dto.topic, dto.part, dto.count);
        return { success: true, questions };
    }
    async explainToeicError(body) {
        const explanation = await this.aiService.explainToeicError(body.questionContent, body.userAnswer, body.correctAnswer);
        return { success: true, explanation };
    }
};
exports.AiController = AiController;
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.Post)('chat'),
    (0, swagger_1.ApiOperation)({ summary: 'Chat với trợ lý AI ảo (Hỗ trợ học tập)' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [ChatDto]),
    __metadata("design:returntype", Promise)
], AiController.prototype, "chat", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.Post)('generate-toeic-quiz'),
    (0, swagger_1.ApiOperation)({ summary: 'Sinh bộ câu hỏi TOEIC tự động theo chủ đề' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [GenerateToeicDto]),
    __metadata("design:returntype", Promise)
], AiController.prototype, "generateToeicQuiz", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.Post)('explain-toeic-error/:questionId'),
    (0, swagger_1.ApiOperation)({
        summary: 'AI Gia sư giải thích tại sao câu TOEIC này bị sai',
    }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AiController.prototype, "explainToeicError", null);
exports.AiController = AiController = __decorate([
    (0, swagger_1.ApiTags)('ai'),
    (0, common_1.Controller)('ai'),
    __metadata("design:paramtypes", [ai_service_1.AiService])
], AiController);
//# sourceMappingURL=ai.controller.js.map