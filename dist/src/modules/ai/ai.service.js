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
var AiService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiService = void 0;
const common_1 = require("@nestjs/common");
const ai_evaluator_interface_1 = require("./strategies/ai-evaluator.interface");
let AiService = AiService_1 = class AiService {
    aiEvaluator;
    logger = new common_1.Logger(AiService_1.name);
    constructor(aiEvaluator) {
        this.aiEvaluator = aiEvaluator;
        this.logger.log('AiService initialized with Strategy Pattern');
    }
    async generateFeedback(question, studentAnswer) {
        return this.aiEvaluator.generateFeedback(question, studentAnswer);
    }
    async chat(prompt) {
        return this.aiEvaluator.chat(prompt);
    }
    async assessPronunciation(targetText, audioBuffer) {
        return this.aiEvaluator.assessPronunciation(targetText, audioBuffer);
    }
    async explainToeicError(questionContent, userAnswer, correctAnswer) {
        return this.aiEvaluator.explainToeicError(questionContent, userAnswer, correctAnswer);
    }
    async generateToeicQuestions(topic, part, count) {
        return this.aiEvaluator.generateToeicQuestions(topic, part, count);
    }
};
exports.AiService = AiService;
exports.AiService = AiService = AiService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(ai_evaluator_interface_1.AI_EVALUATOR_TOKEN)),
    __metadata("design:paramtypes", [Object])
], AiService);
//# sourceMappingURL=ai.service.js.map