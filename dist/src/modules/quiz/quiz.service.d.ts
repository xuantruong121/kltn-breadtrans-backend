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
    submitQuiz(quizId: number, userId: number, dto: SubmitQuizDto): Promise<{
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
