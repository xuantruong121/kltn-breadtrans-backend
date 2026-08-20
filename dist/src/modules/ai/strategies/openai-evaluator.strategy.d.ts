import { IAIEvaluator, PronunciationFeedback, SmartGeneratedContent } from './ai-evaluator.interface';
export declare class OpenAIEvaluatorStrategy implements IAIEvaluator {
    private readonly logger;
    generateFeedback(question: string, studentAnswer: string): Promise<string>;
    chat(prompt: string): Promise<string>;
    assessPronunciation(targetText: string, audioBuffer: Buffer): Promise<PronunciationFeedback>;
    explainToeicError(questionContent: any, userAnswer: string, correctAnswer: string): Promise<string>;
    generateToeicQuestions(topic: string, part: number, count: number): Promise<any[]>;
    generateDictation(topic: string, count: number): Promise<any[]>;
    importEtsPdf(pdfBuffer: Buffer, pdfMimeType: string, audioBuffer?: Buffer, audioMimeType?: string, audioUrl?: string): Promise<any[]>;
    evaluateWritingPart1(imageUrl: string, keywords: string[], userSentence: string): Promise<{
        score: number;
        feedback: string;
    }>;
    evaluateWritingPart2(emailPrompt: string, userResponse: string): Promise<{
        score: number;
        feedback: string;
        suggestions: string[];
    }>;
    evaluateWritingPart3(essayTopic: string, userEssay: string): Promise<{
        score: number;
        feedback: string;
        suggestions: string[];
    }>;
    evaluateSpeakingPart3To5(promptText: string, studentResponse: string): Promise<{
        score: number;
        feedback: string;
        suggestions: string[];
    }>;
    generateSmartContentFromDocument(documentText: string, options?: {
        quizCount?: number;
        flashcardCount?: number;
    }): Promise<SmartGeneratedContent>;
}
