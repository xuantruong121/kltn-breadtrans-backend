import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';


export class RegisterDto {
  @ApiProperty({ example: 'student@test.com' })
  @IsEmail({}, { message: 'Invalid email format' })
  email: string;

  @ApiProperty({ example: 'password123' })
  @IsString()
  @IsNotEmpty()
  @MinLength(6, { message: 'Password must be at least 6 characters long' })
  password: string;

  @ApiProperty({ example: 'John Doe' })
  @IsString()
  @IsNotEmpty()
  fullName: string;
}

export class LoginDto {
  @ApiProperty({ example: 'student@test.com' })
  @IsEmail({}, { message: 'Invalid email format' })
  email: string;

  @ApiProperty({ example: 'password123' })
  @IsString()
  @IsNotEmpty()
  password: string;

  @ApiProperty({ example: 'device-uuid-1234', required: false })
  deviceId?: string;
}

export class RefreshTokenDto {
  @ApiProperty({ example: 'device-uuid-1234' })
  @IsString()
  @IsNotEmpty()
  deviceId: string;

  @ApiProperty({ example: 'long-refresh-token' })
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

export class GenerateOtpDto {
  @ApiProperty({ example: 'student@test.com' })
  @IsEmail({}, { message: 'Invalid email format' })
  email: string;
}

export class VerifyOtpDto {
  @ApiProperty({ example: 'student@test.com' })
  @IsEmail({}, { message: 'Invalid email format' })
  email: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @IsNotEmpty()
  otp: string;
}

export class VerifyRegistrationDto {
  @ApiProperty({ example: 'student@test.com' })
  @IsEmail({}, { message: 'Invalid email format' })
  email: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @IsNotEmpty()
  otp: string;
}

export class ChangePasswordDto {
  @ApiProperty({ example: 'temporary-password' })
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @ApiProperty({ example: 'NewStrongPassword123!' })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  newPassword: string;
}

export class GoogleExchangeDto {
  @ApiProperty({ example: 'short-lived-google-login-code' })
  @IsString()
  @IsNotEmpty()
  code: string;
}

export class GoogleLoginDto {
  @ApiProperty({ description: 'Google ID token (credential) từ Google Identity Services' })
  @IsString()
  @IsNotEmpty()
  credential: string;

  @ApiPropertyOptional({ description: 'Mã định danh thiết bị' })
  @IsString()
  @IsOptional()
  deviceId?: string;
}

export class LinkGoogleAccountDto {
  @ApiProperty({ example: 'student@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'MyPassword123' })
  @IsString()
  @IsNotEmpty()
  password: string;

  @ApiProperty({ description: 'Google ID token (credential) từ Google Identity Services' })
  @IsString()
  @IsNotEmpty()
  credential: string;

  @ApiPropertyOptional({ description: 'Mã định danh thiết bị' })
  @IsString()
  @IsOptional()
  deviceId?: string;
}

