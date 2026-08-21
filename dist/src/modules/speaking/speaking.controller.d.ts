import { SpeakingService } from './speaking.service';
import { CreateExerciseDto } from './dto/create-exercise.dto';
export declare class SpeakingController {
    private readonly speakingService;
    constructor(speakingService: SpeakingService);
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
    findAllExercises(category: string, req: any): Promise<{
        isCompleted: boolean;
        category: string;
        createdAt: Date;
        id: number;
        title: string;
        targetText: string;
        difficulty: string;
        imageUrl: string | null;
        audioUrl: string | null;
    }[]>;
    findOne(id: number): Promise<{
        category: string;
        createdAt: Date;
        id: number;
        title: string;
        targetText: string;
        difficulty: string;
        imageUrl: string | null;
        audioUrl: string | null;
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
        exerciseId: number;
        overallScore: number | null;
    })[]>;
}
