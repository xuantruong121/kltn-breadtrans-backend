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
const event_emitter_1 = require("@nestjs/event-emitter");
let GamificationService = class GamificationService {
    prisma;
    eventEmitter;
    constructor(prisma, eventEmitter) {
        this.prisma = prisma;
        this.eventEmitter = eventEmitter;
    }
    async addPoints(userId, points, reason) {
        let myLeaderboard = await this.prisma.leaderboard.findUnique({
            where: { userId },
        });
        if (!myLeaderboard) {
            myLeaderboard = await this.prisma.leaderboard.create({
                data: { userId, tier: 'Đồng' }
            });
        }
        await this.prisma.pointHistory.create({
            data: {
                userId,
                points,
                reason,
            },
        });
        const updatedLeaderboard = await this.prisma.leaderboard.update({
            where: { userId },
            data: {
                totalPoints: { increment: points },
                weeklyExp: { increment: points },
            },
        });
        await this.prisma.userStats.upsert({
            where: { userId },
            update: { totalBanhRan: { increment: points } },
            create: { userId, totalBanhRan: points },
        });
        this.eventEmitter.emit('gamification.xp_earned', { userId, points });
        return updatedLeaderboard;
    }
    async getLeaderboard(tier = 'Đồng') {
        return this.prisma.leaderboard.findMany({
            where: { tier },
            orderBy: { weeklyExp: 'desc' },
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
            where: { userId },
        });
        if (!pet) {
            pet = await this.prisma.userPet.create({
                data: {
                    userId,
                    name: 'Bánh Mì',
                    health: 100,
                    happiness: 100,
                    level: 1,
                    exp: 0,
                },
            });
        }
        return pet;
    }
    async feedPet(userId) {
        const pet = await this.getMyPet(userId);
        let userStats = await this.prisma.userStats.findUnique({
            where: { userId },
        });
        if (!userStats) {
            userStats = await this.prisma.userStats.create({
                data: { userId, totalBanhRan: 0 },
            });
        }
        if (userStats.totalBanhRan < 10) {
            throw new common_1.BadRequestException('Bạn không đủ 10 Bánh Rán để cho thú cưng ăn!');
        }
        await this.prisma.userStats.update({
            where: { userId },
            data: { totalBanhRan: { decrement: 10 } },
        });
        const newExp = pet.exp + 50;
        const newLevel = Math.floor(newExp / 1000) + 1;
        let newName = pet.name;
        if (newLevel >= 10)
            newName = 'Vua Bánh Mì';
        else if (newLevel >= 7)
            newName = 'Bánh Kem Hoàng Gia';
        else if (newLevel >= 4)
            newName = 'Bánh Macaron';
        else if (newLevel >= 2)
            newName = 'Bánh Sừng Bò';
        return this.prisma.userPet.update({
            where: { userId },
            data: {
                name: newName,
                level: newLevel,
                happiness: Math.min(pet.happiness + 20, 100),
                health: Math.min(pet.health + 10, 100),
                exp: newExp,
                lastFedAt: new Date(),
            },
        });
    }
    async getMyDailyQuests(userId) {
        const today = new Date().toISOString().split('T')[0];
        let activeQuests = await this.prisma.dailyQuest.findMany({
            where: { isActive: true },
            take: 3,
        });
        if (activeQuests.length === 0) {
            await this.prisma.dailyQuest.createMany({
                data: [
                    {
                        title: 'Hoàn thành 1 bài Luyện Nghe',
                        targetValue: 1,
                        type: 'COMPLETE_QUIZ',
                        rewardXP: 50,
                        rewardBanh: 10,
                    },
                    {
                        title: 'Đạt 100 điểm kinh nghiệm',
                        targetValue: 100,
                        type: 'EARN_XP',
                        rewardXP: 20,
                        rewardBanh: 5,
                    },
                    {
                        title: 'Học 10 từ vựng',
                        targetValue: 10,
                        type: 'LEARN_VOCAB',
                        rewardXP: 30,
                        rewardBanh: 5,
                    },
                ],
            });
            activeQuests = await this.prisma.dailyQuest.findMany({
                where: { isActive: true },
                take: 3,
            });
        }
        const progresses = [];
        for (const quest of activeQuests) {
            const progress = await this.prisma.userQuestProgress.upsert({
                where: {
                    userId_questId_dateKey: {
                        userId,
                        questId: quest.id,
                        dateKey: today,
                    },
                },
                update: {},
                create: {
                    userId,
                    questId: quest.id,
                    dateKey: today,
                    currentValue: 0,
                },
                include: {
                    quest: true,
                },
            });
            progresses.push(progress);
        }
        return progresses;
    }
    async getArenaSnippet(userId) {
        let myLeaderboard = await this.prisma.leaderboard.findUnique({
            where: { userId },
        });
        const tier = myLeaderboard?.tier || 'Đồng';
        const leaderboard = await this.getLeaderboard(tier);
        const myRankIndex = leaderboard.findIndex((entry) => entry.userId === userId);
        if (myRankIndex === -1) {
            return {
                rank: null,
                tier: 'Đồng',
                message: 'Bạn chưa có mặt trên bảng xếp hạng tuần này.',
            };
        }
        const nextRank = myRankIndex > 0 ? leaderboard[myRankIndex - 1] : null;
        const diff = nextRank
            ? nextRank.weeklyExp - leaderboard[myRankIndex].weeklyExp
            : 0;
        return {
            rank: myRankIndex + 1,
            tier,
            message: diff > 0
                ? `Bạn đang cách Top ${myRankIndex} chỉ ${diff} điểm!`
                : `Tuyệt vời! Bạn đang dẫn đầu bảng xếp hạng.`,
        };
    }
    async spinWheel(userId) {
        const COST = 50;
        const userStats = await this.prisma.userStats.findUnique({ where: { userId } });
        if (!userStats || userStats.totalBanhRan < COST) {
            throw new common_1.BadRequestException('Không đủ 50 Bánh Rán để quay!');
        }
        await this.prisma.userStats.update({
            where: { userId },
            data: { totalBanhRan: { decrement: COST } },
        });
        await this.prisma.pointHistory.create({
            data: { userId, points: -COST, reason: 'Quay vòng quay may mắn' },
        });
        const rand = Math.random() * 100;
        let reward = '';
        let rewardType = '';
        if (rand < 5) {
            reward = '1 Voucher Giảm 5% Học phí';
            rewardType = 'voucher';
            await this.prisma.pointHistory.create({
                data: { userId, points: 0, reason: 'Jackpot: Voucher Giảm 5% Học phí' },
            });
        }
        else if (rand < 20) {
            reward = '100 Bánh Rán';
            rewardType = 'points';
            await this.addPoints(userId, 100, 'Trúng thưởng vòng quay');
        }
        else if (rand < 40) {
            reward = '1 Vé Bảo vệ Chuỗi';
            rewardType = 'streak_freeze';
            await this.prisma.userStats.update({
                where: { userId },
                data: { streakFreezes: { increment: 1 } },
            });
        }
        else {
            reward = '20 Bánh Rán';
            rewardType = 'points';
            await this.addPoints(userId, 20, 'Trúng thưởng vòng quay');
        }
        return { success: true, reward, rewardType };
    }
    async triggerDailyCron() {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0);
        const stats = await this.prisma.userStats.findMany({
            where: {
                lastStreakUpdate: { lt: yesterday },
                streakCount: { gt: 0 }
            }
        });
        for (const stat of stats) {
            if (stat.streakFreezes > 0) {
                await this.prisma.userStats.update({
                    where: { id: stat.id },
                    data: {
                        streakFreezes: { decrement: 1 },
                        lastStreakUpdate: new Date()
                    }
                });
            }
            else {
                await this.prisma.userStats.update({
                    where: { id: stat.id },
                    data: { streakCount: 0 }
                });
            }
        }
        return { success: true, message: `Processed ${stats.length} inactive users.` };
    }
    async triggerWeeklyCron() {
        const tiers = ['Đồng', 'Bạc', 'Vàng', 'Bạch Kim', 'Kim Cương'];
        for (let i = 0; i < tiers.length; i++) {
            const currentTier = tiers[i];
            const usersInTier = await this.prisma.leaderboard.findMany({
                where: { tier: currentTier },
                orderBy: { weeklyExp: 'desc' }
            });
            if (usersInTier.length === 0)
                continue;
            const top20Index = Math.max(1, Math.floor(usersInTier.length * 0.2));
            const bottom20Index = Math.max(usersInTier.length - Math.floor(usersInTier.length * 0.2), top20Index);
            for (let j = 0; j < usersInTier.length; j++) {
                const u = usersInTier[j];
                let newTier = currentTier;
                if (j < top20Index && i < tiers.length - 1) {
                    newTier = tiers[i + 1];
                }
                else if (j >= bottom20Index && i > 0) {
                    newTier = tiers[i - 1];
                }
                await this.prisma.leaderboard.update({
                    where: { id: u.id },
                    data: { tier: newTier, weeklyExp: 0 }
                });
            }
        }
        return { success: true, message: 'Leagues updated successfully.' };
    }
};
exports.GamificationService = GamificationService;
exports.GamificationService = GamificationService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        event_emitter_1.EventEmitter2])
], GamificationService);
//# sourceMappingURL=gamification.service.js.map