import { UserService } from './user.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
export declare class UserController {
    private readonly userService;
    constructor(userService: UserService);
    getProfile(req: any): Promise<{
        profile: {
            fullName: string;
            id: number;
            avatar: string | null;
            phone: string | null;
            address: string | null;
            targetScore: string | null;
            parentName: string | null;
            parentPhone: string | null;
            birthYear: number | null;
            nextExamDate: string | null;
            isSelfClaimed: boolean;
            userId: number;
        } | null;
        email: string;
        refreshToken: string | null;
        role: import(".prisma/client").$Enums.Role;
        sessionToken: string | null;
        loginCount: number;
        lastLoginAt: Date | null;
        lastDeviceType: string | null;
        createdAt: Date;
        updatedAt: Date;
        id: number;
    }>;
    updateProfile(req: any, updateData: UpdateProfileDto): Promise<{
        fullName: string;
        id: number;
        avatar: string | null;
        phone: string | null;
        address: string | null;
        targetScore: string | null;
        parentName: string | null;
        parentPhone: string | null;
        birthYear: number | null;
        nextExamDate: string | null;
        isSelfClaimed: boolean;
        userId: number;
    }>;
}
