import { Injectable, Inject, Logger } from '@nestjs/common';
import { AI_EVALUATOR_TOKEN } from './strategies/ai-evaluator.interface';
import type { IAIEvaluator, PronunciationFeedback } from './strategies/ai-evaluator.interface';

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
    return this.aiEvaluator.explainToeicError(questionContent, userAnswer, correctAnswer);
  }

  async generateToeicQuestions(
    topic: string,
    part: number,
    count: number,
  ): Promise<any[]> {
    return this.aiEvaluator.generateToeicQuestions(topic, part, count);
  }
}
