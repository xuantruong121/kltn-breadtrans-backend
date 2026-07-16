import { GamificationService } from './gamification.service';
export declare class GamificationController {
    private readonly gamificationService;
    constructor(gamificationService: GamificationService);
    getLeaderboard(): Promise<({
        user: {
            profile: {
                fullName: string;
                id: number;
                avatar: string | null;
                phone: string | null;
                address: string | null;
                targetScore: string | null;
                userId: number;
            } | null;
            email: string;
            id: number;
        };
    } & {
        id: number;
        userId: number;
        totalPoints: number;
        rank: number | null;
    })[]>;
    getMyBadges(req: any): Promise<({
        badge: {
            description: string;
            id: number;
            name: string;
            iconUrl: string | null;
            criteria: import("@prisma/client/runtime/client").JsonValue;
        };
    } & {
        id: number;
        userId: number;
        badgeId: number;
        awardedAt: Date;
    })[]>;
}
