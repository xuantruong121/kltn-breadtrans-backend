import { IAIEvaluator, PronunciationFeedback } from './ai-evaluator.interface';
export declare class OpenAIEvaluatorStrategy implements IAIEvaluator {
    private readonly logger;
    generateFeedback(question: string, studentAnswer: string): Promise<string>;
    chat(prompt: string): Promise<string>;
    assessPronunciation(targetText: string, audioBuffer: Buffer): Promise<PronunciationFeedback>;
    explainToeicError(questionContent: any, userAnswer: string, correctAnswer: string): Promise<string>;
    generateToeicQuestions(topic: string, part: number, count: number): Promise<any[]>;
}
