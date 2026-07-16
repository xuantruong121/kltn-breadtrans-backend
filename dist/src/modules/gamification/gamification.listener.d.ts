import { PrismaService } from '../../prisma/prisma.service';
export declare class GamificationListener {
    private readonly prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    handleQuizSubmittedEvent(payload: {
        userId: number;
        score: number;
    }): Promise<void>;
}
