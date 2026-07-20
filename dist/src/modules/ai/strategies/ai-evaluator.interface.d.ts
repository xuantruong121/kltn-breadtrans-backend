export declare const AI_EVALUATOR_TOKEN = "AI_EVALUATOR_STRATEGY";
export interface PronunciationFeedback {
    overallScore: number;
    clarity: string;
    feedback: string;
    problematicWords: string[];
    suggestions: string[];
}
export interface IAIEvaluator {
    generateFeedback(question: string, studentAnswer: string): Promise<string>;
    chat(prompt: string): Promise<string>;
    assessPronunciation(targetText: string, audioBuffer: Buffer): Promise<PronunciationFeedback>;
    explainToeicError(questionContent: any, userAnswer: string, correctAnswer: string): Promise<string>;
    generateToeicQuestions(topic: string, part: number, count: number): Promise<any[]>;
    generateDictation(topic: string, count: number): Promise<any[]>;
    evaluateWritingPart1(imageUrl: string, keywords: string[], userSentence: string): Promise<{
        score: number;
        feedback: string;
    }>;
    importEtsPdf(pdfBuffer: Buffer, pdfMimeType: string, audioBuffer?: Buffer, audioMimeType?: string, audioUrl?: string): Promise<any[]>;
}
