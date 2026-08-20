import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from './ai.service';
import { UploadService } from '../upload/upload.service';
export declare class ChatDto {
    prompt?: string;
    messages?: Array<{
        role: string;
        content: string;
    }>;
}
export declare class GenerateToeicDto {
    topic: string;
    part: number;
    count: number;
}
export declare class GenerateDictationDto {
    topic: string;
    count: number;
}
export declare class AiController {
    private readonly aiService;
    private readonly prisma;
    private readonly uploadService;
    constructor(aiService: AiService, prisma: PrismaService, uploadService: UploadService);
    chat(chatDto: ChatDto): Promise<{
        reply: string;
        answer: string;
    }>;
    generateDictation(dto: GenerateDictationDto): Promise<{
        success: boolean;
        message: string;
        quizId: number;
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
    importEtsPdf(files: {
        pdfFile?: Express.Multer.File[];
        audioFile?: Express.Multer.File[];
    }): Promise<{
        success: boolean;
        message: string;
        quizId: number;
    }>;
}
