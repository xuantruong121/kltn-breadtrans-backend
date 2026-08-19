import { PrismaService } from '../../prisma/prisma.service';
export declare class UserService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    getUserProfile(userId: number): Promise<{
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
        stats: {
            id: number;
            userId: number;
            totalBanhRan: number;
            streakCount: number;
            lastStreakUpdate: Date | null;
            streakFreezes: number;
            countHeart: number;
            timesVocabXS: number;
            timesVocab: number;
            quizAccuracy: number;
            speakingAccuracy: number;
            movies: import("@prisma/client/runtime/library").JsonValue | null;
            gameTickets: import("@prisma/client/runtime/library").JsonValue | null;
            admirationsMessage: import("@prisma/client/runtime/library").JsonValue | null;
            admirationsSentToday: import("@prisma/client/runtime/library").JsonValue | null;
            admirationsSentStoryToday: import("@prisma/client/runtime/library").JsonValue | null;
            speaking: import("@prisma/client/runtime/library").JsonValue | null;
            writing: import("@prisma/client/runtime/library").JsonValue | null;
        } | null;
        billing: {
            id: number;
            userId: number;
            tuitionFee: import("@prisma/client/runtime/library").JsonValue | null;
            bankQrUrl: string | null;
            bankName: string | null;
            bankBin: string | null;
            bankAccountNumber: string | null;
            bankAccountName: string | null;
            bankAccount: string | null;
        } | null;
        leaderboard: {
            id: number;
            userId: number;
            totalPoints: number;
            rank: number | null;
            tier: string;
            weeklyExp: number;
        } | null;
        pet: {
            id: number;
            createdAt: Date;
            updatedAt: Date;
            name: string;
            userId: number;
            health: number;
            happiness: number;
            level: number;
            exp: number;
            lastFedAt: Date | null;
        } | null;
        id: number;
        email: string;
        role: import(".prisma/client").$Enums.Role;
        sessionToken: string | null;
        loginCount: number;
        lastLoginAt: Date | null;
        lastDeviceType: string | null;
        createdAt: Date;
        updatedAt: Date;
    }>;
    updateUserProfile(userId: number, updateData: any): Promise<{
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
    }>;
    getUserStats(userId: number): Promise<{
        streakCount: number;
        streakFreezes: number;
        totalBanhRan: number;
        quizAccuracy: number;
        speakingAccuracy: number;
        totalPoints: number;
        weeklyExp: number;
        tier: string;
        masteredVocabCount: number;
        totalQuizzesDone: number;
        pet: {
            id: number;
            createdAt: Date;
            updatedAt: Date;
            name: string;
            userId: number;
            health: number;
            happiness: number;
            level: number;
            exp: number;
            lastFedAt: Date | null;
        } | null;
    }>;
}
