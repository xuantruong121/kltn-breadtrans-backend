import { QuizService } from './quiz.service';
import { CreateQuizDto, CreateQuestionDto, SubmitQuizDto } from './dto/quiz.dto';
export declare class QuizController {
    private readonly quizService;
    constructor(quizService: QuizService);
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
    getListeningPractices(req: any): Promise<{
        isCompleted: boolean;
        _count: {
            questions: number;
        };
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
    }[]>;
    getQuizById(id: number): Promise<{
        questions: {
            type: string;
            id: number;
            quizId: number;
            order: number;
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
        quizId: number;
        order: number;
        content: import("@prisma/client/runtime/library").JsonValue;
    }>;
    submitQuiz(quizId: number, dto: SubmitQuizDto, req: any): Promise<{
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
        userId: number;
        score: number | null;
        submittedAt: Date;
        aiFeedback: string | null;
    }>;
    getSubmissionAnalytics(id: number): Promise<{
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
            quizId: number;
            order: number;
            content: import("@prisma/client/runtime/library").JsonValue;
        }[];
        strengths: string[];
        weaknesses: string[];
        recommendation: string;
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
}
