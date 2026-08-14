import { SpeakingService } from './speaking.service';
import { CreateExerciseDto } from './dto/create-exercise.dto';
export declare class SpeakingController {
    private readonly speakingService;
    constructor(speakingService: SpeakingService);
    createExercise(dto: CreateExerciseDto): Promise<{
        createdAt: Date;
        id: number;
        title: string;
        category: string;
        targetText: string;
        imageUrl: string | null;
        audioUrl: string | null;
        difficulty: string;
    }>;
    findAllExercises(category: string, req: any): Promise<{
        isCompleted: boolean;
        createdAt: Date;
        id: number;
        title: string;
        category: string;
        targetText: string;
        imageUrl: string | null;
        audioUrl: string | null;
        difficulty: string;
    }[]>;
    findOne(id: number): Promise<{
        createdAt: Date;
        id: number;
        title: string;
        category: string;
        targetText: string;
        imageUrl: string | null;
        audioUrl: string | null;
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
            createdAt: Date;
            id: number;
            title: string;
            category: string;
            targetText: string;
            imageUrl: string | null;
            audioUrl: string | null;
            difficulty: string;
        };
    } & {
        id: number;
        userId: number;
        submittedAt: Date;
        aiFeedback: import("@prisma/client/runtime/library").JsonValue | null;
        audioUrl: string;
        exerciseId: number;
        overallScore: number | null;
    })[]>;
}
