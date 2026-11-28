import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  MaxLength,
  registerDecorator,
  type ValidationArguments,
} from 'class-validator';

/**
 * New passwords (owner 2026-11-28, replacing the 2026-11-14 rule of 15
 * characters and no composition rules): at least 8 characters with an upper
 * case letter, a digit and a special character. Existing passwords still sign
 * in; the rule applies when a password is set.
 *
 * Mirrored by the frontend's lib/auth/passwordPolicy.ts: keep the two in step.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

const UPPERCASE = /\p{Lu}/u;
const DIGIT = /[0-9]/;
/** Punctuation and symbols; a space or a Vietnamese letter is not special. */
const SPECIAL = /[\p{P}\p{S}]/u;

/** What a candidate password still lacks, in the words the messages use. */
export function passwordMissing(password: string): string[] {
  const missing: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH)
    missing.push(`đủ ${PASSWORD_MIN_LENGTH} ký tự`);
  if (!UPPERCASE.test(password)) missing.push('chữ hoa');
  if (!DIGIT.test(password)) missing.push('số');
  if (!SPECIAL.test(password)) missing.push('ký tự đặc biệt');
  return missing;
}

export const PASSWORD_RULE_MESSAGE = `Mật khẩu cần ít nhất ${PASSWORD_MIN_LENGTH} ký tự, gồm chữ hoa, số và ký tự đặc biệt.`;

/** The message for a new password that breaks the policy, or null. */
export function passwordProblem(password: string): string | null {
  const missing = passwordMissing(password);
  if (!missing.length) return null;
  return `${PASSWORD_RULE_MESSAGE.slice(0, -1)} (còn thiếu: ${missing.join(', ')}).`;
}

function PasswordComplexity() {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'newPasswordComplexity',
      target: object.constructor,
      propertyName,
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && passwordProblem(value) === null,
        defaultMessage: (args: ValidationArguments) =>
          typeof args.value === 'string'
            ? (passwordProblem(args.value) ?? PASSWORD_RULE_MESSAGE)
            : PASSWORD_RULE_MESSAGE,
      },
    });
}

/** The validation of every newly chosen password. */
export const NewPassword = (example = 'BanhMi@2026') =>
  applyDecorators(
    ApiProperty({
      example,
      minLength: PASSWORD_MIN_LENGTH,
      maxLength: PASSWORD_MAX_LENGTH,
      description: PASSWORD_RULE_MESSAGE,
    }),
    IsString({ message: 'Mật khẩu phải là chuỗi.' }),
    PasswordComplexity(),
    MaxLength(PASSWORD_MAX_LENGTH, {
      message: `Mật khẩu tối đa ${PASSWORD_MAX_LENGTH} ký tự.`,
    }),
  );
