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
exports.AiController = exports.GenerateDictationDto = exports.GenerateToeicDto = exports.ChatDto = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const prisma_service_1 = require("../../prisma/prisma.service");
const ai_service_1 = require("./ai.service");
const upload_service_1 = require("../upload/upload.service");
const swagger_1 = require("@nestjs/swagger");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const roles_guard_1 = require("../../common/guards/roles.guard");
const roles_decorator_1 = require("../../common/decorators/roles.decorator");
const client_1 = require("@prisma/client");
const ai_rate_limit_guard_1 = require("../../common/guards/ai-rate-limit.guard");
const class_validator_1 = require("class-validator");
class ChatDto {
    prompt;
    messages;
}
exports.ChatDto = ChatDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'Can you explain the difference between present perfect and past simple?',
        required: false,
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ChatDto.prototype, "prompt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        required: false,
        type: 'array',
        items: { type: 'object' },
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    __metadata("design:type", Array)
], ChatDto.prototype, "messages", void 0);
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
class GenerateDictationDto {
    topic;
    count;
}
exports.GenerateDictationDto = GenerateDictationDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'Daily conversation at the restaurant' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], GenerateDictationDto.prototype, "topic", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 5, description: 'Number of sentences to generate' }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", Number)
], GenerateDictationDto.prototype, "count", void 0);
let AiController = class AiController {
    aiService;
    prisma;
    uploadService;
    constructor(aiService, prisma, uploadService) {
        this.aiService = aiService;
        this.prisma = prisma;
        this.uploadService = uploadService;
    }
    async chat(chatDto) {
        let textPrompt = chatDto.prompt;
        if (!textPrompt && chatDto.messages && chatDto.messages.length > 0) {
            const lastUserMsg = [...chatDto.messages]
                .reverse()
                .find((m) => m.role === 'user');
            textPrompt = lastUserMsg
                ? lastUserMsg.content
                : chatDto.messages[chatDto.messages.length - 1].content;
        }
        if (!textPrompt) {
            throw new common_1.BadRequestException('Vui lòng cung cấp nội dung câu hỏi (prompt hoặc messages)');
        }
        const reply = await this.aiService.chat(textPrompt);
        return { reply, answer: reply };
    }
    async generateDictation(dto) {
        const questions = await this.aiService.generateDictation(dto.topic, dto.count);
        const newQuiz = await this.prisma.quiz.create({
            data: {
                title: `Bài luyện nghe: ${dto.topic}`,
                description: 'Được tạo tự động bởi AI',
                type: 'LISTENING_PRACTICE',
            },
        });
        const questionData = [];
        for (let i = 0; i < questions.length; i++) {
            const q = questions[i];
            let audioUrl = '';
            const audioBuffer = await this.aiService.generateTtsAudio(q.transcript);
            if (audioBuffer) {
                const uploadResult = await this.uploadService.uploadRawBuffer(audioBuffer, 'audio/mpeg', 'dictation_audio');
                audioUrl = uploadResult.url;
            }
            questionData.push({
                quizId: newQuiz.id,
                type: 'DICTATION',
                content: {
                    part: 1,
                    audioUrl: audioUrl,
                    transcript: q.transcript,
                    translation: q.translation,
                    words: String(q.transcript)
                        .replace(/[^\w\s']/g, '')
                        .split(' ')
                        .filter((w) => w.length > 0),
                },
                order: i + 1,
            });
        }
        await this.prisma.question.createMany({
            data: questionData,
        });
        return {
            success: true,
            message: `Đã tạo ${questions.length} câu luyện nghe.`,
            quizId: newQuiz.id,
        };
    }
    async generateToeicQuiz(dto) {
        const questions = await this.aiService.generateToeicQuestions(dto.topic, dto.part, dto.count);
        return { success: true, questions };
    }
    async explainToeicError(body) {
        const explanation = await this.aiService.explainToeicError(body.questionContent, body.userAnswer, body.correctAnswer);
        return { success: true, explanation };
    }
    async importEtsPdf(files) {
        const pdfFile = files?.pdfFile?.[0];
        const audioFile = files?.audioFile?.[0];
        if (!pdfFile) {
            throw new common_1.BadRequestException('Vui lòng upload file PDF hoặc hình ảnh đề thi (pdfFile).');
        }
        let audioUrl = '';
        if (audioFile) {
            const uploadResult = await this.uploadService.uploadFile(audioFile);
            audioUrl = uploadResult.url;
        }
        const questions = await this.aiService.importEtsPdf(pdfFile.buffer, pdfFile.mimetype, audioFile?.buffer, audioFile?.mimetype, audioUrl);
        if (!questions || questions.length === 0) {
            throw new common_1.BadRequestException('AI không tìm thấy câu hỏi nào trong file này.');
        }
        const newQuiz = await this.prisma.quiz.create({
            data: {
                title: `Đề thi TOEIC ETS tự động - ${new Date().toLocaleDateString('vi-VN')}`,
                description: 'Tạo tự động bởi AI Importer (PDF + Audio)',
                type: 'TOEIC',
            },
        });
        const questionData = questions.map((q, index) => ({
            quizId: newQuiz.id,
            type: q.type || 'MULTIPLE_CHOICE',
            content: q.content,
            order: index + 1,
        }));
        await this.prisma.question.createMany({
            data: questionData,
        });
        return {
            success: true,
            message: `Đã trích xuất và lưu thành công ${questions.length} câu hỏi.`,
            quizId: newQuiz.id,
        };
    }
    async getVietnameseTts(text, res) {
        if (!text) {
            return res
                .status(common_1.HttpStatus.BAD_REQUEST)
                .json({ message: 'Text is required' });
        }
        const cleanText = text
            .replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{1F200}-\u{1F2FF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA00}-\u{1FAFF}]|[\u{1F000}-\u{1F02F}]/gu, '')
            .replace(/\u200D|\uFE0E|\uFE0F/g, '')
            .trim();
        const audioBuffer = await this.aiService.generateVietnameseTtsAudio(cleanText);
        if (!audioBuffer) {
            return res
                .status(common_1.HttpStatus.INTERNAL_SERVER_ERROR)
                .json({ message: 'Failed to generate Vietnamese TTS' });
        }
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Length', audioBuffer.length);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.end(audioBuffer);
    }
};
exports.AiController = AiController;
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, ai_rate_limit_guard_1.AiRateLimitGuard),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.Post)('chat'),
    (0, swagger_1.ApiOperation)({ summary: 'Chat với trợ lý AI ảo (Hỗ trợ học tập)' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [ChatDto]),
    __metadata("design:returntype", Promise)
], AiController.prototype, "chat", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, ai_rate_limit_guard_1.AiRateLimitGuard),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.Post)('generate-dictation'),
    (0, swagger_1.ApiOperation)({ summary: 'AI tự động sinh bài Luyện Nghe (Chép chính tả)' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [GenerateDictationDto]),
    __metadata("design:returntype", Promise)
], AiController.prototype, "generateDictation", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, ai_rate_limit_guard_1.AiRateLimitGuard),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.Post)('generate-toeic-quiz'),
    (0, swagger_1.ApiOperation)({ summary: 'Sinh bộ câu hỏi TOEIC tự động theo chủ đề' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [GenerateToeicDto]),
    __metadata("design:returntype", Promise)
], AiController.prototype, "generateToeicQuiz", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, ai_rate_limit_guard_1.AiRateLimitGuard),
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
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.Post)('import-ets-pdf'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, roles_decorator_1.Roles)(client_1.Role.ADMIN, client_1.Role.TEACHER),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileFieldsInterceptor)([
        { name: 'pdfFile', maxCount: 1 },
        { name: 'audioFile', maxCount: 1 },
    ])),
    (0, swagger_1.ApiConsumes)('multipart/form-data'),
    (0, swagger_1.ApiOperation)({
        summary: 'AI tự động đọc PDF + Audio đề ETS và trích xuất vào DB (Chỉ ADMIN/TEACHER)',
    }),
    __param(0, (0, common_1.UploadedFiles)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AiController.prototype, "importEtsPdf", null);
__decorate([
    (0, common_1.Get)('tts/vietnamese'),
    (0, swagger_1.ApiOperation)({
        summary: 'Tạo giọng đọc tiếng Việt chuẩn bằng Azure Neural TTS',
    }),
    __param(0, (0, common_1.Query)('text')),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AiController.prototype, "getVietnameseTts", null);
exports.AiController = AiController = __decorate([
    (0, swagger_1.ApiTags)('ai'),
    (0, common_1.Controller)('ai'),
    __metadata("design:paramtypes", [ai_service_1.AiService,
        prisma_service_1.PrismaService,
        upload_service_1.UploadService])
], AiController);
//# sourceMappingURL=ai.controller.js.map