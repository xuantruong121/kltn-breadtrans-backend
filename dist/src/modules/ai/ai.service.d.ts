export declare class AiService {
    private readonly logger;
    private genAI;
    constructor();
    generateFeedback(question: string, studentAnswer: string): Promise<string>;
    chat(prompt: string): Promise<string>;
}
