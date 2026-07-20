import type { IAIEvaluator, PronunciationFeedback } from './strategies/ai-evaluator.interface';
export declare class AiService {
    private readonly aiEvaluator;
    private readonly logger;
    constructor(aiEvaluator: IAIEvaluator);
    generateFeedback(question: string, studentAnswer: string): Promise<string>;
    chat(prompt: string): Promise<string>;
    assessPronunciation(targetText: string, audioBuffer: Buffer): Promise<PronunciationFeedback>;
    explainToeicError(questionContent: any, userAnswer: string, correctAnswer: string): Promise<string>;
    generateToeicQuestions(topic: string, part: number, count: number): Promise<any[]>;
    generateDictation(topic: string, count: number): Promise<any[]>;
    generateTtsAudio(text: string): Promise<Buffer | null>;
    evaluateWritingPart1(imageUrl: string, keywords: string[], userSentence: string): Promise<{
        score: number;
        feedback: string;
    }>;
    importEtsPdf(pdfBuffer: Buffer, pdfMimeType: string, audioBuffer?: Buffer, audioMimeType?: string, audioUrl?: string): Promise<any[]>;
}
