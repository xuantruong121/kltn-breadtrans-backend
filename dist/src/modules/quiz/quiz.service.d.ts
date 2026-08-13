import { PrismaService } from '../../prisma/prisma.service';
import { CreateQuizDto, CreateQuestionDto, SubmitQuizDto } from './dto/quiz.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AiService } from '../ai/ai.service';
export declare class QuizService {
    private prisma;
    private eventEmitter;
    private aiService;
    constructor(prisma: PrismaService, eventEmitter: EventEmitter2, aiService: AiService);
    createQuiz(dto: CreateQuizDto): Promise<{
        title: string;
        description: string | null;
        theoryContent: string | null;
        bilingualContent: import("@prisma/client/runtime/library").JsonValue | null;
        type: import(".prisma/client").$Enums.QuizType;
        timeLimit: number | null;
        createdAt: Date;
        id: number;
        courseId: number | null;
        practiceTopicId: number | null;
    }>;
    getAllQuizzes(): Promise<({
        _count: {
            questions: number;
        };
    } & {
        title: string;
        description: string | null;
        theoryContent: string | null;
        bilingualContent: import("@prisma/client/runtime/library").JsonValue | null;
        type: import(".prisma/client").$Enums.QuizType;
        timeLimit: number | null;
        createdAt: Date;
        id: number;
        courseId: number | null;
        practiceTopicId: number | null;
    })[]>;
    getListeningPractices(): Promise<({
        _count: {
            questions: number;
        };
    } & {
        title: string;
        description: string | null;
        theoryContent: string | null;
        bilingualContent: import("@prisma/client/runtime/library").JsonValue | null;
        type: import(".prisma/client").$Enums.QuizType;
        timeLimit: number | null;
        createdAt: Date;
        id: number;
        courseId: number | null;
        practiceTopicId: number | null;
    })[]>;
    getQuizById(id: number): Promise<{
        questions: {
            type: string;
            id: number;
            order: number;
            quizId: number;
            content: import("@prisma/client/runtime/library").JsonValue;
        }[];
    } & {
        title: string;
        description: string | null;
        theoryContent: string | null;
        bilingualContent: import("@prisma/client/runtime/library").JsonValue | null;
        type: import(".prisma/client").$Enums.QuizType;
        timeLimit: number | null;
        createdAt: Date;
        id: number;
        courseId: number | null;
        practiceTopicId: number | null;
    }>;
    createQuestion(quizId: number, dto: CreateQuestionDto): Promise<{
        type: string;
        id: number;
        order: number;
        quizId: number;
        content: import("@prisma/client/runtime/library").JsonValue;
    }>;
    submitQuiz(quizId: number, userId: number, dto: SubmitQuizDto): Promise<{
        results: {
            id: number;
            score: number | null;
            questionId: number;
            answer: import("@prisma/client/runtime/library").JsonValue;
            isCorrect: boolean | null;
            submissionId: number;
        }[];
    } & {
        id: number;
        quizId: number;
        score: number | null;
        submittedAt: Date;
        aiFeedback: string | null;
        userId: number;
    }>;
    calculateToeicScore(listeningCorrect: number, readingCorrect: number): {
        listening: {
            correct: number;
            total: number;
            score: number;
        };
        reading: {
            correct: number;
            total: number;
            score: number;
        };
        totalScore: number;
    };
    getSubmissionAnalytics(submissionId: number): Promise<{
        submissionId: number;
        quizTitle: string;
        overallScore: number | null;
        totalQuestions: number;
        totalCorrect: number;
        overallAccuracyPercent: number;
        categoriesBreakdown: {
            category: string;
            correct: number;
            total: number;
            accuracyPercent: number;
        }[];
        results: {
            id: number;
            score: number | null;
            questionId: number;
            answer: import("@prisma/client/runtime/library").JsonValue;
            isCorrect: boolean | null;
            submissionId: number;
        }[];
        questions: {
            type: string;
            id: number;
            order: number;
            quizId: number;
            content: import("@prisma/client/runtime/library").JsonValue;
        }[];
        strengths: string[];
        weaknesses: string[];
        recommendation: string;
    }>;
}
