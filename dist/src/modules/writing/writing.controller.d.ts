import { WritingService } from './writing.service';
export declare class WritingController {
    private readonly writingService;
    constructor(writingService: WritingService);
    getTopics(req: any): Promise<{
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
    submitWritingPart2(req: any, emailPrompt: string, userResponse: string): Promise<{
        score: number;
        maxScore: number;
        feedback: string;
        suggestions: string[];
    }>;
    submitWritingPart3(req: any, essayTopic: string, userEssay: string): Promise<{
        score: number;
        maxScore: number;
        feedback: string;
        suggestions: string[];
    }>;
}
