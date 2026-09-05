import { getJwtSecret, getOtpSecret } from './auth.constants';

describe('auth.constants fail-fast security tests', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should throw an error in production if JWT_SECRET is missing', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;
    expect(() => getJwtSecret()).toThrow(
      '[Security] JWT_SECRET is mandatory in production environment.',
    );
  });

  it('should return secret when JWT_SECRET is provided in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'prod-jwt-secret-xyz';
    expect(getJwtSecret()).toBe('prod-jwt-secret-xyz');
  });

  it('should return fallback secret in non-production when JWT_SECRET is missing', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.JWT_SECRET;
    expect(getJwtSecret()).toBe(
      'dev-insecure-jwt-secret-do-not-use-in-production',
    );
  });

  it('should throw an error in production if OTP_SECRET is missing', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.OTP_SECRET;
    expect(() => getOtpSecret()).toThrow(
      '[Security] OTP_SECRET is mandatory in production environment.',
    );
  });

  it('should return secret when OTP_SECRET is provided in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.OTP_SECRET = 'prod-otp-secret-xyz';
    expect(getOtpSecret()).toBe('prod-otp-secret-xyz');
  });
});
