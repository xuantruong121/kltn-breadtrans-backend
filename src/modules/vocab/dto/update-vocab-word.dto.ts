import { IsString, IsOptional, IsInt } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateVocabWordDto {
  @ApiPropertyOptional({ example: 'contract' })
  @IsString()
  @IsOptional()
  word?: string;

  @ApiPropertyOptional({ example: 'hợp đồng, giao kèo' })
  @IsString()
  @IsOptional()
  meaning?: string;

  @ApiPropertyOptional({ example: 'noun' })
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

  @ApiPropertyOptional({ example: { synonyms: ['agreement'] } })
  @IsOptional()
  collocations?: any;

  @ApiPropertyOptional({ example: 0 })
  @IsInt()
  @IsOptional()
  order?: number;
}
