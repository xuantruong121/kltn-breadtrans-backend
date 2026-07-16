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
var GamificationListener_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.GamificationListener = void 0;
const common_1 = require("@nestjs/common");
const event_emitter_1 = require("@nestjs/event-emitter");
const prisma_service_1 = require("../../prisma/prisma.service");
let GamificationListener = GamificationListener_1 = class GamificationListener {
    prisma;
    logger = new common_1.Logger(GamificationListener_1.name);
    constructor(prisma) {
        this.prisma = prisma;
    }
    async handleQuizSubmittedEvent(payload) {
        this.logger.log(`Handling quiz.submitted event for user ${payload.userId} with score ${payload.score}`);
        try {
            const pointsEarned = payload.score * 10;
            if (pointsEarned > 0) {
                await this.prisma.pointHistory.create({
                    data: {
                        userId: payload.userId,
                        points: pointsEarned,
                        reason: 'Hoàn thành bài thi (Quiz)',
                    }
                });
                const leaderboard = await this.prisma.leaderboard.upsert({
                    where: { userId: payload.userId },
                    update: { totalPoints: { increment: pointsEarned } },
                    create: { userId: payload.userId, totalPoints: pointsEarned },
                });
                const firstBadge = await this.prisma.badge.findFirst({
                    where: { name: 'Thợ săn điểm số' }
                });
                if (firstBadge && leaderboard.totalPoints >= 100) {
                    const userBadgeExists = await this.prisma.userBadge.findUnique({
                        where: { userId_badgeId: { userId: payload.userId, badgeId: firstBadge.id } }
                    });
                    if (!userBadgeExists) {
                        await this.prisma.userBadge.create({
                            data: {
                                userId: payload.userId,
                                badgeId: firstBadge.id,
                            }
                        });
                        this.logger.log(`Awarded badge ${firstBadge.name} to user ${payload.userId}`);
                    }
                }
            }
        }
        catch (error) {
            this.logger.error(`Failed to handle gamification for user ${payload.userId}`, error);
        }
    }
};
exports.GamificationListener = GamificationListener;
__decorate([
    (0, event_emitter_1.OnEvent)('quiz.submitted'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], GamificationListener.prototype, "handleQuizSubmittedEvent", null);
exports.GamificationListener = GamificationListener = GamificationListener_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], GamificationListener);
//# sourceMappingURL=gamification.listener.js.map