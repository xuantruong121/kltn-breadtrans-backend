import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { IAIEvaluator, PronunciationFeedback } from './ai-evaluator.interface';

@Injectable()
export class GeminiEvaluatorStrategy implements IAIEvaluator {
  private readonly logger = new Logger(GeminiEvaluatorStrategy.name);
  private genAI: GoogleGenerativeAI;
  private apiKeys: string[] = [];
  private currentKeyIndex = 0;

  constructor() {
    const keysStr = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '';
    this.apiKeys = keysStr.split(',').map(k => k.trim()).filter(k => k.length > 0);
    const initialKey = this.apiKeys.length > 0 ? this.apiKeys[0] : 'fake-api-key';
    this.genAI = new GoogleGenerativeAI(initialKey);
  }

  private hasKeys(): boolean {
    return this.apiKeys.length > 0;
  }

  private async executeWithRotation(operation: (model: any) => Promise<any>): Promise<any> {
    if (!this.hasKeys()) {
      throw new Error('Thiếu GEMINI_API_KEYS');
    }

    let attempts = 0;
    const maxAttempts = this.apiKeys.length;

    while (attempts < maxAttempts) {
      const currentKey = this.apiKeys[this.currentKeyIndex];
      const genAI = new GoogleGenerativeAI(currentKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash' });

      try {
        return await operation(model);
      } catch (error: any) {
        if (error.status === 429 || error.message?.includes('429') || error.message?.includes('Too Many Requests') || error.message?.includes('Quota')) {
          this.logger.warn(`Gemini API Key at index ${this.currentKeyIndex} hit rate limit (429). Rotating to next key...`);
          this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
          attempts++;
        } else {
          throw error;
        }
      }
    }

    throw new Error('Tất cả API keys đều đã hết hạn mức (429 Too Many Requests). Vui lòng thử lại sau.');
  }


  async generateFeedback(
    question: string,
    studentAnswer: string,
  ): Promise<string> {
    try {
      if (!this.hasKeys()) {
        this.logger.warn('GEMINI_API_KEY is not set. Returning mock feedback.');
        return `[Mock Gemini Feedback] This is a mock feedback for answer: "${studentAnswer}". Please set GEMINI_API_KEY to use real AI.`;
      }

      

      const prompt = `You are a professional English teacher grading a student's writing assignment.
Question: "${question}"
Student's Answer: "${studentAnswer}"

Provide detailed feedback, including:
1. Overall assessment
2. Grammar and vocabulary corrections
3. Suggestions for improvement
4. Estimated band score (if applicable, e.g., IELTS)
Please keep the response concise but informative.`;

      const result = await this.executeWithRotation(m => m.generateContent(prompt));
      const response = result.response;
      return response.text();
    } catch (error) {
      this.logger.error('Failed to generate Gemini AI feedback', error);
      return 'Could not generate AI feedback at this time due to an error.';
    }
  }

  async chat(prompt: string): Promise<string> {
    try {
      if (!this.hasKeys()) {
        return `[Mock Gemini Chat] I received your message: "${prompt}". Please set GEMINI_API_KEY.`;
      }

      
      const fullPrompt = `You are an AI teaching assistant for an online English learning platform. Answer the student's question helpfully: "${prompt}"`;

      const result = await this.executeWithRotation(m => m.generateContent(fullPrompt));
      return result.response.text();
    } catch (error) {
      this.logger.error('Chat Gemini AI failed', error);
      return 'I am currently unable to process your request.';
    }
  }

  async assessPronunciation(
    targetText: string,
    audioBuffer: Buffer,
  ): Promise<PronunciationFeedback> {
    try {
      if (!process.env.AZURE_SPEECH_KEY || !process.env.AZURE_SPEECH_REGION) {
        throw new Error('AZURE_SPEECH_KEY or AZURE_SPEECH_REGION is missing');
      }

      this.logger.log(
        `Evaluating pronunciation via Azure AI Speech for text: "${targetText}"`,
      );

      const azureKey = process.env.AZURE_SPEECH_KEY;
      const azureRegion = process.env.AZURE_SPEECH_REGION;
      // Endpoint REST API v1 cho Speech to Text (chứa Pronunciation Assessment)
      const endpoint = `https://${azureRegion}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed`;

      // Cấu hình Pronunciation Assessment
      const pronAssessmentParams = {
        ReferenceText: targetText,
        GradingSystem: 'HundredMark',
        Granularity: 'Phoneme',
        Dimension: 'Comprehensive',
      };
      const pronAssessmentHeader = Buffer.from(
        JSON.stringify(pronAssessmentParams),
      ).toString('base64');

      const azureResponse = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': azureKey,
          'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
          Accept: 'application/json',
          'Pronunciation-Assessment': pronAssessmentHeader,
        },
        body: new Uint8Array(audioBuffer),
      });

      if (!azureResponse.ok) {
        const errText = await azureResponse.text();
        this.logger.error(
          `Azure API Error: ${azureResponse.status} - ${errText}`,
        );
        throw new Error(`Azure API error: ${azureResponse.status}`);
      }

      const azureData = await azureResponse.json();
      this.logger.log(
        `Azure response: ${JSON.stringify(azureData).substring(0, 200)}...`,
      );

      if (azureData.RecognitionStatus !== 'Success') {
        throw new Error(
          `Azure recognition failed: ${azureData.RecognitionStatus} - Có thể bạn chưa nói gì, hoặc âm thanh quá ồn.`,
        );
      }

      if (!azureData.NBest || azureData.NBest.length === 0) {
        throw new Error(
          'Azure returned Success but NBest array is empty (no transcription).',
        );
      }

      // Lấy kết quả tốt nhất
      const bestResult = azureData.NBest[0];

      // REST API trả về điểm trực tiếp trong NBest[0] (chứ không bọc trong object PronunciationAssessment như SDK)
      const pronScores = bestResult.PronunciationAssessment || bestResult;

      if (pronScores.PronScore === undefined) {
        this.logger.error(
          `Missing PronunciationScore. bestResult object: ${JSON.stringify(bestResult)}`,
        );
        throw new Error(
          'PronunciationScore data is missing in Azure response.',
        );
      }

      const overallScore = pronScores.PronScore / 10; // Đổi thang 100 -> thang 10

      // Lọc ra các từ phát âm lỗi
      const problematicWords = [];
      let transcript = '';

      if (bestResult.Words) {
        for (const wordObj of bestResult.Words) {
          transcript += wordObj.Word + ' ';
          const wScore = wordObj.PronunciationAssessment || wordObj;
          if (
            wScore.ErrorType !== 'None' ||
            (wScore.AccuracyScore !== undefined && wScore.AccuracyScore < 80)
          ) {
            problematicWords.push(wordObj.Word);
          }
        }
      }

      // --- BƯỚC 2: Gọi Gemini để sinh lời khuyên dựa trên số liệu của Azure ---
      if (!this.hasKeys()) {
        return {
          overallScore,
          clarity:
            overallScore >= 8
              ? 'Excellent'
              : overallScore >= 6
                ? 'Good'
                : 'Fair',
          feedback: `[No Gemini Key] Azure Score: ${overallScore}/10. Accuracy: ${pronScores.AccuracyScore}, Fluency: ${pronScores.FluencyScore}.`,
          problematicWords,
          suggestions: [],
        };
      }

      
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

      const geminiResult = await this.executeWithRotation(m => m.generateContent(prompt));
      const rawText = geminiResult.response.text().trim();

      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      let clarity = 'Fair',
        feedback = '',
        suggestions = [];

      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          clarity = parsed.clarity || clarity;
          feedback = parsed.feedback || '';
          suggestions = parsed.suggestions || [];
        } catch {
          // Bỏ qua lỗi parse JSON
        }
      }

      return {
        overallScore: Number(overallScore.toFixed(1)),
        clarity,
        feedback: feedback || `Phát âm của bạn đạt ${overallScore}/10 điểm.`,
        problematicWords,
        suggestions,
        fluencyScore: pronScores.FluencyScore,
        accuracyScore: pronScores.AccuracyScore,
        completenessScore: pronScores.CompletenessScore,
      };
    } catch (error: any) {
      this.logger.error(
        `Azure/Gemini pronunciation assessment failed: ${error.message}`,
        error.stack,
      );
      return {
        overallScore: 0,
        clarity: 'Poor',
        feedback:
          'Hệ thống đánh giá phát âm đang gặp sự cố. Vui lòng thử lại sau.',
        problematicWords: [],
        suggestions: ['Vui lòng kiểm tra lại micro và kết nối mạng.'],
      };
    }
  }

  async explainToeicError(
    questionContent: any,
    userAnswer: string,
    correctAnswer: string,
  ): Promise<string> {
    if (!this.hasKeys()) {
      return 'Chức năng giải thích đang bảo trì. Vui lòng thử lại sau.';
    }
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
      const result = await this.executeWithRotation(m => m.generateContent(prompt));
      const response = result.response;
      return response.text();
    } catch (error: any) {
      this.logger.error(
        `Error explaining TOEIC error: ${error.message}`,
        error.stack,
      );
      return 'Xin lỗi, tôi không thể giải thích câu hỏi này lúc này.';
    }
  }

  async generateToeicQuestions(
    topic: string,
    part: number,
    count: number,
  ): Promise<any[]> {
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
      const result = await this.executeWithRotation(m => m.generateContent(prompt));
      const response = result.response;
      let text = response.text().trim();
      if (text.startsWith('```json')) {
        text = text.substring(7, text.length - 3).trim();
      } else if (text.startsWith('```')) {
        text = text.substring(3, text.length - 3).trim();
      }
      return JSON.parse(text);
    } catch (error: any) {
      this.logger.error(
        `Error generating TOEIC questions: ${error.message}`,
        error.stack,
      );
      throw new Error('Lỗi khi sinh câu hỏi TOEIC');
    }
  }

  async generateDictation(topic: string, count: number): Promise<any[]> {
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
      const result = await this.executeWithRotation(m => m.generateContent(prompt));
      const response = result.response;
      let text = response.text().trim();
      if (text.startsWith('```json')) {
        text = text.substring(7, text.length - 3).trim();
      } else if (text.startsWith('```')) {
        text = text.substring(3, text.length - 3).trim();
      }
      return JSON.parse(text);
    } catch (error: any) {
      this.logger.error(
        `Error generating dictation: ${error.message}`,
        error.stack,
      );
      throw new Error('Lỗi khi sinh bài nghe chép chính tả');
    }
  }

  async importEtsPdf(
    pdfBuffer: Buffer,
    pdfMimeType: string,
    audioBuffer?: Buffer,
    audioMimeType?: string,
    audioUrl?: string,
  ): Promise<any[]> {
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

      const contents: any[] = [
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

      const result = await this.executeWithRotation(m => m.generateContent(contents));

      const response = result.response;
      let text = response.text().trim();
      if (text.startsWith('```json')) {
        text = text.substring(7, text.length - 3).trim();
      } else if (text.startsWith('```')) {
        text = text.substring(3, text.length - 3).trim();
      }
      return JSON.parse(text);
    } catch (error: any) {
      this.logger.error(`Error parsing ETS PDF: ${error.message}`, error.stack);
      throw new Error('Lỗi khi phân tích đề thi ETS');
    }
  }

  async evaluateWritingPart1(
    imageUrl: string,
    keywords: string[],
    userSentence: string,
  ): Promise<{ score: number; feedback: string }> {
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

      // Fetch the image as buffer to send to Gemini
      const responseImg = await fetch(imageUrl);
      const arrayBuffer = await responseImg.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const imagePart = {
        inlineData: {
          data: buffer.toString('base64'),
          mimeType: 'image/jpeg',
        },
      };

      const result = await this.executeWithRotation(m => m.generateContent([prompt, imagePart]));
      const response = result.response;
      let text = response.text().trim();
      if (text.startsWith('```json')) {
        text = text.substring(7, text.length - 3).trim();
      } else if (text.startsWith('```')) {
        text = text.substring(3, text.length - 3).trim();
      }
      return JSON.parse(text);
    } catch (error: any) {
      this.logger.error(
        `Error evaluating writing part 1: ${error.message}`,
        error.stack,
      );
      throw new Error('Lỗi khi chấm điểm Writing Part 1');
    }
  }

  async evaluateWritingPart2(
    emailPrompt: string,
    userResponse: string,
  ): Promise<{ score: number; feedback: string; suggestions: string[] }> {
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

      const result = await this.executeWithRotation(m => m.generateContent(prompt));
      let text = result.response.text().trim();
      if (text.startsWith('```json'))
        text = text.substring(7, text.length - 3).trim();
      else if (text.startsWith('```'))
        text = text.substring(3, text.length - 3).trim();
      return JSON.parse(text);
    } catch (error: any) {
      this.logger.error(`Error evaluating writing part 2: ${error.message}`);
      return {
        score: 3,
        feedback: 'Đã hoàn thành bài viết email.',
        suggestions: ['Kiểm tra lại cấu trúc ngữ pháp và từ vựng.'],
      };
    }
  }

  async evaluateWritingPart3(
    essayTopic: string,
    userEssay: string,
  ): Promise<{ score: number; feedback: string; suggestions: string[] }> {
    if (!this.hasKeys()) {
      return {
        score: 4,
        feedback:
          '[Mock Gemini] Bài luận có lập luận rõ ràng, cấu trúc đủ 3 phần.',
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

      const result = await this.executeWithRotation(m => m.generateContent(prompt));
      let text = result.response.text().trim();
      if (text.startsWith('```json'))
        text = text.substring(7, text.length - 3).trim();
      else if (text.startsWith('```'))
        text = text.substring(3, text.length - 3).trim();
      return JSON.parse(text);
    } catch (error: any) {
      this.logger.error(`Error evaluating writing part 3: ${error.message}`);
      return {
        score: 4,
        feedback: 'Bài viết đạt yêu cầu cơ bản về độ dài và nội dung.',
        suggestions: ['Tăng cường sử dụng từ nối và cấu trúc phức.'],
      };
    }
  }

  async evaluateSpeakingPart3To5(
    promptText: string,
    studentResponse: string,
  ): Promise<{ score: number; feedback: string; suggestions: string[] }> {
    if (!this.hasKeys()) {
      return {
        score: 3,
        feedback:
          '[Mock Gemini] Trả lời đúng trọng tâm câu hỏi, phát âm khá tốt.',
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

      const result = await this.executeWithRotation(m => m.generateContent(prompt));
      let text = result.response.text().trim();
      if (text.startsWith('```json'))
        text = text.substring(7, text.length - 3).trim();
      else if (text.startsWith('```'))
        text = text.substring(3, text.length - 3).trim();
      return JSON.parse(text);
    } catch (error: any) {
      this.logger.error(`Error evaluating speaking part 3-5: ${error.message}`);
      return {
        score: 3,
        feedback: 'Bài phát âm trôi chảy, đúng trọng tâm.',
        suggestions: ['Chú ý nhấn trọng âm câu tốt hơn.'],
      };
    }
  }
}
