import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@prisma/client';

export class CreateUserDto {
  @ApiProperty({ example: 'student@example.com' })
  @IsEmail({}, { message: 'Email không hợp lệ.' })
  email: string;

  @ApiProperty({ example: 'password123', minLength: 6 })
  @IsString({ message: 'Mật khẩu phải là chuỗi.' })
  @MinLength(6, { message: 'Mật khẩu phải có ít nhất 6 ký tự.' })
  password: string;

  @ApiProperty({ enum: Role, example: Role.STUDENT })
  @IsEnum(Role, { message: 'Vai trò người dùng không hợp lệ.' })
  role: Role;

  @ApiProperty({ example: 'Nguyễn Văn A' })
  @IsString({ message: 'Họ và tên phải là chuỗi.' })
  fullName: string;

  @ApiPropertyOptional({ example: '0912345678' })
  @IsOptional()
  @IsString()
  phone?: string;
}

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'Nguyễn Văn B' })
  @IsOptional()
  @IsString({ message: 'Họ và tên phải là chuỗi.' })
  fullName?: string;

  @ApiPropertyOptional({ example: '0987654321' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ enum: Role, example: Role.STUDENT })
  @IsOptional()
  @IsEnum(Role, { message: 'Vai trò không hợp lệ.' })
  role?: Role;

  @ApiPropertyOptional({ example: 'newpassword123', minLength: 6 })
  @IsOptional()
  @IsString({ message: 'Mật khẩu mới phải là chuỗi.' })
  @MinLength(6, { message: 'Mật khẩu mới phải có ít nhất 6 ký tự.' })
  password?: string;
}
