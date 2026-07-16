import { AiService } from './ai.service';
export declare class ChatDto {
    prompt: string;
}
export declare class AiController {
    private readonly aiService;
    constructor(aiService: AiService);
    chat(chatDto: ChatDto): Promise<{
        reply: string;
    }>;
}
