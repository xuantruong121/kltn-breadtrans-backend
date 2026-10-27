import { IsArray, IsInt, IsObject, IsOptional } from 'class-validator';

export class SaveAnswersDto {
  @IsObject()
  /** Question id → option index; null clears a saved answer. */
  answers!: Record<string, number | null>;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  markedQuestionIds?: number[];

  @IsOptional()
  @IsInt()
  currentQuestionId?: number;
}
