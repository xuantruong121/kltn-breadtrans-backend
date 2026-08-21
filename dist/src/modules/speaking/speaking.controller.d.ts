import { SpeakingService } from './speaking.service';
import { CreateExerciseDto } from './dto/create-exercise.dto';
export declare class SpeakingController {
    private readonly speakingService;
    constructor(speakingService: SpeakingService);
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
    findAllExercises(category: string, req: any): Promise<{
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
    findOne(id: number): Promise<{
        id: number;
        title: string;
        targetText: string;
        imageUrl: string | null;
        audioUrl: string | null;
        difficulty: string;
        category: string;
        createdAt: Date;
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
