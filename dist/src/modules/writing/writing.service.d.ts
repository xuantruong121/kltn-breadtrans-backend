import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
export declare class WritingService {
    private prisma;
    private aiService;
    constructor(prisma: PrismaService, aiService: AiService);
    getTopics(): Promise<{
        categories: ({
            _count: {
                quizzes: number;
            };
        } & {
            name: string;
            vietnameseName: string | null;
            category: import(".prisma/client").$Enums.TopicCategory;
            iconUrl: string | null;
            order: number;
            createdAt: Date;
            id: number;
        })[];
        quizzes: {
            id: number;
            topicId: number | null;
            topicName: string | undefined;
            imageUrl: any;
            keywords: any;
        }[];
    }>;
    getQuizDetails(quizId: number): Promise<{
        quizId: number;
        imageUrl: any;
        keywords: any;
        sampleSentences: any;
    }>;
    getCommunitySubmissions(quizId: number): Promise<{
        id: number;
        user: string;
        score: number | null;
        answer: import("@prisma/client/runtime/library").JsonValue;
        feedback: string | null;
        submittedAt: Date;
    }[]>;
    submitWriting(quizId: number, userId: number, text: string): Promise<{
        submissionId: number;
        score: number;
        feedback: string;
    }>;
}
