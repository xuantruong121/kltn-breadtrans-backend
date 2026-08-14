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
    async getAllQuizzes() {
        return this.prisma.quiz.findMany({
            include: {
                _count: {
                    select: { questions: true },
                },
            },
            orderBy: {
                id: 'desc',
            },
        });
    }
    async getListeningPractices(userId) {
        const quizzes = await this.prisma.quiz.findMany({
            where: {
                type: 'LISTENING_PRACTICE',
            },
            include: {
                _count: {
                    select: { questions: true },
                },
            },
            orderBy: {
                id: 'desc',
            },
        });
        const userSubmissions = await this.prisma.submission.findMany({
            where: {
                userId,
                quizId: { in: quizzes.map((q) => q.id) },
            },
            select: { quizId: true },
        });
        const completedQuizIds = new Set(userSubmissions.map((s) => s.quizId));
        return quizzes.map((quiz) => ({
            ...quiz,
            isCompleted: completedQuizIds.has(quiz.id),
        }));
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
                else if (question.type === 'DICTATION' ||
                    question.type === 'FILL_IN_BLANK') {
                    const content = question.content;
                    const cleanCorrect = String(content.correctAnswer || content.correct || '')
                        .toLowerCase()
                        .replace(/[.,!?]/g, '')
                        .trim();
                    const cleanAns = String(ans.answer || '')
                        .toLowerCase()
                        .replace(/[.,!?]/g, '')
                        .trim();
                    if (cleanCorrect === cleanAns) {
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
    calculateToeicScore(listeningCorrect, readingCorrect) {
        const lCorrect = Math.min(100, Math.max(0, listeningCorrect));
        const rCorrect = Math.min(100, Math.max(0, readingCorrect));
        const convertListening = (c) => {
            if (c <= 5)
                return 5;
            if (c >= 96)
                return 495;
            return Math.round(5 + (c - 5) * (490 / 91));
        };
        const convertReading = (c) => {
            if (c <= 5)
                return 5;
            if (c >= 96)
                return 495;
            return Math.round(5 + (c - 5) * (490 / 91));
        };
        const listeningScore = convertListening(lCorrect);
        const readingScore = convertReading(rCorrect);
        const totalScore = listeningScore + readingScore;
        return {
            listening: { correct: lCorrect, total: 100, score: listeningScore },
            reading: { correct: rCorrect, total: 100, score: readingScore },
            totalScore,
        };
    }
    async getSubmissionAnalytics(submissionId) {
        const submission = await this.prisma.submission.findUnique({
            where: { id: submissionId },
            include: {
                quiz: {
                    include: {
                        questions: true,
                    },
                },
                results: true,
            },
        });
        if (!submission)
            throw new common_1.NotFoundException('Submission not found');
        const tagStats = {};
        let totalCorrect = 0;
        const totalQuestions = submission.results.length;
        submission.results.forEach((res) => {
            if (res.isCorrect)
                totalCorrect++;
            const question = submission.quiz.questions.find((q) => q.id === res.questionId);
            const content = question?.content;
            const category = content?.category || question?.type || 'General';
            if (!tagStats[category]) {
                tagStats[category] = { correct: 0, total: 0 };
            }
            tagStats[category].total += 1;
            if (res.isCorrect) {
                tagStats[category].correct += 1;
            }
        });
        const categoriesBreakdown = Object.entries(tagStats).map(([category, stat]) => {
            const accuracy = stat.total > 0 ? Math.round((stat.correct / stat.total) * 100) : 0;
            return {
                category,
                correct: stat.correct,
                total: stat.total,
                accuracyPercent: accuracy,
            };
        });
        const strengths = categoriesBreakdown
            .filter((c) => c.accuracyPercent >= 75)
            .map((c) => c.category);
        const weaknesses = categoriesBreakdown
            .filter((c) => c.accuracyPercent < 50)
            .map((c) => c.category);
        const overallAccuracy = totalQuestions > 0
            ? Math.round((totalCorrect / totalQuestions) * 100)
            : 0;
        return {
            submissionId,
            quizTitle: submission.quiz.title,
            overallScore: submission.score,
            totalQuestions,
            totalCorrect,
            overallAccuracyPercent: overallAccuracy,
            categoriesBreakdown,
            results: submission.results,
            questions: submission.quiz.questions,
            strengths: strengths.length > 0
                ? strengths
                : ['Cần luyện tập thêm để xác định điểm mạnh'],
            weaknesses: weaknesses.length > 0 ? weaknesses : ['Không có điểm yếu nghiêm trọng'],
            recommendation: weaknesses.length > 0
                ? `Bạn nên tập trung ôn luyện lại các mảng kiến thức: ${weaknesses.join(', ')}.`
                : 'Thành tích rất tốt! Hãy tiếp tục duy trì và thử sức ở đề thi khó hơn.',
        };
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