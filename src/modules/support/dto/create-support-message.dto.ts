import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateSupportMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content: string;

  @IsString()
  @IsOptional()
  clientMessageId?: string;

  /**
   * The answered item the learner asks the tutor about:
   * { sourceType, sourceId, questionId }. Only ids; the server reads the item.
   */
  @IsObject()
  @IsOptional()
  context?: Record<string, unknown>;
}
