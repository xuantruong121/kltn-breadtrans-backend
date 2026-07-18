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
var SpeakingService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpeakingService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const ai_service_1 = require("../ai/ai.service");
const upload_service_1 = require("../upload/upload.service");
let SpeakingService = SpeakingService_1 = class SpeakingService {
    prisma;
    aiService;
    uploadService;
    logger = new common_1.Logger(SpeakingService_1.name);
    constructor(prisma, aiService, uploadService) {
        this.prisma = prisma;
        this.aiService = aiService;
        this.uploadService = uploadService;
    }
    async findAllExercises(category) {
        return this.prisma.speakingExercise.findMany({
            where: category ? { category } : {},
            orderBy: { createdAt: 'desc' },
        });
    }
    async findExerciseById(id) {
        const exercise = await this.prisma.speakingExercise.findUnique({
            where: { id },
        });
        if (!exercise) {
            throw new common_1.NotFoundException(`Speaking exercise #${id} not found`);
        }
        return exercise;
    }
    async createExercise(dto) {
        return this.prisma.speakingExercise.create({
            data: {
                title: dto.title,
                targetText: dto.targetText,
                difficulty: dto.difficulty || 'BEGINNER',
                category: dto.category || 'GENERAL',
            },
        });
    }
    async submitAudio(exerciseId, userId, audioFile) {
        const DAILY_LIMIT = 10;
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const submissionsToday = await this.prisma.speakingSubmission.count({
            where: {
                userId,
                submittedAt: {
                    gte: startOfDay,
                },
            },
        });
        if (submissionsToday >= DAILY_LIMIT) {
            throw new common_1.BadRequestException(`Bạn đã đạt giới hạn chấm điểm phát âm hôm nay (${DAILY_LIMIT} lần). Vui lòng quay lại vào ngày mai để luyện tập tiếp nhé!`);
        }
        const exercise = await this.findExerciseById(exerciseId);
        this.logger.log(`Uploading audio for exercise #${exerciseId} by user #${userId}`);
        const uploadResult = await this.uploadService.uploadStream(audioFile.buffer, {
            folder: 'speaking_audio',
            resource_type: 'video',
        });
        const audioUrl = uploadResult.secure_url;
        this.logger.log('Sending audio to AI Evaluator (Azure+Gemini)...');
        const aiFeedback = await this.aiService.assessPronunciation(exercise.targetText, audioFile.buffer);
        const submission = await this.prisma.speakingSubmission.create({
            data: {
                exerciseId,
                userId,
                audioUrl,
                overallScore: aiFeedback.overallScore,
                aiFeedback: aiFeedback,
            },
        });
        return {
            submissionId: submission.id,
            audioUrl,
            assessment: aiFeedback,
        };
    }
    async getMySubmissions(userId) {
        return this.prisma.speakingSubmission.findMany({
            where: { userId },
            include: { exercise: true },
            orderBy: { submittedAt: 'desc' },
        });
    }
};
exports.SpeakingService = SpeakingService;
exports.SpeakingService = SpeakingService = SpeakingService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        ai_service_1.AiService,
        upload_service_1.UploadService])
], SpeakingService);
//# sourceMappingURL=speaking.service.js.map