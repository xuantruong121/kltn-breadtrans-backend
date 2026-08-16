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
                userId: number;
                fullName: string;
                avatar: string | null;
                phone: string | null;
                address: string | null;
                targetScore: string | null;
                parentName: string | null;
                parentPhone: string | null;
                birthYear: number | null;
                nextExamDate: string | null;
                isSelfClaimed: boolean;
            } | null;
        };
    } & {
        id: number;
        userId: number;
        rank: number | null;
        totalPoints: number;
        tier: string;
        weeklyExp: number;
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
    getMyPet(req: any): Promise<{
        name: string;
        createdAt: Date;
        id: number;
        updatedAt: Date;
        userId: number;
        level: number;
        health: number;
        happiness: number;
        exp: number;
        lastFedAt: Date | null;
    }>;
    feedPet(req: any): Promise<{
        name: string;
        createdAt: Date;
        id: number;
        updatedAt: Date;
        userId: number;
        level: number;
        health: number;
        happiness: number;
        exp: number;
        lastFedAt: Date | null;
    }>;
    getMyDailyQuests(req: any): Promise<({
        quest: {
            id: number;
            title: string;
            description: string | null;
            type: string;
            targetValue: number;
            rewardXP: number;
            rewardBanh: number;
            isActive: boolean;
        };
    } & {
        id: number;
        userId: number;
        questId: number;
        currentValue: number;
        isCompleted: boolean;
        completedAt: Date | null;
        dateKey: string;
    })[]>;
    getArenaSnippet(req: any): Promise<{
        rank: null;
        tier: string;
        message: string;
    } | {
        rank: number;
        tier: string;
        message: string;
    }>;
    spinWheel(req: any): Promise<{
        success: boolean;
        reward: string;
        rewardType: string;
    }>;
    triggerDailyCron(): Promise<{
        success: boolean;
        message: string;
    }>;
    triggerWeeklyCron(): Promise<{
        success: boolean;
        message: string;
    }>;
}
