import { UserService } from './user.service';
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
        } | null;
        createdAt: Date;
        id: number;
        email: string;
        role: import(".prisma/client").$Enums.Role;
        updatedAt: Date;
    }>;
}
