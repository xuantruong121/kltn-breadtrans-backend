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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GamificationService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const event_emitter_1 = require("@nestjs/event-emitter");
const notifications_service_1 = require("../notifications/notifications.service");
let GamificationService = class GamificationService {
    prisma;
    eventEmitter;
    notificationsService;
    constructor(prisma, eventEmitter, notificationsService) {
        this.prisma = prisma;
        this.eventEmitter = eventEmitter;
        this.notificationsService = notificationsService;
    }
    async addPoints(userId, points, reason) {
        let myLeaderboard = await this.prisma.leaderboard.findUnique({
            where: { userId },
        });
        if (!myLeaderboard) {
            myLeaderboard = await this.prisma.leaderboard.create({
                data: { userId, tier: 'Đồng' },
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
        await this.recordStreakActivity(userId);
        this.eventEmitter.emit('gamification.xp_earned', { userId, points });
        return updatedLeaderboard;
    }
    async recordStreakActivity(userId) {
        try {
            const now = new Date();
            const stats = await this.prisma.userStats.findUnique({
                where: { userId },
            });
            if (!stats) {
                await this.prisma.userStats.create({
                    data: {
                        userId,
                        streakCount: 1,
                        lastStreakUpdate: now,
                    },
                });
                return;
            }
            const lastUpdate = stats.lastStreakUpdate
                ? new Date(stats.lastStreakUpdate)
                : null;
            if (!lastUpdate) {
                await this.prisma.userStats.update({
                    where: { userId },
                    data: { streakCount: 1, lastStreakUpdate: now },
                });
                return;
            }
            const nowDateStr = now.toISOString().split('T')[0];
            const lastDateStr = lastUpdate.toISOString().split('T')[0];
            if (nowDateStr === lastDateStr) {
                return;
            }
            const nowMidnight = new Date(nowDateStr).getTime();
            const lastMidnight = new Date(lastDateStr).getTime();
            const diffDays = Math.round((nowMidnight - lastMidnight) / (1000 * 60 * 60 * 24));
            if (diffDays === 1) {
                await this.prisma.userStats.update({
                    where: { userId },
                    data: {
                        streakCount: { increment: 1 },
                        lastStreakUpdate: now,
                    },
                });
            }
            else if (diffDays > 1) {
                if (stats.streakFreezes > 0) {
                    await this.prisma.userStats.update({
                        where: { userId },
                        data: {
                            streakFreezes: { decrement: 1 },
                            streakCount: { increment: 1 },
                            lastStreakUpdate: now,
                        },
                    });
                }
                else {
                    await this.prisma.userStats.update({
                        where: { userId },
                        data: {
                            streakCount: 1,
                            lastStreakUpdate: now,
                        },
                    });
                }
            }
        }
        catch (err) {
            console.error('[Streak] Failed to update streak for user:', userId, err);
        }
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
        const DEFAULT_BADGES = [
            {
                name: 'Tân Binh',
                description: 'Đạt 100 điểm kinh nghiệm đầu tiên',
                criteria: { type: 'EXP', threshold: 100 },
            },
            {
                name: 'Chăm Chỉ',
                description: 'Duy trì chuỗi ngày học liên tục',
                criteria: { type: 'STREAK', threshold: 1 },
            },
            {
                name: 'Siêu Sao',
                description: 'Đạt Top 1 Bảng xếp hạng tuần',
                criteria: { type: 'LEADERBOARD_TOP1' },
            },
            {
                name: 'Thợ Săn',
                description: 'Thu thập đủ 1000 điểm kinh nghiệm',
                criteria: { type: 'EXP', threshold: 1000 },
            },
            {
                name: 'Học Bá',
                description: 'Đạt điểm tối đa trong các bài Quiz',
                criteria: { type: 'QUIZ', threshold: 1 },
            },
            {
                name: 'Đấu Sĩ Bất Bại',
                description: 'Thắng các trận so tài trong Đấu Trường',
                criteria: { type: 'ARENA', threshold: 1 },
            },
            {
                name: 'Giọng Đọc Vàng',
                description: 'Đạt điểm phát âm AI xuất sắc',
                criteria: { type: 'SPEAKING', threshold: 1 },
            },
            {
                name: 'Chuyên Gia Nuôi Thú',
                description: 'Nuôi thú cưng đạt Cấp độ 2 trở lên',
                criteria: { type: 'PET_LEVEL', threshold: 2 },
            },
        ];
        for (const b of DEFAULT_BADGES) {
            const existing = await this.prisma.badge.findFirst({
                where: { name: b.name },
            });
            if (!existing) {
                await this.prisma.badge.create({
                    data: {
                        name: b.name,
                        description: b.description,
                        iconUrl: '',
                        criteria: b.criteria,
                    },
                });
            }
        }
        const leaderboard = await this.prisma.leaderboard.findUnique({
            where: { userId },
        });
        const userStats = await this.prisma.userStats.findUnique({
            where: { userId },
        });
        const userPet = await this.prisma.userPet.findUnique({
            where: { userId },
        });
        const totalExp = leaderboard?.totalPoints || 0;
        const weeklyExp = leaderboard?.weeklyExp || 0;
        const streak = userStats?.streakCount || 0;
        const petLevel = userPet?.level || 1;
        const badgesToAward = [];
        if (totalExp >= 100 || weeklyExp >= 100) {
            badgesToAward.push('Tân Binh');
        }
        if (totalExp >= 1000 || weeklyExp >= 1000) {
            badgesToAward.push('Thợ Săn');
        }
        if (streak >= 1) {
            badgesToAward.push('Chăm Chỉ');
        }
        const topRank = await this.prisma.leaderboard.findFirst({
            orderBy: { weeklyExp: 'desc' },
        });
        if (topRank && topRank.userId === userId && weeklyExp > 0) {
            badgesToAward.push('Siêu Sao');
        }
        if (petLevel >= 2) {
            badgesToAward.push('Chuyên Gia Nuôi Thú');
        }
        for (const badgeName of badgesToAward) {
            const badgeRecord = await this.prisma.badge.findFirst({
                where: { name: badgeName },
            });
            if (badgeRecord) {
                const userBadgeExists = await this.prisma.userBadge.findUnique({
                    where: {
                        userId_badgeId: {
                            userId,
                            badgeId: badgeRecord.id,
                        },
                    },
                });
                if (!userBadgeExists) {
                    await this.prisma.userBadge.create({
                        data: {
                            userId,
                            badgeId: badgeRecord.id,
                        },
                    });
                }
            }
        }
        return this.prisma.userBadge.findMany({
            where: { userId },
            include: {
                badge: true,
            },
        });
    }
    normalizeSpeciesKey(name) {
        if (!name)
            return 'bready';
        const n = name.trim().toLowerCase();
        if (n.includes('cú') ||
            n === 'owly' ||
            n.includes('owl') ||
            n.includes('thông thái') ||
            n.includes('cử nhân')) {
            return 'owly';
        }
        if (n.includes('mèo bánh cá') ||
            n.includes('taiyaki') ||
            n === 'mimi' ||
            n.includes('mimi') ||
            n.includes('nơ hồng') ||
            n.includes('thiên thần')) {
            return 'mimi';
        }
        if (n.includes('cáo') ||
            n === 'foxy' ||
            n.includes('fox') ||
            n.includes('phim')) {
            return 'foxy';
        }
        return 'bready';
    }
    async getMyPet(userId) {
        let pet = await this.prisma.userPet.findUnique({
            where: { userId },
        });
        if (!pet) {
            const initialRoster = {
                bready: {
                    level: 1,
                    exp: 0,
                    health: 100,
                    happiness: 100,
                    lastFedAt: null,
                },
                owly: {
                    level: 1,
                    exp: 0,
                    health: 100,
                    happiness: 100,
                    lastFedAt: null,
                },
                mimi: {
                    level: 1,
                    exp: 0,
                    health: 100,
                    happiness: 100,
                    lastFedAt: null,
                },
                foxy: {
                    level: 1,
                    exp: 0,
                    health: 100,
                    happiness: 100,
                    lastFedAt: null,
                },
            };
            pet = await this.prisma.userPet.create({
                data: {
                    userId,
                    name: 'Bánh Mì Dũng Cảm',
                    health: 100,
                    happiness: 100,
                    level: 1,
                    exp: 0,
                    roster: initialRoster,
                },
            });
            return pet;
        }
        const currentSpecies = this.normalizeSpeciesKey(pet.name);
        const roster = pet.roster || {};
        if (!roster[currentSpecies]) {
            roster[currentSpecies] = {
                level: pet.level || 1,
                exp: pet.exp || 0,
                health: pet.health ?? 100,
                happiness: pet.happiness ?? 100,
                lastFedAt: pet.lastFedAt,
            };
        }
        const activePetData = roster[currentSpecies];
        const now = new Date().getTime();
        const lastFedTime = activePetData.lastFedAt
            ? new Date(activePetData.lastFedAt).getTime()
            : new Date(pet.createdAt).getTime();
        const hoursSinceLastFed = Math.floor((now - lastFedTime) / (1000 * 60 * 60));
        if (hoursSinceLastFed >= 24) {
            const daysPassed = Math.floor(hoursSinceLastFed / 24);
            const healthDecay = daysPassed * 10;
            const happinessDecay = daysPassed * 15;
            const newHealth = Math.max(20, 100 - healthDecay);
            const newHappiness = Math.max(20, 100 - happinessDecay);
            if (newHealth !== activePetData.health ||
                newHappiness !== activePetData.happiness) {
                activePetData.health = newHealth;
                activePetData.happiness = newHappiness;
                roster[currentSpecies] = activePetData;
                pet = await this.prisma.userPet.update({
                    where: { userId },
                    data: {
                        health: newHealth,
                        happiness: newHappiness,
                        roster: roster,
                    },
                });
            }
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
        const currentSpecies = this.normalizeSpeciesKey(pet.name);
        const roster = pet.roster || {};
        const activePetData = roster[currentSpecies] || {
            level: pet.level || 1,
            exp: pet.exp || 0,
            health: pet.health ?? 100,
            happiness: pet.happiness ?? 100,
            lastFedAt: null,
        };
        const newExp = (activePetData.exp || 0) + 50;
        const newLevel = Math.floor(newExp / 1000) + 1;
        const newHappiness = Math.min((activePetData.happiness ?? 100) + 20, 100);
        const newHealth = Math.min((activePetData.health ?? 100) + 10, 100);
        const now = new Date();
        activePetData.exp = newExp;
        activePetData.level = newLevel;
        activePetData.happiness = newHappiness;
        activePetData.health = newHealth;
        activePetData.lastFedAt = now;
        roster[currentSpecies] = activePetData;
        return this.prisma.userPet.update({
            where: { userId },
            data: {
                level: newLevel,
                exp: newExp,
                happiness: newHappiness,
                health: newHealth,
                lastFedAt: now,
                roster: roster,
            },
        });
    }
    async changePetType(userId, targetPetName) {
        const pet = await this.getMyPet(userId);
        const currentSpecies = this.normalizeSpeciesKey(pet.name);
        const targetSpecies = this.normalizeSpeciesKey(targetPetName);
        const roster = pet.roster || {};
        roster[currentSpecies] = {
            level: pet.level || 1,
            exp: pet.exp || 0,
            health: pet.health ?? 100,
            happiness: pet.happiness ?? 100,
            lastFedAt: pet.lastFedAt,
        };
        if (!roster[targetSpecies]) {
            roster[targetSpecies] = {
                level: 1,
                exp: 0,
                health: 100,
                happiness: 100,
                lastFedAt: null,
            };
        }
        const targetData = roster[targetSpecies];
        return this.prisma.userPet.update({
            where: { userId },
            data: {
                name: targetPetName,
                level: targetData.level || 1,
                exp: targetData.exp || 0,
                health: targetData.health ?? 100,
                happiness: Math.min((targetData.happiness ?? 100) + 15, 100),
                lastFedAt: targetData.lastFedAt,
                roster: roster,
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
    async recordVocabLearned(userId, count = 1) {
        const validCount = Math.max(1, count || 1);
        await this.eventEmitter.emitAsync('vocab.learned', {
            userId,
            count: validCount,
        });
        return { success: true, count: validCount };
    }
    async getArenaSnippet(userId) {
        const myLeaderboard = await this.prisma.leaderboard.findUnique({
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
        const userStats = await this.prisma.userStats.findUnique({
            where: { userId },
        });
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
                streakCount: { gt: 0 },
            },
        });
        for (const stat of stats) {
            if (stat.streakFreezes > 0) {
                await this.prisma.userStats.update({
                    where: { id: stat.id },
                    data: {
                        streakFreezes: { decrement: 1 },
                        lastStreakUpdate: new Date(),
                    },
                });
            }
            else {
                await this.prisma.userStats.update({
                    where: { id: stat.id },
                    data: { streakCount: 0 },
                });
            }
        }
        return {
            success: true,
            message: `Processed ${stats.length} inactive users.`,
        };
    }
    async triggerWeeklyCron() {
        const tiers = ['Đồng', 'Bạc', 'Vàng', 'Bạch Kim', 'Kim Cương'];
        for (let i = 0; i < tiers.length; i++) {
            const currentTier = tiers[i];
            const usersInTier = await this.prisma.leaderboard.findMany({
                where: { tier: currentTier },
                orderBy: { weeklyExp: 'desc' },
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
                    data: { tier: newTier, weeklyExp: 0 },
                });
            }
        }
        return { success: true, message: 'Leagues updated successfully.' };
    }
    async sendAdmiration(senderId, targetUserId, message) {
        if (senderId === targetUserId) {
            throw new common_1.BadRequestException('Bạn không thể tự gửi ngưỡng mộ cho chính mình!');
        }
        const sender = await this.prisma.user.findUnique({
            where: { id: senderId },
            include: { profile: true },
        });
        const targetUser = await this.prisma.user.findUnique({
            where: { id: targetUserId },
            include: { stats: true },
        });
        if (!targetUser) {
            throw new common_1.BadRequestException('Không tìm thấy học viên nhận ngưỡng mộ!');
        }
        const senderName = sender?.profile?.fullName || sender?.email || 'Một bạn học';
        const admirationMsg = message || 'Rất ngưỡng mộ thành tích học tập của bạn! Cùng cố gắng nhé!';
        if (this.notificationsService) {
            void this.notificationsService.sendPushToUser(targetUserId, {
                title: '⭐ Bạn nhận được lời ngưỡng mộ mới!',
                body: `${senderName}: "${admirationMsg}"`,
                icon: sender?.profile?.avatar || '/icons/icon-192.png',
                url: '/student/profile',
            });
        }
        return {
            success: true,
            message: `Đã gửi lời ngưỡng mộ tới bạn học thành công!`,
        };
    }
};
exports.GamificationService = GamificationService;
exports.GamificationService = GamificationService = __decorate([
    (0, common_1.Injectable)(),
    __param(2, (0, common_1.Optional)()),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        event_emitter_1.EventEmitter2,
        notifications_service_1.NotificationsService])
], GamificationService);
//# sourceMappingURL=gamification.service.js.map