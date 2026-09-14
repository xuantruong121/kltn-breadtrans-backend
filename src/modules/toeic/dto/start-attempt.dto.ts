import { IsEnum } from 'class-validator';
import { AttemptMode } from '@prisma/client';

export class StartAttemptDto {
  @IsEnum(AttemptMode)
  mode: AttemptMode = AttemptMode.PRACTICE;
}
