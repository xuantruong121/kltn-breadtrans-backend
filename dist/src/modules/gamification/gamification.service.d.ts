import { PrismaService } from '../../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
export declare class GamificationService {
    private readonly prisma;
    private readonly eventEmitter;
    constructor(prisma: PrismaService, eventEmitter: EventEmitter2);
    addPoints(userId: number, points: number, reason: string): Promise<{
        id: number;
        userId: number;
        totalPoints: number;
        rank: number | null;
        tier: string;
        weeklyExp: number;
    }>;
    getLeaderboard(tier?: string): Promise<({
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
    getMyPet(userId: number): Promise<{
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
    feedPet(userId: number): Promise<{
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
    getMyDailyQuests(userId: number): Promise<({
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
    getArenaSnippet(userId: number): Promise<{
        rank: null;
        tier: string;
        message: string;
    } | {
        rank: number;
        tier: string;
        message: string;
    }>;
    spinWheel(userId: number): Promise<{
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
