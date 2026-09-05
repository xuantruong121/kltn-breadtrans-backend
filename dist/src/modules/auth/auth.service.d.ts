import { PrismaService } from '../../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import Redis from 'ioredis';
export declare class AuthService {
    private readonly prisma;
    private readonly jwtService;
    private readonly redis;
    constructor(prisma: PrismaService, jwtService: JwtService, redis: Redis);
    register(registerDto: RegisterDto): Promise<{
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
        refreshToken: string | null;
        sessionToken: string | null;
        loginCount: number;
        lastLoginAt: Date | null;
        lastDeviceType: string | null;
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
}
