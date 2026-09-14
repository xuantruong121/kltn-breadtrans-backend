import { IsObject } from 'class-validator';

export class SaveAnswersDto {
  @IsObject()
  answers!: Record<string, number>;
}
