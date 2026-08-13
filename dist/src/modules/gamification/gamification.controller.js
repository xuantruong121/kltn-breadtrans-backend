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
exports.GamificationController = void 0;
const common_1 = require("@nestjs/common");
const gamification_service_1 = require("./gamification.service");
const swagger_1 = require("@nestjs/swagger");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
let GamificationController = class GamificationController {
    gamificationService;
    constructor(gamificationService) {
        this.gamificationService = gamificationService;
    }
    getLeaderboard() {
        return this.gamificationService.getLeaderboard();
    }
    getMyBadges(req) {
        return this.gamificationService.getMyBadges(req.user.id);
    }
    getMyPet(req) {
        return this.gamificationService.getMyPet(req.user.id);
    }
    feedPet(req) {
        return this.gamificationService.feedPet(req.user.id);
    }
    getMyDailyQuests(req) {
        return this.gamificationService.getMyDailyQuests(req.user.id);
    }
    getArenaSnippet(req) {
        return this.gamificationService.getArenaSnippet(req.user.id);
    }
};
exports.GamificationController = GamificationController;
__decorate([
    (0, common_1.Get)('leaderboard'),
    (0, swagger_1.ApiOperation)({ summary: 'Lấy top 10 bảng xếp hạng điểm số' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], GamificationController.prototype, "getLeaderboard", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.Get)('badges/me'),
    (0, swagger_1.ApiOperation)({ summary: 'Lấy danh sách huy hiệu của học viên hiện tại' }),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], GamificationController.prototype, "getMyBadges", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.Get)('pet'),
    (0, swagger_1.ApiOperation)({ summary: 'Lấy thông tin thú cưng của học sinh' }),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], GamificationController.prototype, "getMyPet", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.Post)('pet/feed'),
    (0, swagger_1.ApiOperation)({ summary: 'Cho thú cưng ăn (Tiêu hao bánh rán)' }),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], GamificationController.prototype, "feedPet", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.Get)('quests'),
    (0, swagger_1.ApiOperation)({ summary: 'Lấy danh sách nhiệm vụ hôm nay và tiến độ' }),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], GamificationController.prototype, "getMyDailyQuests", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.Get)('arena/snippet'),
    (0, swagger_1.ApiOperation)({ summary: 'Lấy tóm tắt rank đấu trường cho trang chủ' }),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], GamificationController.prototype, "getArenaSnippet", null);
exports.GamificationController = GamificationController = __decorate([
    (0, swagger_1.ApiTags)('gamification'),
    (0, common_1.Controller)('gamification'),
    __metadata("design:paramtypes", [gamification_service_1.GamificationService])
], GamificationController);
//# sourceMappingURL=gamification.controller.js.map