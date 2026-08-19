import { IsString, IsOptional, IsInt } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateGrammarTopicDto {
  @ApiProperty({ example: 'Thì Hiện Tại Đơn (Present Simple)' })
  @IsString()
  title: string;

  @ApiPropertyOptional({ example: 'BEGINNER', default: 'BEGINNER' })
  @IsString()
  @IsOptional()
  level?: string;

  @ApiPropertyOptional({
    example: 'Chủ đề các thì căn bản trong bài thi TOEIC',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: '10r9ke8Gg3Y' })
  @IsString()
  @IsOptional()
  videoYoutubeId?: string;

  @ApiPropertyOptional({ example: 'S + V(s/es) + O' })
  @IsString()
  @IsOptional()
  keyFormula?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsInt()
  @IsOptional()
  order?: number;
}
