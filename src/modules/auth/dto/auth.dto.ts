import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

/**
 * Accounts are keyed by e-mail; the API stores and looks it up trimmed and
 * lower-case so "A@b.com" and "a@b.com " are one account (the web client
 * already lowercases; other clients must not create a second account).
 */
export const NormalizeEmail = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  );

export class RegisterDto {
  @ApiProperty({ example: 'student@test.com' })
  @IsEmail({}, { message: 'Email không đúng định dạng.' })
  @NormalizeEmail()
  email: string;

  @ApiProperty({ example: 'password123' })
  @IsString()
  @IsNotEmpty()
  @MinLength(6, { message: 'Mật khẩu phải có ít nhất 6 ký tự.' })
  password: string;

  @ApiProperty({ example: 'John Doe' })
  @IsString()
  @IsNotEmpty()
  fullName: string;
}

export class LoginDto {
  @ApiProperty({ example: 'student@test.com' })
  @IsEmail({}, { message: 'Email không đúng định dạng.' })
  @NormalizeEmail()
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
  @IsEmail({}, { message: 'Email không đúng định dạng.' })
  @NormalizeEmail()
  email: string;
}

export class VerifyOtpDto {
  @ApiProperty({ example: 'student@test.com' })
  @IsEmail({}, { message: 'Email không đúng định dạng.' })
  @NormalizeEmail()
  email: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @IsNotEmpty()
  otp: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'student@test.com' })
  @IsEmail({}, { message: 'Email không đúng định dạng.' })
  @NormalizeEmail()
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty({ example: 'one-time-reset-token' })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({ example: 'NewStrongPassword123!', minLength: 8 })
  @IsString()
  @IsNotEmpty()
  @MinLength(8, { message: 'Mật khẩu phải có ít nhất 8 ký tự.' })
  newPassword: string;
}

export class ChangePasswordDto {
  @ApiProperty({ example: 'temporary-password' })
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập mật khẩu hiện tại.' })
  currentPassword: string;

  @ApiProperty({ example: 'NewStrongPassword123!' })
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập mật khẩu mới.' })
  @MinLength(8, { message: 'Mật khẩu mới cần có ít nhất 8 ký tự.' })
  newPassword: string;
}

export class GoogleExchangeDto {
  @ApiProperty({ example: 'short-lived-google-login-code' })
  @IsString()
  @IsNotEmpty()
  code: string;
}

export class GoogleLoginDto {
  @ApiProperty({
    description: 'Google ID token (credential) từ Google Identity Services',
  })
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
  @NormalizeEmail()
  email: string;

  @ApiProperty({ example: 'MyPassword123' })
  @IsString()
  @IsNotEmpty()
  password: string;

  @ApiProperty({
    description: 'Google ID token (credential) từ Google Identity Services',
  })
  @IsString()
  @IsNotEmpty()
  credential: string;

  @ApiPropertyOptional({ description: 'Mã định danh thiết bị' })
  @IsString()
  @IsOptional()
  deviceId?: string;
}
