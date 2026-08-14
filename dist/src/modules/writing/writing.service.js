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
exports.WritingService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const client_1 = require("@prisma/client");
const ai_service_1 = require("../ai/ai.service");
let WritingService = class WritingService {
    prisma;
    aiService;
    constructor(prisma, aiService) {
        this.prisma = prisma;
        this.aiService = aiService;
    }
    async getTopics(userId) {
        const categories = await this.prisma.practiceTopic.findMany({
            where: { category: client_1.TopicCategory.WRITING_PART1 },
            include: {
                _count: {
                    select: { quizzes: true },
                },
            },
        });
        const quizzes = await this.prisma.quiz.findMany({
            where: { practiceTopic: { category: client_1.TopicCategory.WRITING_PART1 } },
            include: {
                questions: true,
                practiceTopic: true,
            },
            orderBy: { id: 'desc' },
        });
        const userSubmissions = await this.prisma.submission.findMany({
            where: {
                userId,
                quizId: { in: quizzes.map((q) => q.id) },
            },
            select: { quizId: true },
        });
        const completedQuizIds = new Set(userSubmissions.map((s) => s.quizId));
        return {
            categories,
            quizzes: quizzes.map((q) => {
                const question = q.questions[0];
                const content = question.content;
                return {
                    id: q.id,
                    topicId: q.practiceTopicId,
                    topicName: q.practiceTopic?.name,
                    imageUrl: content.imageUrl,
                    keywords: content.keywords,
                    isCompleted: completedQuizIds.has(q.id),
                };
            }),
        };
    }
    async getQuizDetails(quizId) {
        const quiz = await this.prisma.quiz.findUnique({
            where: { id: quizId },
            include: { questions: true },
        });
        if (!quiz || quiz.questions.length === 0) {
            throw new common_1.NotFoundException('Quiz not found');
        }
        const question = quiz.questions[0];
        const content = question.content;
        return {
            quizId: quiz.id,
            imageUrl: content.imageUrl,
            keywords: content.keywords,
            sampleSentences: content.sampleSentences,
        };
    }
    async getCommunitySubmissions(quizId) {
        const submissions = await this.prisma.submission.findMany({
            where: { quizId },
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        profile: { select: { fullName: true } },
                    },
                },
                results: true,
            },
            orderBy: { score: 'desc' },
        });
        return submissions.map((sub) => ({
            id: sub.id,
            user: sub.user.profile?.fullName || sub.user.email,
            score: sub.score,
            answer: sub.results[0]?.answer,
            feedback: sub.aiFeedback,
            submittedAt: sub.submittedAt,
        }));
    }
    async submitWriting(quizId, userId, text) {
        const quiz = await this.prisma.quiz.findUnique({
            where: { id: quizId },
            include: { questions: true },
        });
        if (!quiz || quiz.questions.length === 0)
            throw new common_1.NotFoundException('Quiz not found');
        const question = quiz.questions[0];
        const content = question.content;
        const evaluation = await this.aiService.evaluateWritingPart1(content.imageUrl, content.keywords, text);
        const submission = await this.prisma.submission.create({
            data: {
                quizId,
                userId,
                score: evaluation.score,
                aiFeedback: evaluation.feedback,
                results: {
                    create: [
                        {
                            questionId: question.id,
                            answer: text,
                            score: evaluation.score,
                        },
                    ],
                },
            },
        });
        return {
            submissionId: submission.id,
            score: evaluation.score,
            feedback: evaluation.feedback,
        };
    }
    async submitWritingPart2(emailPrompt, userId, userResponse) {
        const evaluation = await this.aiService.evaluateWritingPart2(emailPrompt, userResponse);
        return {
            score: evaluation.score,
            maxScore: 4,
            feedback: evaluation.feedback,
            suggestions: evaluation.suggestions,
        };
    }
    async submitWritingPart3(essayTopic, userId, userEssay) {
        const evaluation = await this.aiService.evaluateWritingPart3(essayTopic, userEssay);
        return {
            score: evaluation.score,
            maxScore: 5,
            feedback: evaluation.feedback,
            suggestions: evaluation.suggestions,
        };
    }
};
exports.WritingService = WritingService;
exports.WritingService = WritingService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        ai_service_1.AiService])
], WritingService);
//# sourceMappingURL=writing.service.js.map