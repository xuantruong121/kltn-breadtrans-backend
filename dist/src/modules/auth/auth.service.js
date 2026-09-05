"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const jwt_1 = require("@nestjs/jwt");
const bcrypt = __importStar(require("bcrypt"));
const ioredis_1 = require("@nestjs-modules/ioredis");
const ioredis_2 = __importDefault(require("ioredis"));
const crypto = __importStar(require("crypto"));
const auth_constants_1 = require("./auth.constants");
const client_1 = require("@prisma/client");
const email_service_1 = require("../../common/email/email.service");
let AuthService = class AuthService {
    prisma;
    jwtService;
    redis;
    emailService;
    constructor(prisma, jwtService, redis, emailService) {
        this.prisma = prisma;
        this.jwtService = jwtService;
        this.redis = redis;
        this.emailService = emailService;
    }
    async register(registerDto) {
        const { email, password, fullName } = registerDto;
        const existingUser = await this.prisma.user.findUnique({
            where: { email },
        });
        if (existingUser)
            throw new common_1.ConflictException('Email already exists');
        const hashedPassword = await bcrypt.hash(password, 12);
        await this.redis.set(`register:pending:${email}`, JSON.stringify({ email, fullName, password: hashedPassword }), 'EX', 600);
        const otp = crypto.randomInt(100000, 1000000).toString();
        const otpHash = crypto
            .createHmac('sha256', (0, auth_constants_1.getOtpSecret)())
            .update(otp)
            .digest('hex');
        await this.redis.set(`register:otp:${email}`, otpHash, 'EX', 300);
        await this.redis.del(`register:otp:attempts:${email}`);
        await this.emailService.sendRegistrationOtp(email, otp);
        return {
            message: 'Registration started. Verify the OTP sent to your email.',
        };
    }
    async login(loginDto, deviceId) {
        const { email, password } = loginDto;
        const user = await this.prisma.user.findUnique({
            where: { email },
            include: { profile: true },
        });
        if (!user)
            throw new common_1.UnauthorizedException('Invalid credentials');
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid)
            throw new common_1.UnauthorizedException('Invalid credentials');
        await this.prisma.user.update({
            where: { id: user.id },
            data: {
                lastLoginAt: new Date(),
                loginCount: { increment: 1 },
            },
        });
        const access_token = this.jwtService.sign({
            sub: user.id,
            email: user.email,
            role: user.role,
            deviceId,
            type: 'access',
            jti: crypto.randomUUID(),
        }, { expiresIn: '1d' });
        const refreshToken = this.jwtService.sign({ sub: user.id, deviceId, type: 'refresh' }, { expiresIn: '30d' });
        const redisKey = `user:${user.id}:device:${deviceId}`;
        await this.redis.set(redisKey, refreshToken, 'EX', 30 * 24 * 60 * 60);
        return {
            access_token,
            refresh_token: refreshToken,
            deviceId,
            user: {
                id: user.id,
                email: user.email,
                role: user.role,
                profile: user.profile,
            },
        };
    }
    async refreshTokens(userId, deviceId, providedRefreshToken) {
        let tokenPayload = null;
        try {
            tokenPayload = this.jwtService.verify(providedRefreshToken);
        }
        catch {
            throw new common_1.UnauthorizedException('Refresh token không hợp lệ hoặc đã hết hạn');
        }
        if (tokenPayload?.type !== 'refresh') {
            throw new common_1.UnauthorizedException('Token type must be refresh');
        }
        const effectiveUserId = tokenPayload?.sub || userId;
        const effectiveDeviceId = tokenPayload?.deviceId;
        if (!effectiveUserId || !effectiveDeviceId) {
            throw new common_1.UnauthorizedException('Invalid refresh token');
        }
        if (deviceId && deviceId !== effectiveDeviceId) {
            throw new common_1.UnauthorizedException('Refresh token device mismatch');
        }
        const redisKey = `user:${effectiveUserId}:device:${effectiveDeviceId}`;
        let storedToken = null;
        storedToken = await this.redis.get(redisKey);
        const user = await this.prisma.user.findUnique({
            where: { id: effectiveUserId },
            include: { profile: true },
        });
        if (!user)
            throw new common_1.UnauthorizedException('User not found');
        const isValidToken = storedToken === providedRefreshToken;
        if (!isValidToken) {
            if (storedToken) {
                await this.redis.del(redisKey);
            }
            throw new common_1.UnauthorizedException('Replay attack detected or token expired. Session revoked.');
        }
        const new_access_token = this.jwtService.sign({
            sub: user.id,
            email: user.email,
            role: user.role,
            deviceId: effectiveDeviceId,
            type: 'access',
            jti: crypto.randomUUID(),
        }, { expiresIn: '1d' });
        const new_refresh_token = this.jwtService.sign({ sub: user.id, deviceId: effectiveDeviceId, type: 'refresh' }, { expiresIn: '30d' });
        await this.redis.set(redisKey, new_refresh_token, 'EX', 30 * 24 * 60 * 60);
        return {
            access_token: new_access_token,
            refresh_token: new_refresh_token,
        };
    }
    async logout(userId, deviceId, accessToken) {
        const redisKey = `user:${userId}:device:${deviceId}`;
        await this.redis.del(redisKey);
        await this.redis.set(`${redisKey}:logged_out_at`, Date.now().toString(), 'EX', 86400);
        const tokenHash = crypto
            .createHash('sha256')
            .update(accessToken)
            .digest('hex');
        const decoded = this.jwtService.decode(accessToken);
        const remainingTtl = Math.max(1, (decoded?.exp ?? Math.floor(Date.now() / 1000) + 86400) -
            Math.floor(Date.now() / 1000));
        await this.redis.set(`jwt:denylist:${tokenHash}`, 'revoked', 'EX', remainingTtl);
        return { message: 'Logged out successfully' };
    }
    async generateOtp(email) {
        const user = await this.prisma.user.findUnique({ where: { email } });
        if (!user)
            throw new common_1.UnauthorizedException('User not found');
        const otp = crypto.randomInt(100000, 1000000).toString();
        const secret = (0, auth_constants_1.getOtpSecret)();
        const hash = crypto.createHmac('sha256', secret).update(otp).digest('hex');
        const redisKey = `otp:${email}`;
        await this.redis.set(redisKey, hash, 'EX', 300);
        if (process.env.NODE_ENV !== 'production') {
            console.log(`[DEV MODE ONLY] OTP for ${email}: ${otp}`);
        }
        return {
            message: process.env.NODE_ENV === 'production'
                ? 'OTP sent successfully'
                : 'OTP sent successfully (check console in DEV)',
        };
    }
    async verifyOtp(email, providedOtp) {
        const redisKey = `otp:${email}`;
        const storedHash = await this.redis.get(redisKey);
        if (!storedHash)
            throw new common_1.UnauthorizedException('OTP expired or invalid');
        const secret = (0, auth_constants_1.getOtpSecret)();
        const computedHash = crypto
            .createHmac('sha256', secret)
            .update(providedOtp)
            .digest('hex');
        if (storedHash !== computedHash) {
            throw new common_1.UnauthorizedException('Invalid OTP');
        }
        await this.redis.del(redisKey);
        return { message: 'OTP verified successfully' };
    }
    async verifyRegistration(email, providedOtp) {
        const pendingRaw = await this.redis.get(`register:pending:${email}`);
        if (!pendingRaw)
            throw new common_1.UnauthorizedException('Registration expired or invalid');
        const otpKey = `register:otp:${email}`;
        const storedHash = await this.redis.get(otpKey);
        if (!storedHash)
            throw new common_1.UnauthorizedException('OTP expired or invalid');
        const attempts = await this.redis.incr(`register:otp:attempts:${email}`);
        await this.redis.expire(`register:otp:attempts:${email}`, 300);
        if (attempts > 5) {
            await this.redis.del(`register:pending:${email}`, otpKey);
            throw new common_1.UnauthorizedException('Too many invalid OTP attempts');
        }
        const computedHash = crypto
            .createHmac('sha256', (0, auth_constants_1.getOtpSecret)())
            .update(providedOtp)
            .digest('hex');
        if (storedHash !== computedHash)
            throw new common_1.UnauthorizedException('Invalid OTP');
        const pending = JSON.parse(pendingRaw);
        const user = await this.prisma.user.create({
            data: {
                email: pending.email,
                password: pending.password,
                role: client_1.Role.STUDENT,
                emailVerifiedAt: new Date(),
                profile: { create: { fullName: pending.fullName } },
            },
            include: { profile: true },
        });
        await this.redis.del(`register:pending:${email}`, otpKey, `register:otp:attempts:${email}`);
        const { password, ...safeUser } = user;
        void password;
        return safeUser;
    }
    async changePassword(userId, currentPassword, newPassword) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user || !(await bcrypt.compare(currentPassword, user.password)))
            throw new common_1.UnauthorizedException('Current password is invalid');
        const password = await bcrypt.hash(newPassword, 12);
        await this.prisma.user.update({
            where: { id: userId },
            data: { password, mustChangePassword: false },
        });
        return { message: 'Password changed successfully' };
    }
    async activateTeacher(token, newPassword) {
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const key = `teacher:activation:${tokenHash}`;
        const userIdRaw = await this.redis.get(key);
        if (!userIdRaw)
            throw new common_1.UnauthorizedException('Activation token expired or invalid');
        const password = await bcrypt.hash(newPassword, 12);
        const user = await this.prisma.user.update({
            where: { id: Number(userIdRaw) },
            data: {
                password,
                emailVerifiedAt: new Date(),
                mustChangePassword: false,
            },
            select: { id: true, email: true, role: true, emailVerifiedAt: true },
        });
        await this.redis.del(key);
        return user;
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)(),
    __param(2, (0, ioredis_1.InjectRedis)()),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        jwt_1.JwtService,
        ioredis_2.default,
        email_service_1.EmailService])
], AuthService);
//# sourceMappingURL=auth.service.js.map