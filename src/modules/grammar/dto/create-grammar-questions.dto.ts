import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CreateGrammarQuestionDto } from './create-grammar-question.dto';

export class CreateGrammarQuestionsDto {
  @ApiProperty({ type: [CreateGrammarQuestionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateGrammarQuestionDto)
  questions: CreateGrammarQuestionDto[];
}
