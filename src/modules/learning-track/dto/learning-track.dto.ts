import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateLearningTrackDto {
  @ApiProperty({ example: 'Y tế – Điều dưỡng', maxLength: 80 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({
    example: 'Y_TE_DIEU_DUONG',
    description:
      'Bỏ trống để tạo từ tên. Được chuẩn hoá thành chữ in hoa không dấu, số và dấu gạch dưới, tối đa 40 ký tự; không đổi được sau khi tạo.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  code?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class UpdateLearningTrackDto {
  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({
    maxLength: 500,
    description: 'Chuỗi rỗng để xoá mô tả',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    description:
      'Không đổi được. Gửi một mã khác mã hiện tại thì bị từ chối (409).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  code?: string;
}

export class ReorderLearningTracksDto {
  @ApiProperty({
    type: [String],
    example: ['IT_SOFTWARE', 'OFFICE_BUSINESS', 'GENERAL'],
    description: 'Mọi mã lĩnh vực (cả lĩnh vực đã tắt), mỗi mã đúng một lần',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  codes!: string[];
}
