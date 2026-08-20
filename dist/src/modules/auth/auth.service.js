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
let AuthService = class AuthService {
    prisma;
    jwtService;
    redis;
    constructor(prisma, jwtService, redis) {
        this.prisma = prisma;
        this.jwtService = jwtService;
        this.redis = redis;
    }
    async register(registerDto) {
        const { email, password, fullName } = registerDto;
        const existingUser = await this.prisma.user.findUnique({
            where: { email },
        });
        if (existingUser)
            throw new common_1.ConflictException('Email already exists');
        const salt = await bcrypt.genSalt();
        const hashedPassword = await bcrypt.hash(password, salt);
        const newUser = await this.prisma.user.create({
            data: {
                email,
                password: hashedPassword,
                profile: { create: { fullName } },
            },
            include: { profile: true },
        });
        const { password: _, ...userWithoutPassword } = newUser;
        return userWithoutPassword;
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
        const payload = { sub: user.id, email: user.email, role: user.role };
        const access_token = this.jwtService.sign(payload, { expiresIn: '1h' });
        const refreshToken = crypto.randomBytes(40).toString('hex');
        const redisKey = `user:${user.id}:device:${deviceId}`;
        await this.redis.set(redisKey, refreshToken, 'EX', 7 * 24 * 60 * 60);
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
        const redisKey = `user:${userId}:device:${deviceId}`;
        const storedToken = await this.redis.get(redisKey);
        if (storedToken !== providedRefreshToken) {
            await this.redis.del(redisKey);
            throw new common_1.UnauthorizedException('Replay attack detected or token expired. Session revoked.');
        }
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user)
            throw new common_1.UnauthorizedException('User not found');
        const payload = { sub: user.id, email: user.email, role: user.role };
        const access_token = this.jwtService.sign(payload, { expiresIn: '1h' });
        const new_refresh_token = crypto.randomBytes(40).toString('hex');
        await this.redis.set(redisKey, new_refresh_token, 'EX', 7 * 24 * 60 * 60);
        return {
            access_token,
            refresh_token: new_refresh_token,
        };
    }
    async logout(userId, deviceId) {
        const redisKey = `user:${userId}:device:${deviceId}`;
        await this.redis.del(redisKey);
        return { message: 'Logged out successfully' };
    }
    async generateOtp(email) {
        const user = await this.prisma.user.findUnique({ where: { email } });
        if (!user)
            throw new common_1.UnauthorizedException('User not found');
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const secret = process.env.OTP_SECRET || 'secret-key-otp';
        const hash = crypto.createHmac('sha256', secret).update(otp).digest('hex');
        const redisKey = `otp:${email}`;
        await this.redis.set(redisKey, hash, 'EX', 300);
        console.log(`[DEV MODE] OTP for ${email}: ${otp}`);
        return { message: 'OTP sent successfully (check console)' };
    }
    async verifyOtp(email, providedOtp) {
        const redisKey = `otp:${email}`;
        const storedHash = await this.redis.get(redisKey);
        if (!storedHash)
            throw new common_1.UnauthorizedException('OTP expired or invalid');
        const secret = process.env.OTP_SECRET || 'secret-key-otp';
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
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)(),
    __param(2, (0, ioredis_1.InjectRedis)()),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        jwt_1.JwtService,
        ioredis_2.default])
], AuthService);
//# sourceMappingURL=auth.service.js.map