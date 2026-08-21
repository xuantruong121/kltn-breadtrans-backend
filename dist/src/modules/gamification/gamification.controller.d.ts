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
        totalPoints: number;
        rank: number | null;
        tier: string;
        weeklyExp: number;
    })[]>;
    getMyBadges(req: any): Promise<({
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
    getMyPet(req: any): Promise<{
        id: number;
        userId: number;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        health: number;
        happiness: number;
        level: number;
        exp: number;
        lastFedAt: Date | null;
    }>;
    feedPet(req: any): Promise<{
        id: number;
        userId: number;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        health: number;
        happiness: number;
        level: number;
        exp: number;
        lastFedAt: Date | null;
    }>;
    getMyDailyQuests(req: any): Promise<({
        quest: {
            id: number;
            description: string | null;
            title: string;
            targetValue: number;
            type: string;
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
    sendAdmiration(req: any, body: {
        targetUserId: number;
        message?: string;
    }): Promise<{
        success: boolean;
        message: string;
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
