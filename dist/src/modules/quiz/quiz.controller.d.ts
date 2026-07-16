import { QuizService } from './quiz.service';
import { CreateQuizDto, CreateQuestionDto, SubmitQuizDto } from './dto/quiz.dto';
export declare class QuizController {
    private readonly quizService;
    constructor(quizService: QuizService);
    createQuiz(dto: CreateQuizDto): Promise<{
        type: import("@prisma/client").$Enums.QuizType;
        description: string | null;
        title: string;
        id: number;
        createdAt: Date;
        courseId: number | null;
        timeLimit: number | null;
    }>;
    getQuizById(id: number): Promise<{
        questions: {
            type: string;
            id: number;
            content: import("@prisma/client/runtime/client").JsonValue;
            order: number;
            quizId: number;
        }[];
    } & {
        type: import("@prisma/client").$Enums.QuizType;
        description: string | null;
        title: string;
        id: number;
        createdAt: Date;
        courseId: number | null;
        timeLimit: number | null;
    }>;
    createQuestion(quizId: number, dto: CreateQuestionDto): Promise<{
        type: string;
        id: number;
        content: import("@prisma/client/runtime/client").JsonValue;
        order: number;
        quizId: number;
    }>;
    submitQuiz(quizId: number, dto: SubmitQuizDto, req: any): Promise<{
        results: {
            id: number;
            questionId: number;
            answer: import("@prisma/client/runtime/client").JsonValue;
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
