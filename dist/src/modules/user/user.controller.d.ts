import { UserService } from './user.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
export declare class UserController {
    private readonly userService;
    constructor(userService: UserService);
    getProfile(req: any): Promise<{
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
        createdAt: Date;
        id: number;
        updatedAt: Date;
        email: string;
        role: import(".prisma/client").$Enums.Role;
        refreshToken: string | null;
        sessionToken: string | null;
        loginCount: number;
        lastLoginAt: Date | null;
        lastDeviceType: string | null;
    }>;
    updateProfile(req: any, updateData: UpdateProfileDto): Promise<{
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
}
