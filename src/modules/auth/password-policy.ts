import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * New passwords (owner 2026-11-14, NIST SP 800-63B-4): at least 15
 * characters when a password is the only factor, no composition rules, long
 * passphrases allowed. Existing shorter passwords still sign in; the rule
 * applies when a password is set.
 */
export const PASSWORD_MIN_LENGTH = 15;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_LENGTH_MESSAGE = `Mật khẩu cần ít nhất ${PASSWORD_MIN_LENGTH} ký tự (có thể là một cụm từ dễ nhớ).`;

/** The validation of every newly chosen password. */
export const NewPassword = (example = 'mot cum tu de nho 2026') =>
  applyDecorators(
    ApiProperty({
      example,
      minLength: PASSWORD_MIN_LENGTH,
      maxLength: PASSWORD_MAX_LENGTH,
    }),
    IsString({ message: 'Mật khẩu phải là chuỗi.' }),
    MinLength(PASSWORD_MIN_LENGTH, { message: PASSWORD_LENGTH_MESSAGE }),
    MaxLength(PASSWORD_MAX_LENGTH, {
      message: `Mật khẩu tối đa ${PASSWORD_MAX_LENGTH} ký tự.`,
    }),
  );
