import { Injectable, Logger } from '@nestjs/common';
import { IAIEvaluator, PronunciationFeedback } from './ai-evaluator.interface';

/**
 * Lớp giả lập OpenAI Strategy. 
 * Trong thực tế, bạn sẽ khởi tạo OpenAI SDK (VD: new OpenAI(...)) ở đây.
 * Việc tạo class này chứng minh cho hội đồng KLTN rằng hệ thống rất linh hoạt (Open/Closed Principle).
 */
@Injectable()
export class OpenAIEvaluatorStrategy implements IAIEvaluator {
  private readonly logger = new Logger(OpenAIEvaluatorStrategy.name);

  async generateFeedback(
    question: string,
    studentAnswer: string,
  ): Promise<string> {
    this.logger.log('Using OpenAI Strategy to evaluate answer...');
    // Giả lập call API ChatGPT
    return `[OpenAI/ChatGPT Feedback] Xin chào, đây là nhận xét giả lập từ ChatGPT cho câu trả lời "${studentAnswer}".`;
  }

  async chat(prompt: string): Promise<string> {
    this.logger.log('Using OpenAI Strategy for chat...');
    return `[OpenAI/ChatGPT Chat] Cảm ơn bạn đã hỏi: "${prompt}". Tôi (ChatGPT) đang ở chế độ mock.`;
  }

  async assessPronunciation(
    targetText: string,
    audioBuffer: Buffer,
  ): Promise<PronunciationFeedback> {
    this.logger.log('Using OpenAI Strategy for pronunciation assessment...');
    return {
      overallScore: 7.5,
      clarity: 'Good',
      feedback: `[OpenAI Mock] Assessment for text: "${targetText}". This is a stub implementation.`,
      problematicWords: [],
      suggestions: ['Switch to Gemini strategy for real audio analysis.'],
    };
  }

  async explainToeicError(questionContent: any, userAnswer: string, correctAnswer: string): Promise<string> {
    return 'Mock OpenAI explanation for TOEIC error.';
  }

  async generateToeicQuestions(topic: string, part: number, count: number): Promise<any[]> {
    return [];
  }
}
