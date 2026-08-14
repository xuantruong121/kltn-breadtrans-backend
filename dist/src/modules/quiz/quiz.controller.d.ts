import { QuizService } from './quiz.service';
import { CreateQuizDto, CreateQuestionDto, SubmitQuizDto } from './dto/quiz.dto';
export declare class QuizController {
    private readonly quizService;
    constructor(quizService: QuizService);
    createQuiz(dto: CreateQuizDto): Promise<{
        createdAt: Date;
        id: number;
        description: string | null;
        title: string;
        theoryContent: string | null;
        bilingualContent: import("@prisma/client/runtime/library").JsonValue | null;
        type: import(".prisma/client").$Enums.QuizType;
        timeLimit: number | null;
        courseId: number | null;
        practiceTopicId: number | null;
    }>;
    getAllQuizzes(): Promise<({
        _count: {
            questions: number;
        };
    } & {
        createdAt: Date;
        id: number;
        description: string | null;
        title: string;
        theoryContent: string | null;
        bilingualContent: import("@prisma/client/runtime/library").JsonValue | null;
        type: import(".prisma/client").$Enums.QuizType;
        timeLimit: number | null;
        courseId: number | null;
        practiceTopicId: number | null;
    })[]>;
    getListeningPractices(req: any): Promise<{
        isCompleted: boolean;
        _count: {
            questions: number;
        };
        createdAt: Date;
        id: number;
        description: string | null;
        title: string;
        theoryContent: string | null;
        bilingualContent: import("@prisma/client/runtime/library").JsonValue | null;
        type: import(".prisma/client").$Enums.QuizType;
        timeLimit: number | null;
        courseId: number | null;
        practiceTopicId: number | null;
    }[]>;
    getQuizById(id: number): Promise<{
        questions: {
            id: number;
            content: import("@prisma/client/runtime/library").JsonValue;
            type: string;
            quizId: number;
            order: number;
        }[];
    } & {
        createdAt: Date;
        id: number;
        description: string | null;
        title: string;
        theoryContent: string | null;
        bilingualContent: import("@prisma/client/runtime/library").JsonValue | null;
        type: import(".prisma/client").$Enums.QuizType;
        timeLimit: number | null;
        courseId: number | null;
        practiceTopicId: number | null;
    }>;
    createQuestion(quizId: number, dto: CreateQuestionDto): Promise<{
        id: number;
        content: import("@prisma/client/runtime/library").JsonValue;
        type: string;
        quizId: number;
        order: number;
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
        userId: number;
        quizId: number;
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
            id: number;
            content: import("@prisma/client/runtime/library").JsonValue;
            type: string;
            quizId: number;
            order: number;
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
