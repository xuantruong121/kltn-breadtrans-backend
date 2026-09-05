import { PrismaService } from '../../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationsService } from '../notifications/notifications.service';
import Redis from 'ioredis';
export declare class GamificationService {
    private readonly prisma;
    private readonly eventEmitter;
    private readonly redis;
    private readonly notificationsService?;
    private readonly logger;
    constructor(prisma: PrismaService, eventEmitter: EventEmitter2, redis: Redis, notificationsService?: NotificationsService | undefined);
    addPoints(userId: number, points: number, reason: string): Promise<{
        id: number;
        userId: number;
        rank: number | null;
        totalPoints: number;
        tier: string;
        weeklyExp: number;
    }>;
    recordStreakActivity(userId: number): Promise<void>;
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
        rank: number | null;
        totalPoints: number;
        tier: string;
        weeklyExp: number;
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
    private normalizeSpeciesKey;
    getMyPet(userId: number): Promise<{
        name: string;
        createdAt: Date;
        id: number;
        updatedAt: Date;
        userId: number;
        level: number;
        health: number;
        happiness: number;
        exp: number;
        roster: import("@prisma/client/runtime/library").JsonValue | null;
        lastFedAt: Date | null;
    }>;
    feedPet(userId: number): Promise<{
        name: string;
        createdAt: Date;
        id: number;
        updatedAt: Date;
        userId: number;
        level: number;
        health: number;
        happiness: number;
        exp: number;
        roster: import("@prisma/client/runtime/library").JsonValue | null;
        lastFedAt: Date | null;
    }>;
    changePetType(userId: number, targetPetName: string): Promise<{
        name: string;
        createdAt: Date;
        id: number;
        updatedAt: Date;
        userId: number;
        level: number;
        health: number;
        happiness: number;
        exp: number;
        roster: import("@prisma/client/runtime/library").JsonValue | null;
        lastFedAt: Date | null;
    }>;
    getMyDailyQuests(userId: number): Promise<({
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
        completedAt: Date | null;
        questId: number;
        currentValue: number;
        isCompleted: boolean;
        dateKey: string;
    })[]>;
    recordVocabLearned(userId: number, count?: number): Promise<{
        success: boolean;
        count: number;
    }>;
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
    triggerWeeklyCron(isManualTrigger?: boolean): Promise<{
        success: boolean;
        noop: boolean;
        message: string;
    }>;
    handleDailyCronSchedule(): Promise<void>;
    handleWeeklyCronSchedule(): Promise<void>;
    sendAdmiration(senderId: number, targetUserId: number, message?: string): Promise<{
        success: boolean;
        message: string;
    }>;
}
