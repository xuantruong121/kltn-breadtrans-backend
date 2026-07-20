"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WritingModule = void 0;
const common_1 = require("@nestjs/common");
const writing_controller_1 = require("./writing.controller");
const writing_service_1 = require("./writing.service");
const ai_module_1 = require("../ai/ai.module");
const prisma_module_1 = require("../../prisma/prisma.module");
let WritingModule = class WritingModule {
};
exports.WritingModule = WritingModule;
exports.WritingModule = WritingModule = __decorate([
    (0, common_1.Module)({
        imports: [ai_module_1.AiModule, prisma_module_1.PrismaModule],
        controllers: [writing_controller_1.WritingController],
        providers: [writing_service_1.WritingService],
    })
], WritingModule);
//# sourceMappingURL=writing.module.js.map