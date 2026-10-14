import {
  Injectable,
  Inject,
  Logger,
  Optional,
  BadRequestException,
} from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { AI_EVALUATOR_TOKEN } from './strategies/ai-evaluator.interface';
import type {
  IAIEvaluator,
  PronunciationFeedback,
  DictionaryEnrichment,
  DictionaryEnrichmentInput,
  ContextualVocabSuggestion,
  ContextualGrammarSuggestion,
  ContextualReadingPassageSuggestion,
  ContextualReadingQuestionsSuggestion,
  ContextualToeicPart5Suggestion,
  ContextualCourseCurriculumSuggestion,
  ContextualListeningContentSuggestion,
  ContextualListeningQuestionsSuggestion,
  ContextualWritingTaskSuggestion,
} from './strategies/ai-evaluator.interface';

/**
 * AiService giờ đây hoạt động như một "Context" trong Strategy Pattern.
 * Nó không quan tâm AI đang dùng là Gemini hay ChatGPT. Mọi logic gọi API
 * được ủy thác (delegate) cho Strategy được tiêm vào thông qua Dependency Injection.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly DAILY_LIMIT = 500;

  constructor(
    @Inject(AI_EVALUATOR_TOKEN)
    private readonly aiEvaluator: IAIEvaluator,
    @Optional() @InjectRedis() private readonly redis?: Redis,
  ) {
    this.logger.log('AiService initialized with Strategy Pattern');
  }

  private getTodayUtcKey(): string {
    return `gemini:daily_quota:${new Date().toISOString().slice(0, 10)}`;
  }

  async checkAndIncrementDailyQuota(): Promise<number> {
    if (!this.redis) return 1;
    const key = this.getTodayUtcKey();
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, 86400 * 2);
    }
    if (count > this.DAILY_LIMIT) {
      throw new BadRequestException(
        `Đã vượt quá hạn mức quota AI trong ngày (${this.DAILY_LIMIT} requests). Vui lòng thử lại sau.`,
      );
    }
    return count;
  }

  async enrichDictionaryEntry(
    input: DictionaryEnrichmentInput,
  ): Promise<DictionaryEnrichment | null> {
    if (!this.aiEvaluator.enrichDictionaryEntry) return null;
    return this.aiEvaluator.enrichDictionaryEntry(input);
  }

  async generateFeedback(
    question: string,
    studentAnswer: string,
  ): Promise<string> {
    return this.aiEvaluator.generateFeedback(question, studentAnswer);
  }

  async chat(prompt: string): Promise<string> {
    return this.aiEvaluator.chat(prompt);
  }

  async assessPronunciation(
    targetText: string,
    audioBuffer: Buffer,
    options?: { signal?: AbortSignal },
  ): Promise<PronunciationFeedback> {
    return this.aiEvaluator.assessPronunciation(
      targetText,
      audioBuffer,
      options,
    );
  }

  async generatePronunciationFeedback(
    targetText: string,
    assessment: PronunciationFeedback,
  ): Promise<
    Partial<Pick<PronunciationFeedback, 'clarity' | 'feedback' | 'suggestions'>>
  > {
    if (!this.aiEvaluator.generatePronunciationFeedback) return {};
    return this.aiEvaluator.generatePronunciationFeedback(
      targetText,
      assessment,
    );
  }

  async explainToeicError(
    questionContent: any,
    userAnswer: string,
    correctAnswer: string,
  ): Promise<string> {
    return this.aiEvaluator.explainToeicError(
      questionContent,
      userAnswer,
      correctAnswer,
    );
  }

  async generateToeicQuestions(
    topic: string,
    part: number,
    count: number,
  ): Promise<any[]> {
    return this.aiEvaluator.generateToeicQuestions(topic, part, count);
  }

  async generateDictation(topic: string, count: number): Promise<any[]> {
    return this.aiEvaluator.generateDictation(topic, count);
  }

  async generateTtsAudio(text: string): Promise<Buffer | null> {
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
    } catch (e) {
      this.logger.error('Error in Azure TTS:', e);
      return null;
    }
  }

  async generateVietnameseTtsAudio(
    text: string,
    voiceName: string = 'vi-VN-HoaiMyNeural',
  ): Promise<Buffer | null> {
    const azureKey = process.env.AZURE_SPEECH_KEY;
    const azureRegion = process.env.AZURE_SPEECH_REGION;
    if (!azureKey || !azureRegion) {
      this.logger.warn('Thiếu AZURE_SPEECH_KEY. Bỏ qua tạo Audio tiếng Việt.');
      return null;
    }

    try {
      const endpoint = `https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`;
      const ssml = `<speak version='1.0' xml:lang='vi-VN'>
  <voice xml:lang='vi-VN' xml:gender='Female' name='${voiceName}'>
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
        this.logger.error(
          `Azure Vietnamese TTS failed: ${response.statusText}`,
        );
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (e) {
      this.logger.error('Error in Azure Vietnamese TTS:', e);
      return null;
    }
  }

  async evaluateWritingPart1(
    imageUrl: string,
    keywords: string[],
    userSentence: string,
  ): Promise<{ score: number; feedback: string }> {
    return this.aiEvaluator.evaluateWritingPart1(
      imageUrl,
      keywords,
      userSentence,
    );
  }

  async evaluateWritingPart2(
    emailPrompt: string,
    userResponse: string,
  ): Promise<{ score: number; feedback: string; suggestions: string[] }> {
    return this.aiEvaluator.evaluateWritingPart2(emailPrompt, userResponse);
  }

  async evaluateWritingPart3(
    essayTopic: string,
    userEssay: string,
  ): Promise<{ score: number; feedback: string; suggestions: string[] }> {
    return this.aiEvaluator.evaluateWritingPart3(essayTopic, userEssay);
  }

  async evaluateSpeakingPart3To5(
    promptText: string,
    studentResponse: string,
  ): Promise<{ score: number; feedback: string; suggestions: string[] }> {
    return this.aiEvaluator.evaluateSpeakingPart3To5(
      promptText,
      studentResponse,
    );
  }

  async importEtsPdf(
    pdfBuffer: Buffer,
    pdfMimeType: string,
    audioBuffer?: Buffer,
    audioMimeType?: string,
    audioUrl?: string,
  ): Promise<any[]> {
    return this.aiEvaluator.importEtsPdf(
      pdfBuffer,
      pdfMimeType,
      audioBuffer,
      audioMimeType,
      audioUrl,
    );
  }

  async generateSmartContentFromDocument(
    documentText: string,
    options?: { quizCount?: number; flashcardCount?: number },
  ) {
    return this.aiEvaluator.generateSmartContentFromDocument(
      documentText,
      options,
    );
  }

  async suggestVocabWord(input: {
    word: string;
    context?: string;
    level?: string;
  }): Promise<ContextualVocabSuggestion> {
    await this.checkAndIncrementDailyQuota();
    if (!this.aiEvaluator.suggestVocabWord) {
      throw new BadRequestException(
        'Chiến lược AI hiện tại không hỗ trợ gợi ý từ vựng',
      );
    }
    return this.aiEvaluator.suggestVocabWord(input);
  }

  async suggestGrammarQuestions(input: {
    topicTitle: string;
    level: string;
    theory?: string;
    keyFormula?: string;
    count: number;
  }): Promise<ContextualGrammarSuggestion> {
    await this.checkAndIncrementDailyQuota();
    if (!this.aiEvaluator.suggestGrammarQuestions) {
      throw new BadRequestException(
        'Chiến lược AI hiện tại không hỗ trợ gợi ý câu hỏi ngữ pháp',
      );
    }
    return this.aiEvaluator.suggestGrammarQuestions(input);
  }

  async suggestReadingPassage(input: {
    topic: string;
    level: string;
    targetLength?: number;
    microSkill?: string;
  }): Promise<ContextualReadingPassageSuggestion> {
    await this.checkAndIncrementDailyQuota();
    if (!this.aiEvaluator.suggestReadingPassage) {
      throw new BadRequestException(
        'Chiến lược AI hiện tại không hỗ trợ gợi ý đoạn đọc',
      );
    }
    return this.aiEvaluator.suggestReadingPassage(input);
  }

  async suggestReadingQuestions(input: {
    passage: string;
    level?: string;
    count: number;
  }): Promise<ContextualReadingQuestionsSuggestion> {
    await this.checkAndIncrementDailyQuota();
    if (!this.aiEvaluator.suggestReadingQuestions) {
      throw new BadRequestException(
        'Chiến lược AI hiện tại không hỗ trợ gợi ý câu hỏi đọc hiểu',
      );
    }
    return this.aiEvaluator.suggestReadingQuestions(input);
  }

  async suggestToeicPart5(input: {
    topic?: string;
    level?: string;
    grammarFocus?: string;
    vocabularyFocus?: string;
    count: number;
  }): Promise<ContextualToeicPart5Suggestion> {
    await this.checkAndIncrementDailyQuota();
    if (!this.aiEvaluator.suggestToeicPart5) {
      throw new BadRequestException(
        'Chiến lược AI hiện tại không hỗ trợ gợi ý câu hỏi TOEIC Part 5',
      );
    }
    return this.aiEvaluator.suggestToeicPart5(input);
  }

  async suggestCourseCurriculum(input: {
    courseTitle: string;
    level?: string;
    description?: string;
    targetLessonCount: number;
    existingLessonTitles?: string[];
  }): Promise<ContextualCourseCurriculumSuggestion> {
    await this.checkAndIncrementDailyQuota();
    if (!this.aiEvaluator.suggestCourseCurriculum) {
      throw new BadRequestException(
        'Chiến lược AI hiện tại không hỗ trợ gợi ý chương trình học',
      );
    }
    return this.aiEvaluator.suggestCourseCurriculum(input);
  }

  async suggestListeningContent(input: {
    mode: 'DIALOGUE' | 'DICTATION';
    level?: string;
    topic?: string;
    currentText?: string;
    currentTurns?: Array<{
      speaker: string;
      text: string;
      translation?: string;
    }>;
  }): Promise<ContextualListeningContentSuggestion> {
    await this.checkAndIncrementDailyQuota();
    if (!this.aiEvaluator.suggestListeningContent) {
      throw new BadRequestException(
        'Chiến lược AI hiện tại không hỗ trợ gợi ý nội dung nghe',
      );
    }
    return this.aiEvaluator.suggestListeningContent(input);
  }

  async suggestListeningQuestions(input: {
    mode: 'DIALOGUE' | 'DICTATION';
    sourceText: string;
    level?: string;
    count: number;
  }): Promise<ContextualListeningQuestionsSuggestion> {
    await this.checkAndIncrementDailyQuota();
    if (!this.aiEvaluator.suggestListeningQuestions) {
      throw new BadRequestException(
        'Chiến lược AI hiện tại không hỗ trợ tạo câu hỏi nghe',
      );
    }
    return this.aiEvaluator.suggestListeningQuestions(input);
  }

  async suggestWritingTask(input: {
    taskType: string;
    level?: string;
    topic?: string;
    currentPrompt?: string;
    wordMin?: number;
    wordMax?: number;
  }): Promise<ContextualWritingTaskSuggestion> {
    await this.checkAndIncrementDailyQuota();
    if (!this.aiEvaluator.suggestWritingTask) {
      throw new BadRequestException(
        'Chiến lược AI hiện tại không hỗ trợ gợi ý đề bài Writing',
      );
    }
    return this.aiEvaluator.suggestWritingTask(input);
  }
}
