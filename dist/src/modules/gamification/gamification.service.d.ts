import { PrismaService } from '../../prisma/prisma.service';
export declare class GamificationService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    getLeaderboard(): Promise<({
        user: {
            id: number;
            email: string;
            profile: {
                id: number;
                userId: number;
                fullName: string;
                avatar: string | null;
                phone: string | null;
                address: string | null;
                targetScore: string | null;
            } | null;
        };
    } & {
        id: number;
        userId: number;
        rank: number | null;
        totalPoints: number;
    })[]>;
    getMyBadges(userId: number): Promise<({
        badge: {
            name: string;
            iconUrl: string | null;
            id: number;
            description: string;
            criteria: import("@prisma/client/runtime/library").JsonValue;
        };
    } & {
        id: number;
        userId: number;
        badgeId: number;
        awardedAt: Date;
    })[]>;
}
