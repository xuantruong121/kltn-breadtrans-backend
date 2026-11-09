import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DUNGEON_MODES, TOPPING_IDS } from '../dungeon.logic';
import type { DungeonMode, ToppingId } from '../dungeon.logic';

export class StartDungeonDto {
  @ApiProperty({
    enum: DUNGEON_MODES,
    example: 'daily',
    description: 'daily: Hầm hôm nay (một lượt mỗi ngày); free: Hầm tự do',
  })
  @IsIn([...DUNGEON_MODES])
  mode!: DungeonMode;
}

export class DungeonAnswerDto {
  @ApiPropertyOptional({
    example: 2,
    description: 'Vị trí đáp án đã chọn (0–3), câu trắc nghiệm',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3)
  choice?: number;

  @ApiPropertyOptional({
    example: 'negotiate',
    description: 'Từ đã gõ, câu của boss',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  text?: string;
}

export class DungeonPickDto {
  @ApiProperty({
    enum: TOPPING_IDS,
    example: 'garlic_butter',
    description: 'Topping chọn sau khi qua tầng',
  })
  @IsIn(TOPPING_IDS)
  topping!: ToppingId;
}

export class FinishDungeonDto {
  @ApiPropertyOptional({
    description: 'true: rời hầm, chốt lượt ở tầng hiện tại',
  })
  @IsOptional()
  @IsBoolean()
  forfeit?: boolean;
}
