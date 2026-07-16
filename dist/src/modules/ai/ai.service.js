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
var AiService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiService = void 0;
const common_1 = require("@nestjs/common");
const generative_ai_1 = require("@google/generative-ai");
let AiService = AiService_1 = class AiService {
    logger = new common_1.Logger(AiService_1.name);
    genAI;
    constructor() {
        const apiKey = process.env.GEMINI_API_KEY || 'fake-api-key';
        this.genAI = new generative_ai_1.GoogleGenerativeAI(apiKey);
    }
    async generateFeedback(question, studentAnswer) {
        try {
            if (process.env.GEMINI_API_KEY === undefined) {
                this.logger.warn('GEMINI_API_KEY is not set. Returning mock feedback.');
                return `[Mock AI Feedback] This is a mock feedback for answer: "${studentAnswer}". Please set GEMINI_API_KEY to use real AI.`;
            }
            const model = this.genAI.getGenerativeModel({
                model: 'gemini-1.5-flash',
            });
            const prompt = `You are a professional English teacher grading a student's writing assignment.
Question: "${question}"
Student's Answer: "${studentAnswer}"

Provide detailed feedback, including:
1. Overall assessment
2. Grammar and vocabulary corrections
3. Suggestions for improvement
4. Estimated band score (if applicable, e.g., IELTS)
Please keep the response concise but informative.`;
            const result = await model.generateContent(prompt);
            const response = result.response;
            return response.text();
        }
        catch (error) {
            this.logger.error('Failed to generate AI feedback', error);
            return 'Could not generate AI feedback at this time due to an error.';
        }
    }
    async chat(prompt) {
        try {
            if (process.env.GEMINI_API_KEY === undefined) {
                return `[Mock AI Chat] I received your message: "${prompt}". Please set GEMINI_API_KEY.`;
            }
            const model = this.genAI.getGenerativeModel({
                model: 'gemini-1.5-flash',
            });
            const fullPrompt = `You are an AI teaching assistant for an online English learning platform. Answer the student's question helpfully: "${prompt}"`;
            const result = await model.generateContent(fullPrompt);
            return result.response.text();
        }
        catch (error) {
            this.logger.error('Chat AI failed', error);
            return 'I am currently unable to process your request.';
        }
    }
};
exports.AiService = AiService;
exports.AiService = AiService = AiService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], AiService);
//# sourceMappingURL=ai.service.js.map