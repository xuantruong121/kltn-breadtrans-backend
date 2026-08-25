export declare const AI_EVALUATOR_TOKEN = "AI_EVALUATOR_STRATEGY";
export interface WordAssessment {
    word: string;
    accuracyScore: number;
    errorType: 'None' | 'Mispronunciation' | 'Omission' | 'Insertion' | 'Unspoken';
    isCorrect: boolean;
}
export interface PronunciationFeedback {
    overallScore: number;
    clarity: string;
    feedback: string;
    problematicWords: string[];
    suggestions: string[];
    fluencyScore?: number;
    accuracyScore?: number;
    completenessScore?: number;
    words?: WordAssessment[];
    isSilentOrNoSpeech?: boolean;
}
export interface SmartGeneratedContent {
    documentSummary?: string;
    quizQuestions: Array<{
        question: string;
        options: string[];
        correctIndex: number;
        explanation: string;
        difficulty?: string;
    }>;
    flashcards: Array<{
        term: string;
        pos?: string;
        ipa?: string;
        meaning: string;
        example: string;
    }>;
    assignment: {
        title: string;
        description: string;
        instructions: string;
        estimatedTimeMinutes?: number;
    };
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
    importEtsPdf(pdfBuffer: Buffer, pdfMimeType: string, audioBuffer?: Buffer, audioMimeType?: string, audioUrl?: string): Promise<any[]>;
    generateSmartContentFromDocument(documentText: string, options?: {
        quizCount?: number;
        flashcardCount?: number;
    }): Promise<SmartGeneratedContent>;
}
