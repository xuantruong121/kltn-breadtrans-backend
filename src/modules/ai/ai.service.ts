import { Injectable, Inject, Logger } from '@nestjs/common';
import { AI_EVALUATOR_TOKEN } from './strategies/ai-evaluator.interface';
import type {
  IAIEvaluator,
  PronunciationFeedback,
} from './strategies/ai-evaluator.interface';

/**
 * AiService giờ đây hoạt động như một "Context" trong Strategy Pattern.
 * Nó không quan tâm AI đang dùng là Gemini hay ChatGPT. Mọi logic gọi API
 * được ủy thác (delegate) cho Strategy được tiêm vào thông qua Dependency Injection.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    @Inject(AI_EVALUATOR_TOKEN)
    private readonly aiEvaluator: IAIEvaluator,
  ) {
    this.logger.log('AiService initialized with Strategy Pattern');
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
  ): Promise<PronunciationFeedback> {
    return this.aiEvaluator.assessPronunciation(targetText, audioBuffer);
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
}
