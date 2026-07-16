import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private genAI: GoogleGenerativeAI;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY || 'fake-api-key';
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async generateFeedback(
    question: string,
    studentAnswer: string,
  ): Promise<string> {
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
    } catch (error) {
      this.logger.error('Failed to generate AI feedback', error);
      return 'Could not generate AI feedback at this time due to an error.';
    }
  }

  async chat(prompt: string): Promise<string> {
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
    } catch (error) {
      this.logger.error('Chat AI failed', error);
      return 'I am currently unable to process your request.';
    }
  }
}
