import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
export declare class WritingService {
    private prisma;
    private aiService;
    constructor(prisma: PrismaService, aiService: AiService);
    getTopics(userId: number): Promise<{
        categories: ({
            _count: {
                quizzes: number;
            };
        } & {
            id: number;
            name: string;
            vietnameseName: string | null;
            category: import(".prisma/client").$Enums.TopicCategory;
            iconUrl: string | null;
            order: number;
            createdAt: Date;
        })[];
        quizzes: {
            id: number;
            topicId: number | null;
            topicName: string | undefined;
            imageUrl: any;
            keywords: any;
            isCompleted: boolean;
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
    submitWritingPart2(emailPrompt: string, userId: number, userResponse: string): Promise<{
        score: number;
        maxScore: number;
        feedback: string;
        suggestions: string[];
    }>;
    submitWritingPart3(essayTopic: string, userId: number, userEssay: string): Promise<{
        score: number;
        maxScore: number;
        feedback: string;
        suggestions: string[];
    }>;
}
