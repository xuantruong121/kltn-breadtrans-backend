import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

/** Fields an admin sets on a dictionary entry. */
export class CreateDictionaryEntryDto {
  @ApiProperty({ example: 'agenda' })
  @IsString()
  @IsNotEmpty()
  word: string;

  @ApiPropertyOptional({ example: 'noun' })
  @IsString()
  @IsOptional()
  pos?: string;

  @ApiProperty({ example: 'chương trình họp' })
  @IsString()
  @IsNotEmpty()
  meaning: string;

  @ApiPropertyOptional({ example: 'a list of matters to be discussed' })
  @IsString()
  @IsOptional()
  definitionEn?: string;

  @ApiPropertyOptional({ example: '/əˈdʒendə/' })
  @IsString()
  @IsOptional()
  ipaUs?: string;

  @ApiPropertyOptional({ example: '/əˈdʒendə/' })
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

  @ApiPropertyOptional({ example: 'The agenda is on the table.' })
  @IsString()
  @IsOptional()
  exampleEn?: string;

  @ApiPropertyOptional({ example: 'Chương trình họp ở trên bàn.' })
  @IsString()
  @IsOptional()
  exampleVi?: string;

  @ApiPropertyOptional({
    example: [{ phrase: 'set the agenda', meaningVi: 'đặt chương trình' }],
  })
  @IsOptional()
  collocations?: unknown;
}

export class UpdateDictionaryEntryDto extends PartialType(
  CreateDictionaryEntryDto,
) {}
