import { ReadingService } from './reading.service';
import { TopicCategory } from '@prisma/client';
export declare class ReadingController {
    private readonly readingService;
    constructor(readingService: ReadingService);
    getTopicsByCategory(category: TopicCategory, req: any): Promise<{
        id: number;
        name: string;
        vietnameseName: string | null;
        iconUrl: string | null;
        totalQuestions: number;
        completedQuestions: number;
        correctAnswers: number;
        incorrectAnswers: number;
        completedArticles: number;
        totalArticles: number;
    }[]>;
    getTopicDetails(id: number): Promise<{
        quizzes: {
            id: number;
            title: string;
            description: string | null;
            bilingualContent: import("@prisma/client/runtime/library").JsonValue;
            type: import(".prisma/client").$Enums.QuizType;
            timeLimit: number | null;
            _count: {
                questions: number;
            };
        }[];
    } & {
        name: string;
        vietnameseName: string | null;
        category: import(".prisma/client").$Enums.TopicCategory;
        iconUrl: string | null;
        order: number;
        createdAt: Date;
        id: number;
    }>;
    getQuizTheory(id: number): Promise<{
        id: number;
        title: string;
        theoryContent: string | null;
    }>;
    getBilingualProgress(req: any): Promise<{
        completedArticles: number;
        sentencesRead: number;
        questionsAnswered: number;
        accuracy: number;
        completedArticlesList: {
            title: string;
            sentencesCount: number;
            questionsCount: number;
        }[];
    }>;
}
