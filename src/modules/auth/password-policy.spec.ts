import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateUserDto, UpdateUserDto } from '../admin/dto/admin-user.dto';
import {
  ChangePasswordDto,
  RegisterDto,
  ResetPasswordDto,
} from './dto/auth.dto';
import {
  PASSWORD_RULE_MESSAGE,
  passwordMissing,
  passwordProblem,
} from './password-policy';

const errorsOf = async (cls: any, value: Record<string, unknown>) =>
  (await validate(plainToInstance(cls, value))).flatMap((e) =>
    Object.values(e.constraints ?? {}),
  );

describe('passwordMissing (owner 2026-11-28: 8 characters, upper case, digit, special)', () => {
  it.each([
    ['Abcdef1!', []],
    ['Password123!', []],
    ['BanhMi@2026', []],
    ['ABCDEFG1!', []], // no lower case is required
    ['Đẹp1234!', []], // a Vietnamese capital counts
    ['Abcdefg1', ['ký tự đặc biệt']],
    ['Abcdefg!', ['số']],
    ['abcdefg1!', ['chữ hoa']],
    ['abcdefgh', ['chữ hoa', 'số', 'ký tự đặc biệt']],
    ['Ab1!', ['đủ 8 ký tự']],
    ['Abcdefg 1', ['ký tự đặc biệt']], // a space is not special
    ['Mậtkhẩu1', ['ký tự đặc biệt']], // accented letters are not special
    ['', ['đủ 8 ký tự', 'chữ hoa', 'số', 'ký tự đặc biệt']],
  ])('%s lacks %j', (password, missing) => {
    expect(passwordMissing(password)).toEqual(missing);
  });

  it('counts a symbol such as $ + = ~ as special', () => {
    for (const ch of ['$', '+', '=', '~', '^', '|', '<', '€'])
      expect(passwordMissing(`Abcdefg1${ch}`)).toEqual([]);
  });

  it('exactly 8 characters pass, 7 do not', () => {
    expect(passwordProblem('Abcde1!x')).toBeNull();
    expect(passwordProblem('Abcd1!x')).toContain('đủ 8 ký tự');
  });

  it('the message names the rule and what is missing', () => {
    expect(passwordProblem('abcdefgh')).toBe(
      'Mật khẩu cần ít nhất 8 ký tự, gồm chữ hoa, số và ký tự đặc biệt (còn thiếu: chữ hoa, số, ký tự đặc biệt).',
    );
    expect(passwordProblem('Abcdefg1!')).toBeNull();
  });
});

describe('new password policy on the DTOs', () => {
  const weak = 'abcdefgh';
  const ok = 'Abcdef1!';

  it('applies to register, reset, change and admin-set passwords', async () => {
    const cases: Array<[any, Record<string, unknown>, string]> = [
      [
        RegisterDto,
        { email: 'a@b.vn', fullName: 'A', acceptTerms: true },
        'password',
      ],
      [ResetPasswordDto, { token: 't' }, 'newPassword'],
      [ChangePasswordDto, { currentPassword: 'x' }, 'newPassword'],
      [
        CreateUserDto,
        { email: 'a@b.vn', role: 'STUDENT', fullName: 'A' },
        'password',
      ],
      [UpdateUserDto, {}, 'password'],
    ];
    for (const [cls, base, field] of cases) {
      const errors = await errorsOf(cls, { ...base, [field]: weak });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain(PASSWORD_RULE_MESSAGE.slice(0, -1));
      expect(errors[0]).toContain('còn thiếu: chữ hoa, số, ký tự đặc biệt');
      expect(await errorsOf(cls, { ...base, [field]: ok })).toEqual([]);
    }
  });

  it('a password that only lacks a digit is told so', async () => {
    const errors = await errorsOf(ResetPasswordDto, {
      token: 't',
      newPassword: 'Abcdefg!',
    });
    expect(errors).toEqual([
      'Mật khẩu cần ít nhất 8 ký tự, gồm chữ hoa, số và ký tự đặc biệt (còn thiếu: số).',
    ]);
  });

  it('allows a long password with all three parts and refuses over 128 characters', async () => {
    expect(
      await errorsOf(ChangePasswordDto, {
        currentPassword: 'x',
        newPassword: `A1!${'a'.repeat(125)}`,
      }),
    ).toEqual([]);
    expect(
      await errorsOf(ChangePasswordDto, {
        currentPassword: 'x',
        newPassword: `A1!${'a'.repeat(126)}`,
      }),
    ).toEqual(['Mật khẩu tối đa 128 ký tự.']);
  });

  it('a non-string password is refused', async () => {
    expect(
      (await errorsOf(ResetPasswordDto, { token: 't', newPassword: 12345678 }))
        .length,
    ).toBeGreaterThan(0);
  });

  it('an admin edit without a password stays valid', async () => {
    expect(await errorsOf(UpdateUserDto, { fullName: 'B' })).toEqual([]);
  });

  it('the demo password Password123! stays valid', async () => {
    expect(
      await errorsOf(ResetPasswordDto, {
        token: 't',
        newPassword: 'Password123!',
      }),
    ).toEqual([]);
  });
});
