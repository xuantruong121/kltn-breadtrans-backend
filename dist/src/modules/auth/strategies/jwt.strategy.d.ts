import { Strategy } from 'passport-jwt';
import { PrismaService } from '../../../prisma/prisma.service';
declare const JwtStrategy_base: new (...args: [opt: import("passport-jwt").StrategyOptionsWithRequest] | [opt: import("passport-jwt").StrategyOptionsWithoutRequest]) => Strategy & {
    validate(...args: any[]): unknown;
};
export declare class JwtStrategy extends JwtStrategy_base {
    private readonly prisma;
    constructor(prisma: PrismaService);
    validate(payload: any): Promise<{
        createdAt: Date;
        id: number;
        email: string;
        password: string;
        role: import(".prisma/client").$Enums.Role;
        refreshToken: string | null;
        updatedAt: Date;
    }>;
}
export {};
