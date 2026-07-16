import { PrismaService } from '../../prisma/prisma.service';
export declare class GamificationService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    getLeaderboard(): Promise<({
        user: {
            email: string;
            profile: {
                id: number;
                fullName: string;
                avatar: string | null;
                phone: string | null;
                address: string | null;
                targetScore: string | null;
                userId: number;
            } | null;
            id: number;
        };
    } & {
        id: number;
        userId: number;
        totalPoints: number;
        rank: number | null;
    })[]>;
    getMyBadges(userId: number): Promise<({
        badge: {
            id: number;
            name: string;
            description: string;
            iconUrl: string | null;
            criteria: import("@prisma/client/runtime/library").JsonValue;
        };
    } & {
        id: number;
        userId: number;
        badgeId: number;
        awardedAt: Date;
    })[]>;
}
