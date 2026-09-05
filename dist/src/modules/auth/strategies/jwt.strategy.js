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
exports.JwtStrategy = void 0;
const common_1 = require("@nestjs/common");
const passport_1 = require("@nestjs/passport");
const passport_jwt_1 = require("passport-jwt");
const prisma_service_1 = require("../../../prisma/prisma.service");
const ioredis_1 = require("@nestjs-modules/ioredis");
const ioredis_2 = __importDefault(require("ioredis"));
const crypto = __importStar(require("crypto"));
const auth_constants_1 = require("../auth.constants");
let JwtStrategy = class JwtStrategy extends (0, passport_1.PassportStrategy)(passport_jwt_1.Strategy) {
    prisma;
    redis;
    constructor(prisma, redis) {
        super({
            jwtFromRequest: passport_jwt_1.ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: (0, auth_constants_1.getJwtSecret)(),
            passReqToCallback: true,
        });
        this.prisma = prisma;
        this.redis = redis;
    }
    async validate(req, payload) {
        if (!payload || payload.type !== 'access' || !payload.deviceId) {
            throw new common_1.UnauthorizedException('Yêu cầu access token hợp lệ.');
        }
        const rawToken = passport_jwt_1.ExtractJwt.fromAuthHeaderAsBearerToken()(req);
        if (!rawToken) {
            throw new common_1.UnauthorizedException('Access token is required.');
        }
        const tokenHash = crypto
            .createHash('sha256')
            .update(rawToken)
            .digest('hex');
        if (await this.redis.get(`jwt:denylist:${tokenHash}`)) {
            throw new common_1.UnauthorizedException('Token đã bị thu hồi.');
        }
        const loggedOutAt = await this.redis.get(`user:${payload.sub}:device:${payload.deviceId}:logged_out_at`);
        if (loggedOutAt &&
            payload.iat &&
            payload.iat * 1000 < Number(loggedOutAt)) {
            throw new common_1.UnauthorizedException('Phiên thiết bị đã kết thúc.');
        }
        const user = await this.prisma.user.findUnique({
            where: { id: payload.sub },
        });
        if (!user) {
            throw new common_1.UnauthorizedException('Token is invalid or user does not exist');
        }
        const path = req?.route?.path || req?.path || '';
        if (user.mustChangePassword &&
            !String(path).endsWith('/change-password') &&
            !String(path).endsWith('/logout')) {
            throw new common_1.ForbiddenException('Bạn phải đổi mật khẩu trước khi tiếp tục.');
        }
        return {
            ...user,
            deviceId: payload.deviceId,
            jti: payload.jti,
            tokenType: payload.type,
        };
    }
};
exports.JwtStrategy = JwtStrategy;
exports.JwtStrategy = JwtStrategy = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, ioredis_1.InjectRedis)()),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        ioredis_2.default])
], JwtStrategy);
//# sourceMappingURL=jwt.strategy.js.map