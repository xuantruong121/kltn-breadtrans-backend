import { PrismaService } from '../../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import Redis from 'ioredis';
import { EmailService } from '../../common/email/email.service';
export declare class AuthService {
    private readonly prisma;
    private readonly jwtService;
    private readonly redis;
    private readonly emailService;
    constructor(prisma: PrismaService, jwtService: JwtService, redis: Redis, emailService: EmailService);
    register(registerDto: RegisterDto): Promise<{
        message: string;
    }>;
    login(loginDto: LoginDto, deviceId: string): Promise<{
        access_token: string;
        refresh_token: string;
        deviceId: string;
        user: {
            id: number;
            email: string;
            role: import(".prisma/client").$Enums.Role;
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
    }>;
    refreshTokens(userId: number, deviceId: string, providedRefreshToken: string): Promise<{
        access_token: string;
        refresh_token: string;
    }>;
    logout(userId: number, deviceId: string, accessToken: string): Promise<{
        message: string;
    }>;
    generateOtp(email: string): Promise<{
        message: string;
    }>;
    verifyOtp(email: string, providedOtp: string): Promise<{
        message: string;
    }>;
    verifyRegistration(email: string, providedOtp: string): Promise<{
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
        createdAt: Date;
        id: number;
        updatedAt: Date;
        email: string;
        role: import(".prisma/client").$Enums.Role;
        emailVerifiedAt: Date | null;
        mustChangePassword: boolean;
        refreshToken: string | null;
        sessionToken: string | null;
        loginCount: number;
        lastLoginAt: Date | null;
        lastDeviceType: string | null;
    }>;
    changePassword(userId: number, currentPassword: string, newPassword: string): Promise<{
        message: string;
    }>;
    activateTeacher(token: string, newPassword: string): Promise<{
        id: number;
        email: string;
        role: import(".prisma/client").$Enums.Role;
        emailVerifiedAt: Date | null;
    }>;
}
