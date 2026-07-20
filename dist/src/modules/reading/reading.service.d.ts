import { PrismaService } from '../../prisma/prisma.service';
import { TopicCategory } from '@prisma/client';
export declare class ReadingService {
    private prisma;
    constructor(prisma: PrismaService);
    getTopicsByCategory(category: TopicCategory, userId: number): Promise<{
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
    getTopicDetails(topicId: number): Promise<{
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
    getQuizTheory(quizId: number): Promise<{
        id: number;
        title: string;
        theoryContent: string | null;
    }>;
    getBilingualProgress(userId: number): Promise<{
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
