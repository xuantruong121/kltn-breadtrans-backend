import { SpeakingService } from './speaking.service';
import { CreateExerciseDto } from './dto/create-exercise.dto';
export declare class SpeakingController {
    private readonly speakingService;
    constructor(speakingService: SpeakingService);
    createExercise(dto: CreateExerciseDto): Promise<{
        title: string;
        createdAt: Date;
        id: number;
        category: string;
        audioUrl: string | null;
        targetText: string;
        imageUrl: string | null;
        difficulty: string;
    }>;
    findAllExercises(category?: string): Promise<{
        title: string;
        createdAt: Date;
        id: number;
        category: string;
        audioUrl: string | null;
        targetText: string;
        imageUrl: string | null;
        difficulty: string;
    }[]>;
    findOne(id: number): Promise<{
        title: string;
        createdAt: Date;
        id: number;
        category: string;
        audioUrl: string | null;
        targetText: string;
        imageUrl: string | null;
        difficulty: string;
    }>;
    submitAudio(exerciseId: number, req: any, audio: Express.Multer.File): Promise<{
        submissionId: number;
        audioUrl: string;
        assessment: import("../ai/strategies/ai-evaluator.interface").PronunciationFeedback;
    }>;
    submitPart3To5(promptText: string, studentResponse: string): Promise<{
        score: number;
        feedback: string;
        suggestions: string[];
    }>;
    getMySubmissions(req: any): Promise<({
        exercise: {
            title: string;
            createdAt: Date;
            id: number;
            category: string;
            audioUrl: string | null;
            targetText: string;
            imageUrl: string | null;
            difficulty: string;
        };
    } & {
        id: number;
        userId: number;
        submittedAt: Date;
        aiFeedback: import("@prisma/client/runtime/library").JsonValue | null;
        audioUrl: string;
        overallScore: number | null;
        exerciseId: number;
    })[]>;
}
