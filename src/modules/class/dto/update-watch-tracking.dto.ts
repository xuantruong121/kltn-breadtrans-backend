import {
  IsString,
  IsNotEmpty,
  IsNumber,
  Min,
  Max,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class WatchTrackingDataDto {
  @ApiProperty({ example: 0.85, description: 'Tỷ lệ xem video (0..1)' })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(1)
  played: number;
}

export class UpdateWatchTrackingDto {
  @ApiProperty({
    example: 'https://cdn.example.com/video1.mp4',
    description: 'Video URL hoặc Video Key của bài học',
  })
  @IsString()
  @IsNotEmpty()
  videoKey: string;

  @ApiPropertyOptional({
    example: 0.85,
    description: 'Tỷ lệ xem video (0..1) trực tiếp',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(1)
  played?: number;

  @ApiPropertyOptional({
    type: WatchTrackingDataDto,
    description: 'Payload lồng (tương thích ngược)',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => WatchTrackingDataDto)
  data?: WatchTrackingDataDto;
}
