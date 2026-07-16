import { QuizType } from '@prisma/client';
export declare class CreateQuizDto {
    courseId?: number;
    title: string;
    description?: string;
    type?: QuizType;
    timeLimit?: number;
}
export declare class CreateQuestionDto {
    type: string;
    content: any;
    order?: number;
}
export declare class AnswerDto {
    questionId: number;
    answer: any;
}
export declare class SubmitQuizDto {
    answers: AnswerDto[];
}
