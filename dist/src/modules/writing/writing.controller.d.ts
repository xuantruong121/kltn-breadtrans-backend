import { WritingService } from './writing.service';
export declare class WritingController {
    private readonly writingService;
    constructor(writingService: WritingService);
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
    getQuizDetails(id: number): Promise<{
        quizId: number;
        imageUrl: any;
        keywords: any;
        sampleSentences: any;
    }>;
    getCommunitySubmissions(id: number): Promise<{
        id: number;
        user: string;
        score: number | null;
        answer: import("@prisma/client/runtime/library").JsonValue;
        feedback: string | null;
        submittedAt: Date;
    }[]>;
    submitWriting(id: number, req: any, answer: string): Promise<{
        submissionId: number;
        score: number;
        feedback: string;
    }>;
}
