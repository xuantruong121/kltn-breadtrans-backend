import { AuthService } from './auth.service';
import { LoginDto, RegisterDto, RefreshTokenDto, GenerateOtpDto, VerifyOtpDto, VerifyRegistrationDto, ChangePasswordDto, ActivateTeacherDto } from './dto/auth.dto';
export declare class AuthController {
    private readonly authService;
    constructor(authService: AuthService);
    register(registerDto: RegisterDto): Promise<{
        message: string;
    }>;
    verifyRegistration(body: VerifyRegistrationDto): Promise<{
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
    login(loginDto: LoginDto): Promise<{
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
    refreshTokens(req: any, body: RefreshTokenDto): Promise<{
        access_token: string;
        refresh_token: string;
    }>;
    logout(req: any): Promise<{
        message: string;
    }>;
    changePassword(req: any, body: ChangePasswordDto): Promise<{
        message: string;
    }>;
    activateTeacher(body: ActivateTeacherDto): Promise<{
        id: number;
        email: string;
        role: import(".prisma/client").$Enums.Role;
        emailVerifiedAt: Date | null;
    }>;
    generateOtp(body: GenerateOtpDto): Promise<{
        message: string;
    }>;
    verifyOtp(body: VerifyOtpDto): Promise<{
        message: string;
    }>;
    getProfile(req: any): any;
}
