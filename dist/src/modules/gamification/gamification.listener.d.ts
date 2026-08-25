import { PrismaService } from '../../prisma/prisma.service';
import { GamificationService } from './gamification.service';
export declare class GamificationListener {
    private readonly prisma;
    private readonly gamificationService;
    private readonly logger;
    constructor(prisma: PrismaService, gamificationService: GamificationService);
    handleQuizSubmittedEvent(payload: {
        userId: number;
        quizId?: number;
        score: number;
    }): Promise<void>;
    handleSpeakingSubmittedEvent(payload: {
        userId: number;
        exerciseId?: number;
        overallScore: number;
        isSilentOrNoSpeech?: boolean;
    }): Promise<void>;
    handleVocabLearnedEvent(payload: {
        userId: number;
        count: number;
    }): Promise<void>;
    handleXpEarnedEvent(payload: {
        userId: number;
        points: number;
    }): Promise<void>;
}
