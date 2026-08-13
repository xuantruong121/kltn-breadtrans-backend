import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { UploadService } from '../upload/upload.service';
import { CreateExerciseDto } from './dto/create-exercise.dto';
export declare class SpeakingService {
    private readonly prisma;
    private readonly aiService;
    private readonly uploadService;
    private readonly logger;
    constructor(prisma: PrismaService, aiService: AiService, uploadService: UploadService);
    findAllExercises(category?: string): Promise<{
        category: string;
        createdAt: Date;
        id: number;
        title: string;
        targetText: string;
        difficulty: string;
        imageUrl: string | null;
        audioUrl: string | null;
    }[]>;
    findExerciseById(id: number): Promise<{
        category: string;
        createdAt: Date;
        id: number;
        title: string;
        targetText: string;
        difficulty: string;
        imageUrl: string | null;
        audioUrl: string | null;
    }>;
    createExercise(dto: CreateExerciseDto): Promise<{
        category: string;
        createdAt: Date;
        id: number;
        title: string;
        targetText: string;
        difficulty: string;
        imageUrl: string | null;
        audioUrl: string | null;
    }>;
    submitAudio(exerciseId: number, userId: number, audioFile: Express.Multer.File): Promise<{
        submissionId: number;
        audioUrl: string;
        assessment: import("../ai/strategies/ai-evaluator.interface").PronunciationFeedback;
    }>;
    evaluateSpeakingPart3To5(promptText: string, studentResponse: string): Promise<{
        score: number;
        feedback: string;
        suggestions: string[];
    }>;
    getMySubmissions(userId: number): Promise<({
        exercise: {
            category: string;
            createdAt: Date;
            id: number;
            title: string;
            targetText: string;
            difficulty: string;
            imageUrl: string | null;
            audioUrl: string | null;
        };
    } & {
        id: number;
        submittedAt: Date;
        aiFeedback: import("@prisma/client/runtime/library").JsonValue | null;
        userId: number;
        audioUrl: string;
        overallScore: number | null;
        exerciseId: number;
    })[]>;
}
