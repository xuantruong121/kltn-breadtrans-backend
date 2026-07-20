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
exports.QuizService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const event_emitter_1 = require("@nestjs/event-emitter");
const ai_service_1 = require("../ai/ai.service");
let QuizService = class QuizService {
    prisma;
    eventEmitter;
    aiService;
    constructor(prisma, eventEmitter, aiService) {
        this.prisma = prisma;
        this.eventEmitter = eventEmitter;
        this.aiService = aiService;
    }
    async createQuiz(dto) {
        return this.prisma.quiz.create({ data: dto });
    }
    async getListeningPractices() {
        return this.prisma.quiz.findMany({
            where: {
                type: 'LISTENING_PRACTICE'
            },
            include: {
                _count: {
                    select: { questions: true }
                }
            },
            orderBy: {
                id: 'desc'
            }
        });
    }
    async getQuizById(id) {
        const quiz = await this.prisma.quiz.findUnique({
            where: { id },
            include: { questions: { orderBy: { order: 'asc' } } },
        });
        if (!quiz)
            throw new common_1.NotFoundException('Quiz not found');
        return quiz;
    }
    async createQuestion(quizId, dto) {
        return this.prisma.question.create({
            data: {
                ...dto,
                quizId,
            },
        });
    }
    async submitQuiz(quizId, userId, dto) {
        const quiz = await this.getQuizById(quizId);
        let totalScore = 0;
        const resultsData = await Promise.all(dto.answers.map(async (ans) => {
            const question = quiz.questions.find((q) => q.id === ans.questionId);
            let isCorrect = false;
            let score = 0;
            if (question) {
                if (question.type === 'MULTIPLE_CHOICE') {
                    const content = question.content;
                    if (content.correct === ans.answer) {
                        isCorrect = true;
                        score = 1;
                        totalScore += score;
                    }
                }
                else if (question.type === 'WRITING') {
                    const content = question.content;
                    await this.aiService.generateFeedback(content.text || 'Write an essay.', ans.answer);
                }
            }
            return {
                questionId: ans.questionId,
                answer: ans.answer,
                isCorrect,
                score,
            };
        }));
        let overallAiFeedback = '';
        for (const ans of dto.answers) {
            const question = quiz.questions.find((q) => q.id === ans.questionId);
            if (question && question.type === 'WRITING') {
                const content = question.content;
                const feedback = await this.aiService.generateFeedback(content.text, ans.answer);
                overallAiFeedback += `Question: ${content.text}\nFeedback: ${feedback}\n\n`;
            }
        }
        const submission = await this.prisma.submission.create({
            data: {
                quizId,
                userId,
                score: totalScore,
                aiFeedback: overallAiFeedback ? overallAiFeedback : null,
                results: {
                    create: resultsData,
                },
            },
            include: {
                results: true,
            },
        });
        this.eventEmitter.emit('quiz.submitted', {
            userId,
            score: totalScore,
            submissionId: submission.id,
        });
        return submission;
    }
};
exports.QuizService = QuizService;
exports.QuizService = QuizService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        event_emitter_1.EventEmitter2,
        ai_service_1.AiService])
], QuizService);
//# sourceMappingURL=quiz.service.js.map