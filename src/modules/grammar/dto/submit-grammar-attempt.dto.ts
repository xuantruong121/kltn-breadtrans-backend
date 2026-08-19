import { IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SubmitGrammarAttemptDto {
  @ApiProperty({
    example: { '1': 1, '2': 0, '3': 2 },
    description: 'Map giữa questionId và selected option index',
  })
  @IsObject()
  answers: Record<number, number>;
}
