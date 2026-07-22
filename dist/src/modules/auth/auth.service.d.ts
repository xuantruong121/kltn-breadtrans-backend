import { PrismaService } from '../../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { LoginDto, RegisterDto } from './dto/auth.dto';
export declare class AuthService {
    private readonly prisma;
    private readonly jwtService;
    constructor(prisma: PrismaService, jwtService: JwtService);
    register(registerDto: RegisterDto): Promise<{
        profile: {
            id: number;
            userId: number;
            fullName: string;
            avatar: string | null;
            phone: string | null;
            address: string | null;
            targetScore: string | null;
        } | null;
        createdAt: Date;
        id: number;
        updatedAt: Date;
        email: string;
        role: import(".prisma/client").$Enums.Role;
        refreshToken: string | null;
        totalBanhRan: number;
        streakCount: number;
        lastStreakUpdate: Date | null;
        parentName: string | null;
        parentPhone: string | null;
        birthYear: number | null;
        nextExamDate: string | null;
        isSelfClaimed: boolean;
        tuitionFee: import("@prisma/client/runtime/library").JsonValue | null;
        bankQrUrl: string | null;
        bankName: string | null;
        bankBin: string | null;
        bankAccountNumber: string | null;
        bankAccountName: string | null;
        bankAccount: string | null;
        sessionToken: string | null;
        loginCount: number;
        lastLoginAt: Date | null;
        lastDeviceType: string | null;
        admirationsMessage: import("@prisma/client/runtime/library").JsonValue | null;
        admirationsSentToday: import("@prisma/client/runtime/library").JsonValue | null;
        admirationsSentStoryToday: import("@prisma/client/runtime/library").JsonValue | null;
        timesVocabXS: number;
        timesVocab: number;
        quizAccuracy: number;
        speakingAccuracy: number;
        countHeart: number;
        movies: import("@prisma/client/runtime/library").JsonValue | null;
        gameTickets: import("@prisma/client/runtime/library").JsonValue | null;
        speaking: import("@prisma/client/runtime/library").JsonValue | null;
        writing: import("@prisma/client/runtime/library").JsonValue | null;
    }>;
    login(loginDto: LoginDto): Promise<{
        access_token: string;
        refresh_token: string;
        user: {
            id: number;
            email: string;
            role: import(".prisma/client").$Enums.Role;
        };
    }>;
    refreshTokens(userId: number, refreshToken: string): Promise<{
        access_token: string;
        refresh_token: string;
    }>;
    logout(userId: number): Promise<{
        message: string;
    }>;
}
