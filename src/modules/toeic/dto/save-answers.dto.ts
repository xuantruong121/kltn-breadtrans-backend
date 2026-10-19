import { IsArray, IsInt, IsObject, IsOptional } from 'class-validator';

export class SaveAnswersDto {
  @IsObject()
  answers!: Record<string, number>;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  markedQuestionIds?: number[];

  @IsOptional()
  @IsInt()
  currentQuestionId?: number;
}
