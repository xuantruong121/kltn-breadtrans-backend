"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var OpenAIEvaluatorStrategy_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAIEvaluatorStrategy = void 0;
const common_1 = require("@nestjs/common");
let OpenAIEvaluatorStrategy = OpenAIEvaluatorStrategy_1 = class OpenAIEvaluatorStrategy {
    logger = new common_1.Logger(OpenAIEvaluatorStrategy_1.name);
    async generateFeedback(question, studentAnswer) {
        this.logger.log('Using OpenAI Strategy to evaluate answer...');
        return `[OpenAI/ChatGPT Feedback] Xin chào, đây là nhận xét giả lập từ ChatGPT cho câu trả lời "${studentAnswer}".`;
    }
    async chat(prompt) {
        this.logger.log('Using OpenAI Strategy for chat...');
        return `[OpenAI/ChatGPT Chat] Cảm ơn bạn đã hỏi: "${prompt}". Tôi (ChatGPT) đang ở chế độ mock.`;
    }
    async assessPronunciation(targetText, audioBuffer) {
        this.logger.log('Using OpenAI Strategy for pronunciation assessment...');
        return {
            overallScore: 7.5,
            clarity: 'Good',
            feedback: `[OpenAI Mock] Assessment for text: "${targetText}". This is a stub implementation.`,
            problematicWords: [],
            suggestions: ['Switch to Gemini strategy for real audio analysis.'],
        };
    }
    async explainToeicError(questionContent, userAnswer, correctAnswer) {
        return 'Mock OpenAI explanation for TOEIC error.';
    }
    async generateToeicQuestions(topic, part, count) {
        return [];
    }
};
exports.OpenAIEvaluatorStrategy = OpenAIEvaluatorStrategy;
exports.OpenAIEvaluatorStrategy = OpenAIEvaluatorStrategy = OpenAIEvaluatorStrategy_1 = __decorate([
    (0, common_1.Injectable)()
], OpenAIEvaluatorStrategy);
//# sourceMappingURL=openai-evaluator.strategy.js.map