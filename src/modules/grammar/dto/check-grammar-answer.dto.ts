import { IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CheckGrammarAnswerDto {
  @ApiProperty({ example: 2, description: 'Chỉ số đáp án đã chọn (0-3)' })
  @IsInt()
  @Min(0)
  selectedOption: number;
}
