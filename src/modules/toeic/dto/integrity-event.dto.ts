import { IsEnum, IsInt, IsObject, IsOptional, Min } from 'class-validator';
import { IntegrityEventType } from '@prisma/client';

export class IntegrityEventDto {
  @IsEnum(IntegrityEventType)
  eventType!: IntegrityEventType;

  @IsOptional()
  @IsInt()
  @Min(1)
  questionId?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
