import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { BLASTER_STAKES } from '../word-blaster.logic';

export class StartBlasterDto {
  @ApiProperty({
    enum: BLASTER_STAKES,
    example: 20,
    description: 'Số Bánh Mì cược',
  })
  @IsIn([...BLASTER_STAKES])
  stake!: number;
}

export class BlasterShotDto {
  @ApiProperty({ example: 'negotiate', description: 'Đáp án người chơi gõ' })
  @IsString()
  @MaxLength(80)
  text!: string;
}

export class FinishBlasterDto {
  @ApiPropertyOptional({ description: 'true: người chơi thoát, xử thua ngay' })
  @IsOptional()
  @IsBoolean()
  forfeit?: boolean;
}
