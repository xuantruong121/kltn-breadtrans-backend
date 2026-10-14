import { IsString, IsOptional, IsInt } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateGrammarTopicDto {
  @ApiPropertyOptional({ example: 'Thì Hiện Tại Đơn' })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({ example: 'BEGINNER' })
  @IsString()
  @IsOptional()
  level?: string;

  @ApiPropertyOptional({ example: 'Mô tả chi tiết' })
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
