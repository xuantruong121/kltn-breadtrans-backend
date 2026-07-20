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
exports.ReadingService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const client_1 = require("@prisma/client");
let ReadingService = class ReadingService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getTopicsByCategory(category, userId) {
        const topics = await this.prisma.practiceTopic.findMany({
            where: { category },
            orderBy: { order: 'asc' },
            include: {
                quizzes: {
                    include: {
                        questions: true,
                    }
                }
            }
        });
        const userResults = await this.prisma.result.findMany({
            where: {
                submission: {
                    userId: userId,
                    quiz: {
                        practiceTopic: {
                            category: category
                        }
                    }
                }
            }
        });
        const correctQuestionIds = new Set(userResults.filter(r => r.isCorrect).map(r => r.questionId));
        const completedQuestionIds = new Set(userResults.map(r => r.questionId));
        return topics.map(topic => {
            let totalQuestions = 0;
            let completedCount = 0;
            let correctCount = 0;
            let completedArticles = 0;
            topic.quizzes.forEach(quiz => {
                const allQuestions = quiz.questions;
                totalQuestions += allQuestions.length;
                let isQuizCompleted = true;
                if (allQuestions.length === 0)
                    isQuizCompleted = false;
                allQuestions.forEach(q => {
                    if (completedQuestionIds.has(q.id)) {
                        completedCount++;
                    }
                    else {
                        isQuizCompleted = false;
                    }
                    if (correctQuestionIds.has(q.id))
                        correctCount++;
                });
                if (isQuizCompleted)
                    completedArticles++;
            });
            return {
                id: topic.id,
                name: topic.name,
                vietnameseName: topic.vietnameseName,
                iconUrl: topic.iconUrl,
                totalQuestions,
                completedQuestions: completedCount,
                correctAnswers: correctCount,
                incorrectAnswers: completedCount - correctCount,
                completedArticles,
                totalArticles: topic.quizzes.length
            };
        });
    }
    async getTopicDetails(topicId) {
        const topic = await this.prisma.practiceTopic.findUnique({
            where: { id: topicId },
            include: {
                quizzes: {
                    select: {
                        id: true,
                        title: true,
                        description: true,
                        type: true,
                        bilingualContent: true,
                        timeLimit: true,
                        _count: {
                            select: { questions: true }
                        }
                    },
                    orderBy: { createdAt: 'asc' }
                }
            }
        });
        if (!topic)
            throw new common_1.NotFoundException('Topic not found');
        return topic;
    }
    async getQuizTheory(quizId) {
        const quiz = await this.prisma.quiz.findUnique({
            where: { id: quizId },
            select: {
                id: true,
                title: true,
                theoryContent: true
            }
        });
        if (!quiz)
            throw new common_1.NotFoundException('Quiz not found');
        return quiz;
    }
    async getBilingualProgress(userId) {
        const bilingualQuizzes = await this.prisma.quiz.findMany({
            where: {
                practiceTopic: {
                    category: client_1.TopicCategory.BILINGUAL_LEVEL
                }
            },
            include: {
                questions: true
            }
        });
        const userResults = await this.prisma.result.findMany({
            where: {
                submission: {
                    userId: userId,
                    quiz: {
                        practiceTopic: {
                            category: client_1.TopicCategory.BILINGUAL_LEVEL
                        }
                    }
                }
            }
        });
        const correctQuestionIds = new Set(userResults.filter(r => r.isCorrect).map(r => r.questionId));
        const completedQuestionIds = new Set(userResults.map(r => r.questionId));
        let completedArticles = 0;
        let sentencesRead = 0;
        let questionsAnswered = 0;
        let correctAnswers = 0;
        const completedArticlesList = [];
        bilingualQuizzes.forEach(quiz => {
            let isCompleted = true;
            let qAnswered = 0;
            let qCorrect = 0;
            if (quiz.questions.length === 0)
                isCompleted = false;
            quiz.questions.forEach(q => {
                if (completedQuestionIds.has(q.id)) {
                    qAnswered++;
                }
                else {
                    isCompleted = false;
                }
                if (correctQuestionIds.has(q.id))
                    qCorrect++;
            });
            questionsAnswered += qAnswered;
            correctAnswers += qCorrect;
            if (isCompleted) {
                completedArticles++;
                const contentArray = quiz.bilingualContent;
                const sCount = contentArray ? contentArray.length : 0;
                sentencesRead += sCount;
                completedArticlesList.push({
                    title: quiz.title,
                    sentencesCount: sCount,
                    questionsCount: quiz.questions.length
                });
            }
        });
        return {
            completedArticles,
            sentencesRead,
            questionsAnswered,
            accuracy: questionsAnswered === 0 ? 0 : Math.round((correctAnswers / questionsAnswered) * 100),
            completedArticlesList
        };
    }
};
exports.ReadingService = ReadingService;
exports.ReadingService = ReadingService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ReadingService);
//# sourceMappingURL=reading.service.js.map