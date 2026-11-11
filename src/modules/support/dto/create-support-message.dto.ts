import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateSupportMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content: string;

  @IsString()
  @IsOptional()
  clientMessageId?: string;
}
