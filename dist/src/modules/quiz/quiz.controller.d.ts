import { QuizService } from './quiz.service';
import { CreateQuizDto, CreateQuestionDto, SubmitQuizDto } from './dto/quiz.dto';
export declare class QuizController {
    private readonly quizService;
    constructor(quizService: QuizService);
    createQuiz(dto: CreateQuizDto): Promise<{
        createdAt: Date;
        id: number;
        description: string | null;
        type: import(".prisma/client").$Enums.QuizType;
        title: string;
        courseId: number | null;
        timeLimit: number | null;
    }>;
    getQuizById(id: number): Promise<{
        questions: {
            id: number;
            type: string;
            order: number;
            content: import("@prisma/client/runtime/library").JsonValue;
            quizId: number;
        }[];
    } & {
        createdAt: Date;
        id: number;
        description: string | null;
        type: import(".prisma/client").$Enums.QuizType;
        title: string;
        courseId: number | null;
        timeLimit: number | null;
    }>;
    createQuestion(quizId: number, dto: CreateQuestionDto): Promise<{
        id: number;
        type: string;
        order: number;
        content: import("@prisma/client/runtime/library").JsonValue;
        quizId: number;
    }>;
    submitQuiz(quizId: number, dto: SubmitQuizDto, req: any): Promise<{
        results: {
            id: number;
            questionId: number;
            answer: import("@prisma/client/runtime/library").JsonValue;
            isCorrect: boolean | null;
            score: number | null;
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
}
