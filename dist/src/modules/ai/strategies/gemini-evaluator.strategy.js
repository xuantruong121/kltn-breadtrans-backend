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
var GeminiEvaluatorStrategy_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeminiEvaluatorStrategy = void 0;
const common_1 = require("@nestjs/common");
const generative_ai_1 = require("@google/generative-ai");
let GeminiEvaluatorStrategy = GeminiEvaluatorStrategy_1 = class GeminiEvaluatorStrategy {
    logger = new common_1.Logger(GeminiEvaluatorStrategy_1.name);
    genAI;
    constructor() {
        const apiKey = process.env.GEMINI_API_KEY || 'fake-api-key';
        this.genAI = new generative_ai_1.GoogleGenerativeAI(apiKey);
    }
    async generateFeedback(question, studentAnswer) {
        try {
            if (process.env.GEMINI_API_KEY === undefined) {
                this.logger.warn('GEMINI_API_KEY is not set. Returning mock feedback.');
                return `[Mock Gemini Feedback] This is a mock feedback for answer: "${studentAnswer}". Please set GEMINI_API_KEY to use real AI.`;
            }
            const model = this.genAI.getGenerativeModel({
                model: 'gemini-3.5-flash',
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
            this.logger.error('Failed to generate Gemini AI feedback', error);
            return 'Could not generate AI feedback at this time due to an error.';
        }
    }
    async chat(prompt) {
        try {
            if (process.env.GEMINI_API_KEY === undefined) {
                return `[Mock Gemini Chat] I received your message: "${prompt}". Please set GEMINI_API_KEY.`;
            }
            const model = this.genAI.getGenerativeModel({
                model: 'gemini-2.5-flash',
            });
            const fullPrompt = `You are an AI teaching assistant for an online English learning platform. Answer the student's question helpfully: "${prompt}"`;
            const result = await model.generateContent(fullPrompt);
            return result.response.text();
        }
        catch (error) {
            this.logger.error('Chat Gemini AI failed', error);
            return 'I am currently unable to process your request.';
        }
    }
    async assessPronunciation(targetText, audioBuffer) {
        try {
            if (!process.env.AZURE_SPEECH_KEY || !process.env.AZURE_SPEECH_REGION) {
                throw new Error('AZURE_SPEECH_KEY or AZURE_SPEECH_REGION is missing');
            }
            this.logger.log(`Evaluating pronunciation via Azure AI Speech for text: "${targetText}"`);
            const azureKey = process.env.AZURE_SPEECH_KEY;
            const azureRegion = process.env.AZURE_SPEECH_REGION;
            const endpoint = `https://${azureRegion}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed`;
            const pronAssessmentParams = {
                ReferenceText: targetText,
                GradingSystem: 'HundredMark',
                Granularity: 'Phoneme',
                Dimension: 'Comprehensive',
            };
            const pronAssessmentHeader = Buffer.from(JSON.stringify(pronAssessmentParams)).toString('base64');
            const azureResponse = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Ocp-Apim-Subscription-Key': azureKey,
                    'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
                    'Accept': 'application/json',
                    'Pronunciation-Assessment': pronAssessmentHeader,
                },
                body: new Uint8Array(audioBuffer),
            });
            if (!azureResponse.ok) {
                const errText = await azureResponse.text();
                this.logger.error(`Azure API Error: ${azureResponse.status} - ${errText}`);
                throw new Error(`Azure API error: ${azureResponse.status}`);
            }
            const azureData = await azureResponse.json();
            this.logger.log(`Azure response: ${JSON.stringify(azureData).substring(0, 200)}...`);
            if (azureData.RecognitionStatus !== 'Success') {
                throw new Error(`Azure recognition failed: ${azureData.RecognitionStatus} - Có thể bạn chưa nói gì, hoặc âm thanh quá ồn.`);
            }
            if (!azureData.NBest || azureData.NBest.length === 0) {
                throw new Error('Azure returned Success but NBest array is empty (no transcription).');
            }
            const bestResult = azureData.NBest[0];
            const pronScores = bestResult.PronunciationAssessment || bestResult;
            if (pronScores.PronScore === undefined) {
                this.logger.error(`Missing PronunciationScore. bestResult object: ${JSON.stringify(bestResult)}`);
                throw new Error('PronunciationScore data is missing in Azure response.');
            }
            const overallScore = pronScores.PronScore / 10;
            const problematicWords = [];
            let transcript = '';
            if (bestResult.Words) {
                for (const wordObj of bestResult.Words) {
                    transcript += wordObj.Word + ' ';
                    const wScore = wordObj.PronunciationAssessment || wordObj;
                    if (wScore.ErrorType !== 'None' || (wScore.AccuracyScore !== undefined && wScore.AccuracyScore < 80)) {
                        problematicWords.push(wordObj.Word);
                    }
                }
            }
            if (!process.env.GEMINI_API_KEY) {
                return {
                    overallScore,
                    clarity: overallScore >= 8 ? 'Excellent' : overallScore >= 6 ? 'Good' : 'Fair',
                    feedback: `[No Gemini Key] Azure Score: ${overallScore}/10. Accuracy: ${pronScores.AccuracyScore}, Fluency: ${pronScores.FluencyScore}.`,
                    problematicWords,
                    suggestions: [],
                };
            }
            const model = this.genAI.getGenerativeModel({ model: 'gemini-3.5-flash' });
            const prompt = `Học viên vừa đọc câu: "${targetText}"
Hệ thống AI (Azure) đã chấm điểm phát âm với kết quả sau:
- Điểm tổng (0-100): ${pronScores.PronScore}
- Điểm chính xác (Accuracy): ${pronScores.AccuracyScore}
- Điểm trôi chảy (Fluency): ${pronScores.FluencyScore}
- Điểm hoàn thiện (Completeness): ${pronScores.CompletenessScore}
- Các từ phát âm sai hoặc kém: ${problematicWords.join(', ') || 'Không có'}
- Những gì học viên thực sự đã nói: "${transcript.trim()}"

Hãy đóng vai một giáo viên tiếng Anh tận tâm. Đưa ra một JSON có cấu trúc như sau (KHÔNG dùng markdown):
{
  "clarity": "<Excellent | Good | Fair | Poor>",
  "feedback": "<2-3 câu nhận xét tổng quan bằng tiếng Việt, dựa vào điểm số và các lỗi trên, giọng điệu khích lệ>",
  "suggestions": [
    "<Lời khuyên 1 bằng tiếng Việt>",
    "<Lời khuyên 2 bằng tiếng Việt>"
  ]
}
Chỉ trả về JSON, không thêm bất kỳ văn bản nào khác.`;
            const geminiResult = await model.generateContent(prompt);
            const rawText = geminiResult.response.text().trim();
            const jsonMatch = rawText.match(/\{[\s\S]*\}/);
            let clarity = 'Fair', feedback = '', suggestions = [];
            if (jsonMatch) {
                try {
                    const parsed = JSON.parse(jsonMatch[0]);
                    clarity = parsed.clarity || clarity;
                    feedback = parsed.feedback || '';
                    suggestions = parsed.suggestions || [];
                }
                catch (e) { }
            }
            return {
                overallScore: Number(overallScore.toFixed(1)),
                clarity,
                feedback: feedback || `Phát âm của bạn đạt ${overallScore}/10 điểm.`,
                problematicWords,
                suggestions,
            };
        }
        catch (error) {
            this.logger.error(`Azure/Gemini pronunciation assessment failed: ${error.message}`, error.stack);
            return {
                overallScore: 0,
                clarity: 'Poor',
                feedback: 'Hệ thống đánh giá phát âm đang gặp sự cố. Vui lòng thử lại sau.',
                problematicWords: [],
                suggestions: ['Vui lòng kiểm tra lại micro và kết nối mạng.'],
            };
        }
    }
    async explainToeicError(questionContent, userAnswer, correctAnswer) {
        if (!process.env.GEMINI_API_KEY) {
            return 'Chức năng giải thích đang bảo trì. Vui lòng thử lại sau.';
        }
        try {
            const model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
            const prompt = `
        Bạn là một gia sư TOEIC chuyên nghiệp và tận tâm.
        Hãy giải thích câu hỏi TOEIC sau đây bằng tiếng Việt một cách dễ hiểu, ngắn gọn nhưng đầy đủ ngữ pháp/từ vựng cần thiết.
        Nội dung câu hỏi: ${JSON.stringify(questionContent)}
        Học viên đã chọn: ${userAnswer}
        Đáp án đúng là: ${correctAnswer}
        
        Hãy chỉ ra:
        1. Tại sao đáp án của học viên sai?
        2. Tại sao đáp án đúng lại hợp lý (giải thích ngữ pháp/ngữ nghĩa)?
        3. Dịch nghĩa câu hỏi sang tiếng Việt.
      `;
            const result = await model.generateContent(prompt);
            const response = await result.response;
            return response.text();
        }
        catch (error) {
            this.logger.error(`Error explaining TOEIC error: ${error.message}`, error.stack);
            return 'Xin lỗi, tôi không thể giải thích câu hỏi này lúc này.';
        }
    }
    async generateToeicQuestions(topic, part, count) {
        if (!process.env.GEMINI_API_KEY) {
            throw new Error('Thiếu GEMINI_API_KEY');
        }
        try {
            const model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
            const prompt = `
        Bạn là một chuyên gia ra đề thi TOEIC. Hãy tạo ra ${count} câu hỏi trắc nghiệm thuộc TOEIC Part ${part}.
        Chủ đề từ vựng/ngữ cảnh: ${topic}.
        
        Yêu cầu Format trả về bắt buộc phải là 1 mảng JSON. Không trả về bất kỳ text nào khác ngoài mảng JSON.
        Cấu trúc mỗi object trong mảng:
        {
          "text": "Câu hỏi với chỗ trống ___.",
          "options": ["A", "B", "C", "D"],
          "correctAnswer": "A",
          "explanation": "Giải thích ngắn gọn tại sao A đúng"
        }
      `;
            const result = await model.generateContent(prompt);
            const response = await result.response;
            let text = response.text().trim();
            if (text.startsWith('\`\`\`json')) {
                text = text.substring(7, text.length - 3).trim();
            }
            else if (text.startsWith('\`\`\`')) {
                text = text.substring(3, text.length - 3).trim();
            }
            return JSON.parse(text);
        }
        catch (error) {
            this.logger.error(`Error generating TOEIC questions: ${error.message}`, error.stack);
            throw new Error('Lỗi khi sinh câu hỏi TOEIC');
        }
    }
};
exports.GeminiEvaluatorStrategy = GeminiEvaluatorStrategy;
exports.GeminiEvaluatorStrategy = GeminiEvaluatorStrategy = GeminiEvaluatorStrategy_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], GeminiEvaluatorStrategy);
//# sourceMappingURL=gemini-evaluator.strategy.js.map