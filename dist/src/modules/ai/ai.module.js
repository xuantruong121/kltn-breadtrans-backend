"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiModule = void 0;
const common_1 = require("@nestjs/common");
const ai_controller_1 = require("./ai.controller");
const ai_service_1 = require("./ai.service");
const ai_generator_controller_1 = require("./ai-generator.controller");
const ai_generator_service_1 = require("./ai-generator.service");
const gemini_evaluator_strategy_1 = require("./strategies/gemini-evaluator.strategy");
const ai_evaluator_interface_1 = require("./strategies/ai-evaluator.interface");
const upload_module_1 = require("../upload/upload.module");
const prisma_module_1 = require("../../prisma/prisma.module");
let AiModule = class AiModule {
};
exports.AiModule = AiModule;
exports.AiModule = AiModule = __decorate([
    (0, common_1.Module)({
        imports: [upload_module_1.UploadModule, prisma_module_1.PrismaModule],
        controllers: [ai_controller_1.AiController, ai_generator_controller_1.AiGeneratorController],
        providers: [
            ai_service_1.AiService,
            ai_generator_service_1.AiGeneratorService,
            {
                provide: ai_evaluator_interface_1.AI_EVALUATOR_TOKEN,
                useClass: gemini_evaluator_strategy_1.GeminiEvaluatorStrategy,
            },
        ],
        exports: [ai_service_1.AiService, ai_generator_service_1.AiGeneratorService],
    })
], AiModule);
//# sourceMappingURL=ai.module.js.map