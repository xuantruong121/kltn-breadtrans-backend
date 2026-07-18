import { SpeakingService } from './speaking.service';
import { CreateExerciseDto } from './dto/create-exercise.dto';
export declare class SpeakingController {
    private readonly speakingService;
    constructor(speakingService: SpeakingService);
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
    findOne(id: number): Promise<{
        createdAt: Date;
        id: number;
        title: string;
        targetText: string;
        imageUrl: string | null;
        audioUrl: string | null;
        difficulty: string;
        category: string;
    }>;
    submitAudio(exerciseId: number, req: any, audio: Express.Multer.File): Promise<{
        submissionId: number;
        audioUrl: string;
        assessment: import("../ai/strategies/ai-evaluator.interface").PronunciationFeedback;
    }>;
    getMySubmissions(req: any): Promise<({
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
