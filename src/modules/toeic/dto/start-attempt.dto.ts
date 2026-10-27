import { ApiPropertyOptional } from '@nestjs/swagger';
import { AttemptMode } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class StartAttemptDto {
  @IsEnum(AttemptMode)
  mode: AttemptMode = AttemptMode.PRACTICE;

  /** Practice only: the Parts to practise (1-7). Omitted or empty = all Parts. */
  @ApiPropertyOptional({ type: [Number], example: [2, 6] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  parts?: number[];
}
