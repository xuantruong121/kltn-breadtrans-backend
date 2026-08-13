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
exports.GamificationService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
let GamificationService = class GamificationService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async addPoints(userId, points, reason) {
        await this.prisma.pointHistory.create({
            data: {
                userId,
                points,
                reason
            }
        });
        await this.prisma.leaderboard.upsert({
            where: { userId },
            update: { totalPoints: { increment: points } },
            create: { userId, totalPoints: points }
        });
        await this.prisma.userStats.upsert({
            where: { userId },
            update: { totalBanhRan: { increment: points } },
            create: { userId, totalBanhRan: points }
        });
    }
    async getLeaderboard() {
        return this.prisma.leaderboard.findMany({
            orderBy: { totalPoints: 'desc' },
            take: 10,
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        profile: true,
                    },
                },
            },
        });
    }
    async getMyBadges(userId) {
        return this.prisma.userBadge.findMany({
            where: { userId },
            include: {
                badge: true,
            },
        });
    }
    async getMyPet(userId) {
        let pet = await this.prisma.userPet.findUnique({
            where: { userId }
        });
        if (!pet) {
            pet = await this.prisma.userPet.create({
                data: {
                    userId,
                    name: 'Bánh Mì',
                    health: 100,
                    happiness: 100,
                    level: 1,
                    exp: 0
                }
            });
        }
        return pet;
    }
    async feedPet(userId) {
        const pet = await this.getMyPet(userId);
        await this.prisma.userStats.update({
            where: { userId },
            data: { totalBanhRan: { decrement: 10 } }
        });
        return this.prisma.userPet.update({
            where: { userId },
            data: {
                happiness: Math.min(pet.happiness + 20, 100),
                health: Math.min(pet.health + 10, 100),
                exp: pet.exp + 50,
                lastFedAt: new Date()
            }
        });
    }
    async getMyDailyQuests(userId) {
        const today = new Date().toISOString().split('T')[0];
        let activeQuests = await this.prisma.dailyQuest.findMany({
            where: { isActive: true },
            take: 3
        });
        if (activeQuests.length === 0) {
            await this.prisma.dailyQuest.createMany({
                data: [
                    { title: "Hoàn thành 1 bài luyện nói", targetValue: 1, type: "DO_SPEAKING", rewardXP: 50, rewardBanh: 10 },
                    { title: "Đạt 100 điểm kinh nghiệm", targetValue: 100, type: "EARN_XP", rewardXP: 20, rewardBanh: 5 },
                    { title: "Học 10 từ vựng", targetValue: 10, type: "LEARN_VOCAB", rewardXP: 30, rewardBanh: 5 }
                ]
            });
            activeQuests = await this.prisma.dailyQuest.findMany({
                where: { isActive: true },
                take: 3
            });
        }
        const progresses = [];
        for (const quest of activeQuests) {
            const progress = await this.prisma.userQuestProgress.upsert({
                where: {
                    userId_questId_dateKey: {
                        userId,
                        questId: quest.id,
                        dateKey: today
                    }
                },
                update: {},
                create: {
                    userId,
                    questId: quest.id,
                    dateKey: today,
                    currentValue: 0
                },
                include: {
                    quest: true
                }
            });
            progresses.push(progress);
        }
        return progresses;
    }
    async getArenaSnippet(userId) {
        const leaderboard = await this.getLeaderboard();
        const myRankIndex = leaderboard.findIndex(entry => entry.userId === userId);
        if (myRankIndex === -1) {
            return {
                rank: null,
                tier: 'Đồng',
                message: 'Bạn chưa có mặt trên bảng xếp hạng.'
            };
        }
        const tier = myRankIndex < 3 ? 'Vàng' : myRankIndex < 7 ? 'Bạc' : 'Đồng';
        const nextRank = myRankIndex > 0 ? leaderboard[myRankIndex - 1] : null;
        const diff = nextRank ? nextRank.totalPoints - leaderboard[myRankIndex].totalPoints : 0;
        return {
            rank: myRankIndex + 1,
            tier,
            message: diff > 0
                ? `Bạn đang cách Top ${myRankIndex} chỉ ${diff} điểm!`
                : `Tuyệt vời! Bạn đang dẫn đầu bảng xếp hạng.`
        };
    }
};
exports.GamificationService = GamificationService;
exports.GamificationService = GamificationService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], GamificationService);
//# sourceMappingURL=gamification.service.js.map