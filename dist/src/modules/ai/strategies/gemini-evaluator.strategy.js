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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var GeminiEvaluatorStrategy_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeminiEvaluatorStrategy = void 0;
const common_1 = require("@nestjs/common");
const ioredis_1 = require("@nestjs-modules/ioredis");
const ioredis_2 = __importDefault(require("ioredis"));
const crypto_1 = require("crypto");
const generative_ai_1 = require("@google/generative-ai");
let GeminiEvaluatorStrategy = GeminiEvaluatorStrategy_1 = class GeminiEvaluatorStrategy {
    redis;
    logger = new common_1.Logger(GeminiEvaluatorStrategy_1.name);
    apiKeys = [];
    currentKeyIndex = 0;
    constructor(redis) {
        this.redis = redis;
        const keysStr = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '';
        this.apiKeys = keysStr
            .split(',')
            .map((k) => k.trim())
            .filter((k) => k.length > 0);
    }
    hasKeys() {
        return this.apiKeys.length > 0;
    }
    getModelName() {
        return process.env.GEMINI_MODEL_NAME || 'gemini-3.1-flash-lite';
    }
    getCacheKey(prefix, ...args) {
        const raw = args
            .map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a ?? '')))
            .join('::');
        const hash = (0, crypto_1.createHash)('md5').update(raw).digest('hex');
        return `gemini:${prefix}:${hash}`;
    }
    async getCachedOrGenerate(cacheKey, ttlSeconds, generator) {
        if (this.redis) {
            try {
                const cached = await this.redis.get(cacheKey);
                if (cached) {
                    this.logger.log(`[Cache HIT] key: ${cacheKey}`);
                    return JSON.parse(cached);
                }
            }
            catch (err) {
                this.logger.warn(`Redis get failed for key ${cacheKey}: ${err}`);
            }
        }
        const result = await generator();
        if (this.redis && result !== undefined && result !== null) {
            try {
                await this.redis.set(cacheKey, JSON.stringify(result), 'EX', ttlSeconds);
                this.logger.log(`[Cache SET] key: ${cacheKey} (TTL: ${ttlSeconds}s)`);
            }
            catch (err) {
                this.logger.warn(`Redis set failed for key ${cacheKey}: ${err}`);
            }
        }
        return result;
    }
    async sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    async executeWithRotation(operation) {
        if (!this.hasKeys()) {
            throw new Error('Thiếu GEMINI_API_KEYS');
        }
        const modelName = this.getModelName();
        let attempts = 0;
        const maxAttempts = Math.max(this.apiKeys.length * 3, 3);
        const retryDelays = [2000, 4000, 8000];
        while (attempts < maxAttempts) {
            const currentKey = this.apiKeys[this.currentKeyIndex];
            const genAI = new generative_ai_1.GoogleGenerativeAI(currentKey);
            const model = genAI.getGenerativeModel({ model: modelName });
            try {
                return await operation(model);
            }
            catch (e) {
                const errMsg = String(e?.message || '');
                const isRateLimit = e?.status === 429 ||
                    errMsg.includes('429') ||
                    errMsg.includes('Too Many Requests') ||
                    errMsg.includes('Quota') ||
                    errMsg.includes('RESOURCE_EXHAUSTED');
                if (isRateLimit) {
                    const delay = retryDelays[Math.min(attempts, retryDelays.length - 1)];
                    this.logger.warn(`Gemini API Key index ${this.currentKeyIndex} hit rate limit (429). Rotating key and waiting ${delay}ms before retry ${attempts + 1}/${maxAttempts}...`);
                    this.currentKeyIndex =
                        (this.currentKeyIndex + 1) % this.apiKeys.length;
                    attempts++;
                    await this.sleep(delay);
                }
                else {
                    throw e;
                }
            }
        }
        throw new Error('Tất cả Gemini API keys đều đã hết hạn mức (429 Too Many Requests). Vui lòng thử lại sau.');
    }
    async generateFeedback(question, studentAnswer) {
        const cacheKey = this.getCacheKey('feedback', question, studentAnswer);
        return this.getCachedOrGenerate(cacheKey, 86400, async () => {
            try {
                if (!this.hasKeys()) {
                    this.logger.warn('GEMINI_API_KEY is not set. Returning mock feedback.');
                    return `[Mock Gemini Feedback] Nhận xét cho câu trả lời của em: "${studentAnswer}".`;
                }
                const prompt = `Bạn là một giáo viên tiếng Anh tận tâm, vui vẻ và ân cần đang chấm bài viết cho học sinh/trẻ em trên nền tảng BreadTrans Junior.
Đề bài: "${question}"
Bài làm của học sinh: "${studentAnswer}"

Hãy đưa ra nhận xét chi tiết HOÀN TOÀN BẰNG TIẾNG VIỆT với giọng điệu động viên, khen ngợi và hướng dẫn tận tình theo cấu trúc sau:
1. 🌟 Khen ngợi và nhận xét tổng quan bài làm
2. ✏️ Sửa lỗi ngữ pháp & từ vựng (chỉ rõ từ/câu cần sửa, viết lại câu hoàn chỉnh và giải thích ngắn gọn, dễ hiểu)
3. 💡 Gợi ý mẹo nhỏ để em viết hay và tự nhiên hơn
4. 🏆 Đánh giá mức độ hoàn thành`;
                const result = await this.executeWithRotation((m) => m.generateContent(prompt));
                const response = result.response;
                return response.text();
            }
            catch (error) {
                this.logger.error('Failed to generate Gemini AI feedback', error);
                return 'Thầy/Cô chưa thể tạo nhận xét lúc này. Em hãy thử lại sau ít phút nhé!';
            }
        });
    }
    async chat(prompt) {
        try {
            if (!this.hasKeys()) {
                return `[Mock Gemini Chat] Bánh Mì Gia Sư đã nhận tin nhắn của em: "${prompt}".`;
            }
            const fullPrompt = `Bạn là "Bánh Mì Gia Sư" (AI Tutor) - Trợ lý gia sư tiếng Anh thông minh, vui vẻ, tận tâm và thân thiện dành riêng cho trẻ em và học sinh trên nền tảng học tiếng Anh BreadTrans Junior.

NHIỆM VỤ & PHONG CÁCH GIAO TIẾP:
- Giọng văn: Luôn ấm áp, vui tươi, khích lệ, dùng nhiều icon/emoji sinh động (🍞, ✨, 🌟, 🎒, 👏, 🎉) phù hợp với lứa tuổi thiếu nhi và học sinh.
- Ngôn ngữ trả lời: BẮT BUỘC trả lời chủ yếu bằng TIẾNG VIỆT tự nhiên, dễ hiểu, trong sáng.
- Khi học sinh hỏi về từ vựng, câu hoặc ngữ pháp tiếng Anh:
  + Cung cấp từ/câu tiếng Anh chính xác kèm phiên âm dễ đọc và dịch nghĩa tiếng Việt chi tiết.
  + Đưa ra ví dụ vui nhộn, gần gũi với đời sống học đường và tuổi thơ.
- Khi học sinh chào hỏi (như "ha lô", "chào bạn", "hello", "hi"): Chào đón các em thật nhiệt tình bằng tiếng Việt, khen ngợi tinh thần học tập và hỏi xem em cần giúp đỡ bài học nào hôm nay.
- Trình bày câu trả lời rõ ràng, có định dạng markdown đẹp mắt (in đậm, danh sách gạch đầu dòng), không quá dài dòng gây khó hiểu cho trẻ em.

Nội dung câu hỏi của học sinh:
"${prompt}"`;
            const result = await this.executeWithRotation((m) => m.generateContent(fullPrompt));
            return result.response.text();
        }
        catch (error) {
            this.logger.error('Chat Gemini AI failed', error);
            return 'Bánh Mì Gia Sư đang gặp chút trục trặc nhỏ. Em chờ một lát rồi hỏi lại nhé! 🍞';
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
                EnableMiscue: true,
            };
            const pronAssessmentHeader = Buffer.from(JSON.stringify(pronAssessmentParams)).toString('base64');
            let contentType = 'audio/wav; codecs=audio/pcm; samplerate=16000';
            if (audioBuffer.length >= 4 &&
                audioBuffer[0] === 0x1a &&
                audioBuffer[1] === 0x45 &&
                audioBuffer[2] === 0xdf &&
                audioBuffer[3] === 0xa3) {
                contentType = 'audio/webm; codecs=opus';
            }
            else if (audioBuffer.length >= 4 &&
                audioBuffer.toString('ascii', 0, 4) === 'OggS') {
                contentType = 'audio/ogg; codecs=opus';
            }
            else if (audioBuffer.length >= 4 &&
                audioBuffer.toString('ascii', 0, 4) === 'RIFF') {
                contentType = 'audio/wav; codecs=audio/pcm; samplerate=16000';
            }
            const azureResponse = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Ocp-Apim-Subscription-Key': azureKey,
                    'Content-Type': contentType,
                    Accept: 'application/json',
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
            const targetWordsList = targetText
                .split(/\s+/)
                .filter((w) => w.trim().length > 0);
            const nonSuccessStatuses = [
                'InitialSilenceTimeout',
                'BabbleTimeout',
                'Error',
            ];
            if (nonSuccessStatuses.includes(azureData.RecognitionStatus) ||
                !azureData.NBest ||
                azureData.NBest.length === 0) {
                this.logger.warn(`No speech or silence detected by Azure STT: ${azureData.RecognitionStatus}`);
                const allUnspokenWords = targetWordsList.map((w) => ({
                    word: w,
                    accuracyScore: 0,
                    errorType: 'Omission',
                    isCorrect: false,
                }));
                return {
                    overallScore: 0,
                    clarity: 'Poor',
                    feedback: 'Không phát hiện thấy giọng nói trong bản ghi âm. Vui lòng kiểm tra micro và đọc to, rõ ràng theo đoạn văn mẫu nhé!',
                    problematicWords: targetWordsList,
                    suggestions: [
                        'Hãy đảm bảo micro của bạn hoạt động tốt và không bị tắt tiếng (mute).',
                        'Đọc to, rõ ràng từng từ theo câu mẫu trên màn hình.',
                    ],
                    fluencyScore: 0,
                    accuracyScore: 0,
                    completenessScore: 0,
                    words: allUnspokenWords,
                    isSilentOrNoSpeech: true,
                };
            }
            const bestResult = azureData.NBest[0];
            const pronScores = bestResult.PronunciationAssessment || bestResult;
            const accuracyScore = pronScores.AccuracyScore ?? bestResult.AccuracyScore ?? 0;
            const fluencyScore = pronScores.FluencyScore ?? bestResult.FluencyScore ?? 0;
            const completenessScore = pronScores.CompletenessScore ?? bestResult.CompletenessScore ?? 0;
            const rawPronScore = pronScores.PronScore ?? bestResult.PronScore ?? 0;
            const spokenWords = (bestResult.Words || []).filter((w) => (w.Duration ?? 0) > 0 ||
                (w.ErrorType ?? w.PronunciationAssessment?.ErrorType) !== 'Omission' ||
                (w.AccuracyScore ?? w.PronunciationAssessment?.AccuracyScore ?? 0) > 0);
            if (!bestResult.Words || bestResult.Words.length === 0 || spokenWords.length === 0) {
                this.logger.warn('No spoken words recognized in recording.');
                const allUnspokenWords = targetWordsList.map((w) => ({
                    word: w,
                    accuracyScore: 0,
                    errorType: 'Omission',
                    isCorrect: false,
                }));
                return {
                    overallScore: 0,
                    clarity: 'Poor',
                    feedback: 'Không nghe rõ giọng đọc của bạn. Hãy thử đọc lại với âm lượng to và rõ ràng hơn nhé!',
                    problematicWords: targetWordsList,
                    suggestions: [
                        'Nói gần micro hơn để thu âm rõ nét nhất.',
                        'Luyện tập phát âm từng từ trước khi ghi âm hoàn chỉnh.',
                    ],
                    fluencyScore: 0,
                    accuracyScore: 0,
                    completenessScore: 0,
                    words: allUnspokenWords,
                    isSilentOrNoSpeech: true,
                };
            }
            const words = [];
            const problematicWords = [];
            let transcript = '';
            const usedAzureIndices = new Set();
            for (let wIdx = 0; wIdx < targetWordsList.length; wIdx++) {
                const targetWord = targetWordsList[wIdx];
                const cleanTarget = targetWord
                    .toLowerCase()
                    .replace(/[^a-z0-9]/g, '');
                let matchedIndex = -1;
                if (wIdx < bestResult.Words.length && !usedAzureIndices.has(wIdx)) {
                    const directAz = bestResult.Words[wIdx];
                    const cleanDirect = (directAz.Word || '')
                        .toLowerCase()
                        .replace(/[^a-z0-9]/g, '');
                    if (cleanDirect === cleanTarget) {
                        matchedIndex = wIdx;
                    }
                }
                if (matchedIndex === -1) {
                    for (let i = 0; i < bestResult.Words.length; i++) {
                        if (usedAzureIndices.has(i))
                            continue;
                        const azWord = bestResult.Words[i];
                        const cleanAz = (azWord.Word || '')
                            .toLowerCase()
                            .replace(/[^a-z0-9]/g, '');
                        if (cleanAz === cleanTarget) {
                            matchedIndex = i;
                            break;
                        }
                    }
                }
                if (matchedIndex !== -1) {
                    usedAzureIndices.add(matchedIndex);
                    const azObj = bestResult.Words[matchedIndex];
                    const wScore = azObj.PronunciationAssessment || azObj;
                    const azAccuracy = wScore.AccuracyScore ?? azObj.AccuracyScore ?? 0;
                    const azError = wScore.ErrorType ?? azObj.ErrorType ?? 'None';
                    const azDuration = azObj.Duration ?? 0;
                    const isOmitted = azError === 'Omission' ||
                        (azDuration === 0 && azAccuracy === 0);
                    const isCorrect = !isOmitted &&
                        azError === 'None' &&
                        azAccuracy >= 60;
                    const finalErrorType = isCorrect
                        ? 'None'
                        : isOmitted
                            ? 'Omission'
                            : 'Mispronunciation';
                    words.push({
                        word: targetWord,
                        accuracyScore: isOmitted ? 0 : azAccuracy,
                        errorType: finalErrorType,
                        isCorrect,
                    });
                    if (!isCorrect) {
                        problematicWords.push(targetWord);
                    }
                }
                else {
                    words.push({
                        word: targetWord,
                        accuracyScore: 0,
                        errorType: 'Omission',
                        isCorrect: false,
                    });
                    problematicWords.push(targetWord);
                }
            }
            if (bestResult.Words) {
                transcript = bestResult.Words
                    .filter((w) => (w.Duration ?? 0) > 0)
                    .map((w) => w.Word)
                    .join(' ');
            }
            let overallScore = (rawPronScore / 100) * 10;
            if (completenessScore < 60) {
                overallScore = Math.min(overallScore, (completenessScore / 100) * 10);
            }
            if (problematicWords.length === targetWordsList.length) {
                overallScore = Math.min(overallScore, 1.0);
            }
            overallScore = Math.max(0, Math.min(10, overallScore));
            if (!this.hasKeys()) {
                return {
                    overallScore: Number(overallScore.toFixed(1)),
                    clarity: overallScore >= 8
                        ? 'Excellent'
                        : overallScore >= 6
                            ? 'Good'
                            : overallScore >= 4
                                ? 'Fair'
                                : 'Poor',
                    feedback: `[No Gemini Key] Azure Score: ${overallScore.toFixed(1)}/10. Accuracy: ${accuracyScore}, Fluency: ${fluencyScore}, Completeness: ${completenessScore}.`,
                    problematicWords,
                    suggestions: [],
                    fluencyScore,
                    accuracyScore,
                    completenessScore,
                    words,
                    isSilentOrNoSpeech: false,
                };
            }
            const prompt = `Học viên vừa đọc câu: "${targetText}"
Hệ thống AI (Azure) đã chấm điểm phát âm với kết quả sau:
- Điểm tổng (0-100): ${rawPronScore}
- Điểm chính xác (Accuracy): ${accuracyScore}
- Điểm trôi chảy (Fluency): ${fluencyScore}
- Điểm hoàn thiện (Completeness): ${completenessScore}%
- Các từ phát âm sai hoặc chưa đọc: ${problematicWords.join(', ') || 'Không có (đọc đúng tất cả)'}
- Những gì học viên thực sự đã nói: "${transcript.trim() || 'Không có âm thanh rõ ràng'}"

Hãy đóng vai một giáo viên tiếng Anh tận tâm cho thiếu nhi. Đưa ra một JSON có cấu trúc như sau (KHÔNG dùng markdown):
{
  "clarity": "<Excellent | Good | Fair | Poor>",
  "feedback": "<2-3 câu nhận xét tổng quan bằng tiếng Việt, dựa vào điểm số và các lỗi trên, giọng điệu khích lệ, ấm áp>",
  "suggestions": [
    "<Lời khuyên 1 bằng tiếng Việt ngắn gọn, dễ hiểu>",
    "<Lời khuyên 2 bằng tiếng Việt ngắn gọn, dễ hiểu>"
  ]
}
Chỉ trả về JSON, không thêm bất kỳ văn bản nào khác.`;
            let clarity = overallScore >= 8 ? 'Excellent' : overallScore >= 6 ? 'Good' : overallScore >= 4 ? 'Fair' : 'Poor';
            let feedback = '';
            let suggestions = [];
            try {
                const geminiResult = await this.executeWithRotation((m) => m.generateContent(prompt));
                const rawText = geminiResult.response.text().trim();
                const jsonMatch = rawText.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    clarity = parsed.clarity || clarity;
                    feedback = parsed.feedback || '';
                    suggestions = parsed.suggestions || [];
                }
            }
            catch (err) {
                this.logger.warn(`Gemini feedback generation failed: ${err.message}`);
            }
            return {
                overallScore: Number(overallScore.toFixed(1)),
                clarity,
                feedback: feedback ||
                    (overallScore >= 8
                        ? `Tuyệt vời! Bạn phát âm rất chuẩn đạt ${overallScore.toFixed(1)}/10 điểm.`
                        : `Phát âm của bạn đạt ${overallScore.toFixed(1)}/10 điểm. Hãy tiếp tục luyện tập nhé!`),
                problematicWords,
                suggestions: suggestions.length > 0 ? suggestions : [
                    'Nghe lại audio mẫu để bắt chước ngữ điệu chuẩn.',
                    'Luyện tập đọc chậm rãi từng từ trước khi đọc cả câu.'
                ],
                fluencyScore,
                accuracyScore,
                completenessScore,
                words,
                isSilentOrNoSpeech: false,
            };
        }
        catch (error) {
            this.logger.error(`Azure/Gemini pronunciation assessment failed: ${error.message}`, error.stack);
            const targetWordsList = targetText
                .split(/\s+/)
                .filter((w) => w.trim().length > 0);
            return {
                overallScore: 0,
                clarity: 'Poor',
                feedback: 'Không thể phân tích được phát âm (có thể do micro chưa thu được tiếng hoặc kết nối mạng). Vui lòng thử lại!',
                problematicWords: targetWordsList,
                suggestions: [
                    'Vui lòng kiểm tra lại micro và cấp quyền truy cập âm thanh trên trình duyệt.',
                    'Nói to và rõ ràng hơn khi ghi âm.',
                ],
                words: targetWordsList.map((w) => ({
                    word: w,
                    accuracyScore: 0,
                    errorType: 'Unspoken',
                    isCorrect: false,
                })),
                isSilentOrNoSpeech: true,
            };
        }
    }
    async explainToeicError(questionContent, userAnswer, correctAnswer) {
        if (!this.hasKeys()) {
            return 'Chức năng giải thích đang bảo trì. Vui lòng thử lại sau.';
        }
        const cacheKey = this.getCacheKey('toeic_explain', questionContent, userAnswer, correctAnswer);
        return this.getCachedOrGenerate(cacheKey, 86400, async () => {
            try {
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
                const result = await this.executeWithRotation((m) => m.generateContent(prompt));
                const response = result.response;
                return response.text();
            }
            catch (error) {
                this.logger.error(`Error explaining TOEIC error: ${error.message}`, error.stack);
                return 'Xin lỗi, tôi không thể giải thích câu hỏi này lúc này.';
            }
        });
    }
    async generateToeicQuestions(topic, part, count) {
        if (!this.hasKeys()) {
            throw new Error('Thiếu GEMINI_API_KEY');
        }
        try {
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
            const result = await this.executeWithRotation((m) => m.generateContent(prompt));
            const response = result.response;
            let text = response.text().trim();
            if (text.startsWith('```json')) {
                text = text.substring(7, text.length - 3).trim();
            }
            else if (text.startsWith('```')) {
                text = text.substring(3, text.length - 3).trim();
            }
            return JSON.parse(text);
        }
        catch (error) {
            this.logger.error(`Error generating TOEIC questions: ${error.message}`, error.stack);
            throw new Error('Lỗi khi sinh câu hỏi TOEIC');
        }
    }
    async generateDictation(topic, count) {
        if (!this.hasKeys()) {
            throw new Error('Thiếu GEMINI_API_KEY');
        }
        try {
            const prompt = `
        Bạn là một giáo viên tiếng Anh chuyên dạy luyện nghe chép chính tả (Dictation) TOEIC.
        Hãy tạo ${count} câu tiếng Anh thông dụng thuộc chủ đề "${topic}".
        Trả về kết quả dưới dạng một mảng JSON (không bọc trong markdown block). Mỗi phần tử là một object có cấu trúc:
        {
          "transcript": "<Câu tiếng Anh chuẩn xác, độ dài từ 7-15 từ>",
          "translation": "<Dịch nghĩa sang tiếng Việt>"
        }
        Chỉ trả về JSON hợp lệ, không thêm bất kỳ văn bản giải thích nào khác.
      `;
            const result = await this.executeWithRotation((m) => m.generateContent(prompt));
            const response = result.response;
            let text = response.text().trim();
            if (text.startsWith('```json')) {
                text = text.substring(7, text.length - 3).trim();
            }
            else if (text.startsWith('```')) {
                text = text.substring(3, text.length - 3).trim();
            }
            return JSON.parse(text);
        }
        catch (error) {
            this.logger.error(`Error generating dictation: ${error.message}`, error.stack);
            throw new Error('Lỗi khi sinh bài nghe chép chính tả');
        }
    }
    async importEtsPdf(pdfBuffer, pdfMimeType, audioBuffer, audioMimeType, audioUrl) {
        if (!this.hasKeys()) {
            throw new Error('Thiếu GEMINI_API_KEY');
        }
        try {
            let prompt = `
        Bạn là một chuyên gia nhận dạng tài liệu đề thi TOEIC.
        Tôi cung cấp cho bạn một file đề thi TOEIC (PDF/Image)
      `;
            if (audioBuffer) {
                prompt += ` và một file âm thanh đính kèm.`;
            }
            prompt += `
        Nhiệm vụ của bạn là bóc tách tất cả các câu hỏi trắc nghiệm thành một mảng JSON nguyên bản.
        Mỗi phần tử trong JSON phải có cấu trúc:
        {
          "type": "MULTIPLE_CHOICE",
          "content": {
             "text": "Nội dung câu hỏi (nếu có)",
             "options": ["A. Lựa chọn 1", "B. Lựa chọn 2", "C. Lựa chọn 3", "D. Lựa chọn 4"],
             "correctAnswer": "A",
             "explanation": ""`;
            if (audioBuffer) {
                prompt += `,
             "audioUrl": "${audioUrl || ''}",
             "audioTimestamp": "00:00 - 00:00"`;
            }
            prompt += `
          }
        }
        
        Lưu ý: 
        - Chỉ trả về duy nhất chuỗi JSON chứa mảng các câu hỏi, không thêm Markdown format hay text giải thích.
        - Nếu có bài đọc (Passage), hãy đưa đoạn văn bản bài đọc đó vào trường "passage" bên trong "content" của câu hỏi đầu tiên.`;
            if (audioBuffer) {
                prompt += `
        - VỚI PHẦN LISTENING (Part 1, 2, 3, 4): Hãy lắng nghe file âm thanh đính kèm để phân tách từng câu hỏi (hoặc cụm câu hỏi). Điền khoảng thời gian (Timestamp) bắt đầu và kết thúc của đoạn âm thanh liên quan vào trường "audioTimestamp" (VD: "01:20 - 01:50"). Hãy cố gắng dự đoán chính xác nhất có thể.`;
            }
            const contents = [
                {
                    inlineData: {
                        data: pdfBuffer.toString('base64'),
                        mimeType: pdfMimeType,
                    },
                },
            ];
            if (audioBuffer && audioMimeType) {
                contents.push({
                    inlineData: {
                        data: audioBuffer.toString('base64'),
                        mimeType: audioMimeType,
                    },
                });
            }
            contents.push(prompt);
            const result = await this.executeWithRotation((m) => m.generateContent(contents));
            const response = result.response;
            let text = response.text().trim();
            if (text.startsWith('```json')) {
                text = text.substring(7, text.length - 3).trim();
            }
            else if (text.startsWith('```')) {
                text = text.substring(3, text.length - 3).trim();
            }
            return JSON.parse(text);
        }
        catch (error) {
            this.logger.error(`Error parsing ETS PDF: ${error.message}`, error.stack);
            throw new Error('Lỗi khi phân tích đề thi ETS');
        }
    }
    async evaluateWritingPart1(imageUrl, keywords, userSentence) {
        if (!this.hasKeys()) {
            throw new Error('Thiếu GEMINI_API_KEY');
        }
        try {
            const prompt = `
        You are a TOEIC Writing evaluator. Evaluate the following user sentence for TOEIC Writing Part 1 (Write a sentence based on a picture).
        The user was given this picture and these two keywords: ${keywords.join(', ')}.
        User's sentence: "${userSentence}"
        
        Criteria:
        - Score 3: One sentence, uses both keywords appropriately, no grammar errors, relevant to the picture.
        - Score 2: One sentence, uses both keywords, but has minor grammar errors or is slightly irrelevant.
        - Score 1: Missing a keyword, or major grammar errors making it hard to understand.
        - Score 0: Blank, totally irrelevant, or not a sentence.

        Respond STRICTLY with a valid JSON object:
        {
          "score": 3,
          "feedback": "Your explanation here in Vietnamese"
        }
      `;
            const responseImg = await fetch(imageUrl);
            const arrayBuffer = await responseImg.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            const imagePart = {
                inlineData: {
                    data: buffer.toString('base64'),
                    mimeType: 'image/jpeg',
                },
            };
            const result = await this.executeWithRotation((m) => m.generateContent([prompt, imagePart]));
            const response = result.response;
            let text = response.text().trim();
            if (text.startsWith('```json')) {
                text = text.substring(7, text.length - 3).trim();
            }
            else if (text.startsWith('```')) {
                text = text.substring(3, text.length - 3).trim();
            }
            return JSON.parse(text);
        }
        catch (error) {
            this.logger.error(`Error evaluating writing part 1: ${error.message}`, error.stack);
            throw new Error('Lỗi khi chấm điểm Writing Part 1');
        }
    }
    async evaluateWritingPart2(emailPrompt, userResponse) {
        if (!this.hasKeys()) {
            return {
                score: 3,
                feedback: '[Mock Gemini] Email đáp ứng cơ bản các yêu cầu đề bài.',
                suggestions: [
                    'Nên dùng từ nối trang trọng hơn như "Furthermore", "However".',
                ],
            };
        }
        try {
            const prompt = `
        You are a certified ETS TOEIC Writing Evaluator. Evaluate this TOEIC Writing Part 2 response (Respond to an Email Request).
        Original Email Request: "${emailPrompt}"
        Student's Response Email: "${userResponse}"
        
        Scoring Criteria (0 to 4 points):
        - Score 4: Fully addresses all requests in the prompt, clear organization, professional tone, minimal grammar errors.
        - Score 3: Addresses all or most requests, clear tone, minor vocabulary/grammar issues.
        - Score 2: Partially addresses requests, inappropriate tone or multiple grammar mistakes.
        - Score 1: Fails to address main requests or major language errors.
        - Score 0: Blank or off-topic.

        Respond STRICTLY with a valid JSON object:
        {
          "score": 4,
          "feedback": "Phản hồi chi tiết bằng tiếng Việt...",
          "suggestions": ["Gợi ý 1", "Gợi ý 2"]
        }
      `;
            const result = await this.executeWithRotation((m) => m.generateContent(prompt));
            let text = result.response.text().trim();
            if (text.startsWith('```json'))
                text = text.substring(7, text.length - 3).trim();
            else if (text.startsWith('```'))
                text = text.substring(3, text.length - 3).trim();
            return JSON.parse(text);
        }
        catch (error) {
            this.logger.error(`Error evaluating writing part 2: ${error.message}`);
            return {
                score: 3,
                feedback: 'Đã hoàn thành bài viết email.',
                suggestions: ['Kiểm tra lại cấu trúc ngữ pháp và từ vựng.'],
            };
        }
    }
    async evaluateWritingPart3(essayTopic, userEssay) {
        if (!this.hasKeys()) {
            return {
                score: 4,
                feedback: '[Mock Gemini] Bài luận có lập luận rõ ràng, cấu trúc đủ 3 phần.',
                suggestions: ['Mở rộng thêm các ví dụ thực tế ở phần thân bài.'],
            };
        }
        try {
            const prompt = `
        You are an ETS TOEIC Writing Evaluator. Grade this TOEIC Writing Part 3 (Write an Opinion Essay).
        Essay Topic: "${essayTopic}"
        Student's Essay: "${userEssay}"

        Scoring Criteria (0 to 5 points):
        - Score 5: Well-organized (Introduction, Body, Conclusion), strong thesis, relevant examples, accurate complex sentences.
        - Score 4: Good organization and support, minor errors in word choice/grammar.
        - Score 3: Adequate support, some grammatical weaknesses or lack of transitions.
        - Score 2: Weak development, frequent grammar errors.
        - Score 1: Inadequate vocabulary, unorganized ideas.
        - Score 0: Off-topic or blank.

        Respond STRICTLY with a valid JSON object:
        {
          "score": 5,
          "feedback": "Phận xét chi tiết bài luận bằng tiếng Việt...",
          "suggestions": ["Khuyên 1", "Khuyên 2"]
        }
      `;
            const result = await this.executeWithRotation((m) => m.generateContent(prompt));
            let text = result.response.text().trim();
            if (text.startsWith('```json'))
                text = text.substring(7, text.length - 3).trim();
            else if (text.startsWith('```'))
                text = text.substring(3, text.length - 3).trim();
            return JSON.parse(text);
        }
        catch (error) {
            this.logger.error(`Error evaluating writing part 3: ${error.message}`);
            return {
                score: 4,
                feedback: 'Bài viết đạt yêu cầu cơ bản về độ dài và nội dung.',
                suggestions: ['Tăng cường sử dụng từ nối và cấu trúc phức.'],
            };
        }
    }
    async evaluateSpeakingPart3To5(promptText, studentResponse) {
        if (!this.hasKeys()) {
            return {
                score: 3,
                feedback: '[Mock Gemini] Trả lời đúng trọng tâm câu hỏi, phát âm khá tốt.',
                suggestions: ['Nói tự nhiên hơn và bổ sung chi tiết giải thích.'],
            };
        }
        try {
            const prompt = `
        You are a TOEIC Speaking Examiner. Grade this Speaking Part 3-5 response.
        Question / Situation: "${promptText}"
        Student's Spoken Text / Transcript: "${studentResponse}"

        Evaluation Criteria (Score 0-3 for Part 3-4, 0-5 for Part 5):
        - Pronunciation, Intonation, Stress
        - Relevance to the prompt and completeness of ideas
        - Grammar and Vocabulary appropriateness

        Respond STRICTLY with a valid JSON object:
        {
          "score": 3,
          "feedback": "Nhận xét chi tiết về phát âm, nội dung, ngữ pháp bằng tiếng Việt...",
          "suggestions": ["Gợi ý phát âm/từ vựng 1", "Gợi ý 2"]
        }
      `;
            const result = await this.executeWithRotation((m) => m.generateContent(prompt));
            let text = result.response.text().trim();
            if (text.startsWith('```json'))
                text = text.substring(7, text.length - 3).trim();
            else if (text.startsWith('```'))
                text = text.substring(3, text.length - 3).trim();
            return JSON.parse(text);
        }
        catch (error) {
            this.logger.error(`Error evaluating speaking part 3-5: ${error.message}`);
            return {
                score: 3,
                feedback: 'Bài phát âm trôi chảy, đúng trọng tâm.',
                suggestions: ['Chú ý nhấn trọng âm câu tốt hơn.'],
            };
        }
    }
    async generateSmartContentFromDocument(documentText, options) {
        const quizCount = Math.min(Math.max(options?.quizCount || 5, 1), 20);
        const flashcardCount = Math.min(Math.max(options?.flashcardCount || 8, 1), 25);
        const schema = {
            type: generative_ai_1.SchemaType.OBJECT,
            properties: {
                documentSummary: { type: generative_ai_1.SchemaType.STRING },
                quizQuestions: {
                    type: generative_ai_1.SchemaType.ARRAY,
                    items: {
                        type: generative_ai_1.SchemaType.OBJECT,
                        properties: {
                            question: { type: generative_ai_1.SchemaType.STRING },
                            options: {
                                type: generative_ai_1.SchemaType.ARRAY,
                                items: { type: generative_ai_1.SchemaType.STRING },
                            },
                            correctIndex: { type: generative_ai_1.SchemaType.INTEGER },
                            explanation: { type: generative_ai_1.SchemaType.STRING },
                            difficulty: { type: generative_ai_1.SchemaType.STRING },
                        },
                        required: ['question', 'options', 'correctIndex', 'explanation'],
                    },
                },
                flashcards: {
                    type: generative_ai_1.SchemaType.ARRAY,
                    items: {
                        type: generative_ai_1.SchemaType.OBJECT,
                        properties: {
                            term: { type: generative_ai_1.SchemaType.STRING },
                            pos: { type: generative_ai_1.SchemaType.STRING },
                            ipa: { type: generative_ai_1.SchemaType.STRING },
                            meaning: { type: generative_ai_1.SchemaType.STRING },
                            example: { type: generative_ai_1.SchemaType.STRING },
                        },
                        required: ['term', 'meaning', 'example'],
                    },
                },
                assignment: {
                    type: generative_ai_1.SchemaType.OBJECT,
                    properties: {
                        title: { type: generative_ai_1.SchemaType.STRING },
                        description: { type: generative_ai_1.SchemaType.STRING },
                        instructions: { type: generative_ai_1.SchemaType.STRING },
                        estimatedTimeMinutes: { type: generative_ai_1.SchemaType.INTEGER },
                    },
                    required: ['title', 'description', 'instructions'],
                },
            },
            required: ['quizQuestions', 'flashcards', 'assignment'],
        };
        const prompt = `
You are an expert English language educator and curriculum developer for BreadTrans.
Analyze the following educational document / lesson text and generate a comprehensive learning kit:

1. Exactly ${quizCount} multiple-choice quiz questions (TOEIC / English comprehension format). Each question MUST have exactly 4 distinct options, the zero-based index of the correct answer (correctIndex: 0, 1, 2, or 3), and a clear, helpful Vietnamese explanation of why that answer is correct.
2. Exactly ${flashcardCount} key vocabulary flashcards extracted from the text. Include the term, part of speech (pos: noun, verb, adjective, adverb), American IPA pronunciation (ipa), clear Vietnamese meaning, and an example sentence from or related to the text.
3. One practical homework assignment (essay or written task) for students based on the document's core theme, with step-by-step instructions.

DOCUMENT CONTENT:
---
${documentText.slice(0, 15000)}
---
`;
        const result = await this.executeWithRotation((m) => m.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: 'application/json',
                responseSchema: schema,
                temperature: 0.3,
            },
        }));
        const rawText = result.response.text();
        return JSON.parse(rawText);
    }
};
exports.GeminiEvaluatorStrategy = GeminiEvaluatorStrategy;
exports.GeminiEvaluatorStrategy = GeminiEvaluatorStrategy = GeminiEvaluatorStrategy_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Optional)()),
    __param(0, (0, ioredis_1.InjectRedis)()),
    __metadata("design:paramtypes", [ioredis_2.default])
], GeminiEvaluatorStrategy);
//# sourceMappingURL=gemini-evaluator.strategy.js.map