import { ApiProperty } from '@nestjs/swagger';
import { LearningContentType } from '@prisma/client';
import { IsEnum, IsInt, Min } from 'class-validator';

export class LearningItemDto {
  @ApiProperty({ enum: LearningContentType })
  @IsEnum(LearningContentType)
  contentType!: LearningContentType;

  @ApiProperty({
    description: 'Quiz id, or the first exercise id of a speaking set',
  })
  @IsInt()
  @Min(1)
  contentId!: number;
}
