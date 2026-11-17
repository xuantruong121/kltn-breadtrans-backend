import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateUserDto, UpdateUserDto } from '../admin/dto/admin-user.dto';
import {
  ChangePasswordDto,
  RegisterDto,
  ResetPasswordDto,
} from './dto/auth.dto';
import { PASSWORD_LENGTH_MESSAGE } from './password-policy';

const errorsOf = async (cls: any, value: Record<string, unknown>) =>
  (await validate(plainToInstance(cls, value))).flatMap((e) =>
    Object.values(e.constraints ?? {}),
  );

describe('new password policy (NIST: at least 15 characters)', () => {
  const short = 'a'.repeat(14);
  const ok = 'mot cum tu de nho';

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
      expect(await errorsOf(cls, { ...base, [field]: short })).toContain(
        PASSWORD_LENGTH_MESSAGE,
      );
      expect(await errorsOf(cls, { ...base, [field]: ok })).toEqual([]);
    }
  });

  it('allows long passphrases and refuses over 128 characters', async () => {
    expect(
      await errorsOf(ChangePasswordDto, {
        currentPassword: 'x',
        newPassword: 'a'.repeat(128),
      }),
    ).toEqual([]);
    expect(
      (
        await errorsOf(ChangePasswordDto, {
          currentPassword: 'x',
          newPassword: 'a'.repeat(129),
        })
      ).length,
    ).toBe(1);
  });

  it('an admin edit without a password stays valid', async () => {
    expect(await errorsOf(UpdateUserDto, { fullName: 'B' })).toEqual([]);
  });
});
