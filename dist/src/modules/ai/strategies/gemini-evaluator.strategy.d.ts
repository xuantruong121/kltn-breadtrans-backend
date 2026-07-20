import { IAIEvaluator, PronunciationFeedback } from './ai-evaluator.interface';
export declare class GeminiEvaluatorStrategy implements IAIEvaluator {
    private readonly logger;
    private genAI;
    constructor();
    generateFeedback(question: string, studentAnswer: string): Promise<string>;
    chat(prompt: string): Promise<string>;
    assessPronunciation(targetText: string, audioBuffer: Buffer): Promise<PronunciationFeedback>;
    explainToeicError(questionContent: any, userAnswer: string, correctAnswer: string): Promise<string>;
    generateToeicQuestions(topic: string, part: number, count: number): Promise<any[]>;
    generateDictation(topic: string, count: number): Promise<any[]>;
    importEtsPdf(pdfBuffer: Buffer, pdfMimeType: string, audioBuffer?: Buffer, audioMimeType?: string, audioUrl?: string): Promise<any[]>;
}
