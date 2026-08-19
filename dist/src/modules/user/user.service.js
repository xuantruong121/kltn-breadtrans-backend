"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
let UserService = class UserService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getUserProfile(userId) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            include: {
                profile: true,
                stats: true,
                leaderboard: true,
                pet: true,
                billing: true,
            },
        });
        if (!user) {
            throw new common_1.NotFoundException('User not found');
        }
        const { password, refreshToken, ...userWithoutSensitiveData } = user;
        return userWithoutSensitiveData;
    }
    async updateUserProfile(userId, updateData) {
        return this.prisma.profile.upsert({
            where: { userId },
            update: updateData,
            create: {
                userId,
                fullName: updateData.fullName || 'User',
                ...updateData,
            },
        });
    }
    async getUserStats(userId) {
        const [stats, leaderboard, pet, vocabProgress, submissionsCount, toeicCount] = await Promise.all([
            this.prisma.userStats.findUnique({ where: { userId } }),
            this.prisma.leaderboard.findUnique({ where: { userId } }),
            this.prisma.userPet.findUnique({ where: { userId } }),
            this.prisma.userVocabWordProgress.count({
                where: { userId, isMastered: true },
            }),
            this.prisma.submission.count({ where: { userId } }),
            this.prisma.toeicAttempt.count({ where: { userId } }),
        ]);
        return {
            streakCount: stats?.streakCount || 0,
            streakFreezes: stats?.streakFreezes || 0,
            totalBanhRan: stats?.totalBanhRan || 0,
            quizAccuracy: stats?.quizAccuracy || 0,
            speakingAccuracy: stats?.speakingAccuracy || 0,
            totalPoints: leaderboard?.totalPoints || 0,
            weeklyExp: leaderboard?.weeklyExp || 0,
            tier: leaderboard?.tier || 'Đồng',
            masteredVocabCount: vocabProgress,
            totalQuizzesDone: submissionsCount + toeicCount,
            pet: pet || null,
        };
    }
};
exports.UserService = UserService;
exports.UserService = UserService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], UserService);
//# sourceMappingURL=user.service.js.map