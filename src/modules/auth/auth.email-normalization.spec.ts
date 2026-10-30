import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { AuthService } from './auth.service';
import {
  ForgotPasswordDto,
  GenerateOtpDto,
  LinkGoogleAccountDto,
  LoginDto,
  RegisterDto,
  VerifyOtpDto,
} from './dto/auth.dto';

/**
 * One account per e-mail regardless of case or surrounding spaces: the API
 * normalises before validation (as the global ValidationPipe does with
 * transform: true), and the Google path stores the same key.
 */
describe('auth e-mail normalisation', () => {
  const RAW = '  Student.Name@Example.COM ';
  const KEY = 'student.name@example.com';

  it.each([
    [RegisterDto, { email: RAW, password: 'password123', fullName: 'A B' }],
    [LoginDto, { email: RAW, password: 'password123' }],
    [GenerateOtpDto, { email: RAW }],
    [VerifyOtpDto, { email: RAW, otp: '123456' }],
    [ForgotPasswordDto, { email: RAW }],
    [
      LinkGoogleAccountDto,
      { email: RAW, password: 'password123', credential: 'x' },
    ],
  ])(
    '%p trims and lowercases the e-mail before validating it',
    async (Dto, body) => {
      const dto: { email: string } = plainToInstance(Dto as any, body);
      expect(dto.email).toBe(KEY);
      const errors = await validate(dto as object);
      expect(errors.filter((e) => e.property === 'email')).toEqual([]);
    },
  );

  it('a non-string e-mail is left to the validator', async () => {
    const dto = plainToInstance(LoginDto, { email: 42, password: 'x' });
    expect(dto.email).toBe(42);
    expect((await validate(dto)).some((e) => e.property === 'email')).toBe(
      true,
    );
  });

  it('a Google sign-in looks up and creates the account by the normalised e-mail', async () => {
    const prisma: any = {
      authAccount: { findUnique: jest.fn().mockResolvedValue(null) },
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn((args: any) =>
          Promise.resolve({ id: 1, ...args.data }),
        ),
      },
    };
    const service: any = new AuthService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
    );
    await service.resolveGoogleUser({
      providerId: 'g-1',
      email: 'Student.Name@Example.COM',
      fullName: 'A B',
      avatar: null,
    });
    expect(prisma.user.findUnique.mock.calls[0][0].where.email).toBe(KEY);
    expect(prisma.user.create.mock.calls[0][0].data.email).toBe(KEY);
  });
});
