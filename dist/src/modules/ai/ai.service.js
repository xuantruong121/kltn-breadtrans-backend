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
    async generateDictation(topic, count) {
        return this.aiEvaluator.generateDictation(topic, count);
    }
    async generateTtsAudio(text) {
        const azureKey = process.env.AZURE_SPEECH_KEY;
        const azureRegion = process.env.AZURE_SPEECH_REGION;
        if (!azureKey || !azureRegion) {
            this.logger.warn('Thiếu AZURE_SPEECH_KEY. Bỏ qua tạo Audio.');
            return null;
        }
        try {
            const endpoint = `https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`;
            const ssml = `<speak version='1.0' xml:lang='en-US'>
  <voice xml:lang='en-US' xml:gender='Female' name='en-US-JennyNeural'>
    ${text}
  </voice>
</speak>`;
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Ocp-Apim-Subscription-Key': azureKey,
                    'Content-Type': 'application/ssml+xml',
                    'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
                    'User-Agent': 'BreadtransKLTN',
                },
                body: ssml,
            });
            if (!response.ok) {
                this.logger.error(`Azure TTS failed: ${response.statusText}`);
                return null;
            }
            const arrayBuffer = await response.arrayBuffer();
            return Buffer.from(arrayBuffer);
        }
        catch (e) {
            this.logger.error('Error in Azure TTS:', e);
            return null;
        }
    }
    async evaluateWritingPart1(imageUrl, keywords, userSentence) {
        return this.aiEvaluator.evaluateWritingPart1(imageUrl, keywords, userSentence);
    }
    async evaluateWritingPart2(emailPrompt, userResponse) {
        return this.aiEvaluator.evaluateWritingPart2(emailPrompt, userResponse);
    }
    async evaluateWritingPart3(essayTopic, userEssay) {
        return this.aiEvaluator.evaluateWritingPart3(essayTopic, userEssay);
    }
    async evaluateSpeakingPart3To5(promptText, studentResponse) {
        return this.aiEvaluator.evaluateSpeakingPart3To5(promptText, studentResponse);
    }
    async importEtsPdf(pdfBuffer, pdfMimeType, audioBuffer, audioMimeType, audioUrl) {
        return this.aiEvaluator.importEtsPdf(pdfBuffer, pdfMimeType, audioBuffer, audioMimeType, audioUrl);
    }
};
exports.AiService = AiService;
exports.AiService = AiService = AiService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(ai_evaluator_interface_1.AI_EVALUATOR_TOKEN)),
    __metadata("design:paramtypes", [Object])
], AiService);
//# sourceMappingURL=ai.service.js.map