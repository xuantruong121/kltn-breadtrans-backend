import { QuizService } from './quiz.service';
import { CreateQuizDto, CreateQuestionDto, SubmitQuizDto } from './dto/quiz.dto';
export declare class QuizController {
    private readonly quizService;
    constructor(quizService: QuizService);
    createQuiz(dto: CreateQuizDto, req: any): Promise<{
        type: import(".prisma/client").$Enums.QuizType;
        description: string | null;
        title: string;
        createdAt: Date;
        id: number;
        courseId: number | null;
        practiceTopicId: number | null;
        theoryContent: string | null;
        bilingualContent: import("@prisma/client/runtime/library").JsonValue | null;
        timeLimit: number | null;
    }>;
    updateQuiz(id: number, dto: Partial<CreateQuizDto>, req: any): Promise<{
        type: import(".prisma/client").$Enums.QuizType;
        description: string | null;
        title: string;
        createdAt: Date;
        id: number;
        courseId: number | null;
        practiceTopicId: number | null;
        theoryContent: string | null;
        bilingualContent: import("@prisma/client/runtime/library").JsonValue | null;
        timeLimit: number | null;
    }>;
    deleteQuiz(id: number, req: any): Promise<{
        type: import(".prisma/client").$Enums.QuizType;
        description: string | null;
        title: string;
        createdAt: Date;
        id: number;
        courseId: number | null;
        practiceTopicId: number | null;
        theoryContent: string | null;
        bilingualContent: import("@prisma/client/runtime/library").JsonValue | null;
        timeLimit: number | null;
    }>;
    getAllQuizzes(): Promise<({
        _count: {
            questions: number;
        };
    } & {
        type: import(".prisma/client").$Enums.QuizType;
        description: string | null;
        title: string;
        createdAt: Date;
        id: number;
        courseId: number | null;
        practiceTopicId: number | null;
        theoryContent: string | null;
        bilingualContent: import("@prisma/client/runtime/library").JsonValue | null;
        timeLimit: number | null;
    })[]>;
    getListeningPractices(req: any): Promise<{
        isCompleted: boolean;
        _count: {
            questions: number;
        };
        type: import(".prisma/client").$Enums.QuizType;
        description: string | null;
        title: string;
        createdAt: Date;
        id: number;
        courseId: number | null;
        practiceTopicId: number | null;
        theoryContent: string | null;
        bilingualContent: import("@prisma/client/runtime/library").JsonValue | null;
        timeLimit: number | null;
    }[]>;
    getQuizById(id: number, req: any): Promise<{
        questions: {
            content: any;
            type: string;
            order: number;
            id: number;
            quizId: number;
        }[];
        type: import(".prisma/client").$Enums.QuizType;
        description: string | null;
        title: string;
        createdAt: Date;
        id: number;
        courseId: number | null;
        practiceTopicId: number | null;
        theoryContent: string | null;
        bilingualContent: import("@prisma/client/runtime/library").JsonValue | null;
        timeLimit: number | null;
    }>;
    createQuestion(quizId: number, dto: CreateQuestionDto): Promise<{
        type: string;
        order: number;
        id: number;
        quizId: number;
        content: import("@prisma/client/runtime/library").JsonValue;
    }>;
    updateQuestion(questionId: number, dto: Partial<CreateQuestionDto>): Promise<{
        type: string;
        order: number;
        id: number;
        quizId: number;
        content: import("@prisma/client/runtime/library").JsonValue;
    }>;
    deleteQuestion(questionId: number): Promise<{
        type: string;
        order: number;
        id: number;
        quizId: number;
        content: import("@prisma/client/runtime/library").JsonValue;
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
            type: string;
            order: number;
            id: number;
            quizId: number;
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
