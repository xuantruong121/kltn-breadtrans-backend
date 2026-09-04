import { QuizService } from './quiz.service';
import { CreateQuizDto, CreateQuestionDto, SubmitQuizDto } from './dto/quiz.dto';
export declare class QuizController {
    private readonly quizService;
    constructor(quizService: QuizService);
    createQuiz(dto: CreateQuizDto): Promise<{
        createdAt: Date;
        id: number;
        title: string;
        description: string | null;
        theoryContent: string | null;
        bilingualContent: import("@prisma/client/runtime/library").JsonValue | null;
        type: import(".prisma/client").$Enums.QuizType;
        timeLimit: number | null;
        courseId: number | null;
        practiceTopicId: number | null;
    }>;
    updateQuiz(id: number, dto: Partial<CreateQuizDto>): Promise<{
        createdAt: Date;
        id: number;
        title: string;
        description: string | null;
        theoryContent: string | null;
        bilingualContent: import("@prisma/client/runtime/library").JsonValue | null;
        type: import(".prisma/client").$Enums.QuizType;
        timeLimit: number | null;
        courseId: number | null;
        practiceTopicId: number | null;
    }>;
    deleteQuiz(id: number): Promise<{
        createdAt: Date;
        id: number;
        title: string;
        description: string | null;
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
        title: string;
        description: string | null;
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
        title: string;
        description: string | null;
        theoryContent: string | null;
        bilingualContent: import("@prisma/client/runtime/library").JsonValue | null;
        type: import(".prisma/client").$Enums.QuizType;
        timeLimit: number | null;
        courseId: number | null;
        practiceTopicId: number | null;
    }[]>;
    getQuizById(id: number, req: any): Promise<{
        questions: {
            content: any;
            order: number;
            id: number;
            type: string;
            quizId: number;
        }[];
        createdAt: Date;
        id: number;
        title: string;
        description: string | null;
        theoryContent: string | null;
        bilingualContent: import("@prisma/client/runtime/library").JsonValue | null;
        type: import(".prisma/client").$Enums.QuizType;
        timeLimit: number | null;
        courseId: number | null;
        practiceTopicId: number | null;
    }>;
    createQuestion(quizId: number, dto: CreateQuestionDto): Promise<{
        order: number;
        id: number;
        type: string;
        content: import("@prisma/client/runtime/library").JsonValue;
        quizId: number;
    }>;
    updateQuestion(questionId: number, dto: Partial<CreateQuestionDto>): Promise<{
        order: number;
        id: number;
        type: string;
        content: import("@prisma/client/runtime/library").JsonValue;
        quizId: number;
    }>;
    deleteQuestion(questionId: number): Promise<{
        order: number;
        id: number;
        type: string;
        content: import("@prisma/client/runtime/library").JsonValue;
        quizId: number;
    }>;
    submitQuiz(quizId: number, dto: SubmitQuizDto, req: any): Promise<{
        isFirstSubmission: boolean;
        results: {
            id: number;
            score: number | null;
            questionId: number;
            answer: import("@prisma/client/runtime/library").JsonValue;
            isCorrect: boolean | null;
            submissionId: number;
        }[];
        id: number;
        quizId: number;
        score: number | null;
        submittedAt: Date;
        aiFeedback: string | null;
        userId: number;
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
            order: number;
            id: number;
            type: string;
            content: import("@prisma/client/runtime/library").JsonValue;
            quizId: number;
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
