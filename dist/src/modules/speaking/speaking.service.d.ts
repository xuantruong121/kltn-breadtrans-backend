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
        createdAt: Date;
        id: number;
        title: string;
        targetText: string;
        imageUrl: string | null;
        audioUrl: string | null;
        difficulty: string;
        category: string;
    }[]>;
    findExerciseById(id: number): Promise<{
        createdAt: Date;
        id: number;
        title: string;
        targetText: string;
        imageUrl: string | null;
        audioUrl: string | null;
        difficulty: string;
        category: string;
    }>;
    createExercise(dto: CreateExerciseDto): Promise<{
        createdAt: Date;
        id: number;
        title: string;
        targetText: string;
        imageUrl: string | null;
        audioUrl: string | null;
        difficulty: string;
        category: string;
    }>;
    submitAudio(exerciseId: number, userId: number, audioFile: Express.Multer.File): Promise<{
        submissionId: number;
        audioUrl: string;
        assessment: import("../ai/strategies/ai-evaluator.interface").PronunciationFeedback;
    }>;
    getMySubmissions(userId: number): Promise<({
        exercise: {
            createdAt: Date;
            id: number;
            title: string;
            targetText: string;
            imageUrl: string | null;
            audioUrl: string | null;
            difficulty: string;
            category: string;
        };
    } & {
        id: number;
        userId: number;
        audioUrl: string;
        submittedAt: Date;
        aiFeedback: import("@prisma/client/runtime/library").JsonValue | null;
        overallScore: number | null;
        exerciseId: number;
    })[]>;
}
