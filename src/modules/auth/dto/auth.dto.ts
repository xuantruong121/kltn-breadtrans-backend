import {
  Equals,
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { NewPassword } from '../password-policy';

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

  @NewPassword()
  password: string;

  @ApiProperty({ example: 'John Doe' })
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @ApiProperty({
    example: true,
    description:
      'Đồng ý Điều khoản sử dụng và Chính sách bảo mật; ô không được tick sẵn.',
  })
  @Equals(true, {
    message:
      'Bạn cần đồng ý với Điều khoản sử dụng và Chính sách bảo mật để tạo tài khoản.',
  })
  acceptTerms: boolean;
}

/** Consent given later: an older account, or a new version of the documents. */
export class AcceptConsentDto {
  @ApiProperty({ example: true })
  @Equals(true, {
    message: 'Hãy tick ô đồng ý để tiếp tục.',
  })
  acceptTerms: boolean;
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

  /** Keep the refresh cookie after the browser closes (30 days). */
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
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

  @NewPassword()
  newPassword: string;
}

/** Read-only check of a reset link: no password, and the token is not used up. */
export class CheckResetTokenDto {
  @ApiProperty({ example: 'one-time-reset-token' })
  @IsString()
  @IsNotEmpty()
  // A real token is 64 hex characters; the cap keeps a huge body from being hashed.
  @MaxLength(256)
  token: string;
}

export class ChangePasswordDto {
  @ApiProperty({ example: 'temporary-password' })
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập mật khẩu hiện tại.' })
  currentPassword: string;

  @IsNotEmpty({ message: 'Vui lòng nhập mật khẩu mới.' })
  @NewPassword()
  newPassword: string;
}

export class GoogleExchangeDto {
  @ApiProperty({ example: 'short-lived-google-login-code' })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiPropertyOptional({
    description:
      'Bắt buộc khi Google đăng nhập lần đầu (tạo tài khoản): đồng ý điều khoản.',
  })
  @IsOptional()
  @IsBoolean()
  acceptTerms?: boolean;
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

  @ApiPropertyOptional({
    description:
      'Bắt buộc khi Google đăng nhập lần đầu (tạo tài khoản): đồng ý điều khoản.',
  })
  @IsOptional()
  @IsBoolean()
  acceptTerms?: boolean;
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
