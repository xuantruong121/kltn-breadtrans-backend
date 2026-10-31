import { IsString, IsArray, IsInt, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateGrammarQuestionDto {
  @ApiPropertyOptional({ example: 'She usually _______ to work by bus.' })
  @IsString()
  @IsOptional()
  question?: string;

  @ApiPropertyOptional({ example: ['go', 'goes', 'going', 'went'] })
  @IsArray()
  @IsOptional()
  options?: string[];

  @ApiPropertyOptional({ example: 1 })
  @IsInt()
  @IsOptional()
  correctIndex?: number;

  @ApiPropertyOptional({ example: 'Giải thích chi tiết' })
  @IsString()
  @IsOptional()
  explanation?: string;

  @ApiPropertyOptional({
    example: ['', 'Hiện tại đơn, không hợp với "yesterday"', null, null],
    description: 'Vì sao mỗi đáp án sai là sai, theo thứ tự options',
  })
  @IsArray()
  @IsOptional()
  optionExplanations?: Array<string | null>;

  @ApiPropertyOptional({ example: 1 })
  @IsInt()
  @IsOptional()
  order?: number;
}
