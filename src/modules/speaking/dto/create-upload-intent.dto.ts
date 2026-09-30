import {
  IsString,
  IsNotEmpty,
  IsInt,
  Min,
  Max,
  IsOptional,
  IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUploadIntentDto {
  @ApiProperty({
    example: 'audio/wav',
    description: 'MIME type of the audio to be uploaded',
    enum: ['audio/wav', 'audio/x-wav'],
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['audio/wav', 'audio/x-wav'], {
    message: 'Chỉ chấp nhận định dạng audio/wav',
  })
  contentType: string;

  @ApiProperty({
    example: 640000,
    description: 'Expected audio file size in bytes (max 10MB)',
  })
  @IsInt()
  @Min(1, { message: 'Dung lượng file phải lớn hơn 0 bytes' })
  @Max(10 * 1024 * 1024, { message: 'Dung lượng file tối đa là 10MB' })
  sizeBytes: number;

  @ApiProperty({
    example: 15000,
    description: 'Spoken audio duration in milliseconds (300ms to 45000ms)',
  })
  @IsInt()
  @Min(300, { message: 'Thời lượng audio tối thiểu là 300ms' })
  @Max(45000, { message: 'Thời lượng audio tối đa là 45 giây' })
  durationMs: number;

  @ApiPropertyOptional({
    example: 'spk-key-12345',
    description: 'Client idempotency key for this attempt',
  })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  @ApiPropertyOptional({
    example: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    description: 'Optional SHA-256 checksum of the audio payload',
  })
  @IsOptional()
  @IsString()
  checksum?: string;
}
