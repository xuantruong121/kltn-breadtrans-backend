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
    getListeningPractices(): Promise<({
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
    getQuizById(id: number): Promise<{
        questions: {
            order: number;
            id: number;
            type: string;
            content: import("@prisma/client/runtime/library").JsonValue;
            quizId: number;
        }[];
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
    }>;
    createQuestion(quizId: number, dto: CreateQuestionDto): Promise<{
        order: number;
        id: number;
        type: string;
        content: import("@prisma/client/runtime/library").JsonValue;
        quizId: number;
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
        score: number | null;
        submittedAt: Date;
        aiFeedback: string | null;
        userId: number;
    }>;
}
