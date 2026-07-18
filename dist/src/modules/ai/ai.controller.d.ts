import { AiService } from './ai.service';
export declare class ChatDto {
    prompt: string;
}
export declare class GenerateToeicDto {
    topic: string;
    part: number;
    count: number;
}
export declare class AiController {
    private readonly aiService;
    constructor(aiService: AiService);
    chat(chatDto: ChatDto): Promise<{
        reply: string;
    }>;
    generateToeicQuiz(dto: GenerateToeicDto): Promise<{
        success: boolean;
        questions: any[];
    }>;
    explainToeicError(body: {
        questionContent: any;
        userAnswer: string;
        correctAnswer: string;
    }): Promise<{
        success: boolean;
        explanation: string;
    }>;
}
