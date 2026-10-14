import { IsString, IsNotEmpty, IsOptional, IsInt } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateVocabWordDto {
  @ApiProperty({ example: 'contract' })
  @IsString()
  @IsNotEmpty()
  word: string;

  @ApiProperty({ example: 'hợp đồng, giao kèo' })
  @IsString()
  @IsNotEmpty()
  meaning: string;

  @ApiPropertyOptional({ example: 'noun', default: 'noun' })
  @IsString()
  @IsOptional()
  pos?: string;

  @ApiPropertyOptional({ example: '/ˈkɑːntrækt/' })
  @IsString()
  @IsOptional()
  ipaUs?: string;

  @ApiPropertyOptional({ example: '/ˈkɒntrækt/' })
  @IsString()
  @IsOptional()
  ipaUk?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/audio/us.mp3' })
  @IsString()
  @IsOptional()
  audioUs?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/audio/uk.mp3' })
  @IsString()
  @IsOptional()
  audioUk?: string;

  @ApiPropertyOptional({ example: 'They signed a contract.' })
  @IsString()
  @IsOptional()
  exampleEn?: string;

  @ApiPropertyOptional({ example: 'Họ đã ký một hợp đồng.' })
  @IsString()
  @IsOptional()
  exampleVi?: string;

  @ApiPropertyOptional({ example: { synonyms: ['agreement', 'deal'] } })
  @IsOptional()
  collocations?: any;

  @ApiPropertyOptional({ example: 0 })
  @IsInt()
  @IsOptional()
  order?: number;
}
