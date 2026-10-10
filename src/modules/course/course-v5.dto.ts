import { IsArray } from 'class-validator';

export class SubmitCourseLessonExerciseDto {
  @IsArray()
  answers!: Array<{ questionId: number; answer: unknown }>;
}
