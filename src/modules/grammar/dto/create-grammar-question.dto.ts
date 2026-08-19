import { IsString, IsArray, IsInt, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateGrammarQuestionDto {
  @ApiProperty({ example: 'She usually _______ to work by bus.' })
  @IsString()
  question: string;

  @ApiProperty({ example: ['go', 'goes', 'going', 'went'] })
  @IsArray()
  options: string[];

  @ApiProperty({ example: 1 })
  @IsInt()
  correctIndex: number;

  @ApiPropertyOptional({
    example: 'Chủ ngữ "She" ngôi thứ 3 số ít nên động từ thêm "es" (goes).',
  })
  @IsString()
  @IsOptional()
  explanation?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsInt()
  @IsOptional()
  order?: number;
}
