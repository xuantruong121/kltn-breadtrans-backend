import { GamificationService } from './gamification.service';
export declare class GamificationController {
    private readonly gamificationService;
    constructor(gamificationService: GamificationService);
    getLeaderboard(): Promise<({
        user: {
            id: number;
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
        };
    } & {
        id: number;
        userId: number;
        totalPoints: number;
        rank: number | null;
    })[]>;
    getMyBadges(req: any): Promise<({
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
