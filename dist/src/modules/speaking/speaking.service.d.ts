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
    findAllExercises(category: string | undefined, userId?: number): Promise<{
        isCompleted: boolean;
        id: number;
        title: string;
        targetText: string;
        imageUrl: string | null;
        audioUrl: string | null;
        difficulty: string;
        category: string;
        createdAt: Date;
    }[]>;
    findExerciseById(id: number): Promise<{
        id: number;
        title: string;
        targetText: string;
        imageUrl: string | null;
        audioUrl: string | null;
        difficulty: string;
        category: string;
        createdAt: Date;
    }>;
    createExercise(dto: CreateExerciseDto): Promise<{
        id: number;
        title: string;
        targetText: string;
        imageUrl: string | null;
        audioUrl: string | null;
        difficulty: string;
        category: string;
        createdAt: Date;
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
            id: number;
            title: string;
            targetText: string;
            imageUrl: string | null;
            audioUrl: string | null;
            difficulty: string;
            category: string;
            createdAt: Date;
        };
    } & {
        id: number;
        audioUrl: string;
        exerciseId: number;
        userId: number;
        overallScore: number | null;
        aiFeedback: import("@prisma/client/runtime/library").JsonValue | null;
        submittedAt: Date;
    })[]>;
}
