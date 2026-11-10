import { createSecretKey, type KeyObject } from 'crypto';

export const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '[Security] JWT_SECRET is mandatory in production environment.',
      );
    }
    return 'dev-insecure-jwt-secret-do-not-use-in-production';
  }
  return secret;
};

let verificationKey: { secret: string; key: KeyObject } | null = null;

/**
 * The access-token secret as a KeyObject, built once. Given a string,
 * jsonwebtoken 9 first tries createPublicKey() on it for every token it
 * verifies; that failing attempt was 18% of the API's CPU under load
 * (capacity profile, 2026-11-09). A KeyObject skips it. Same secret, same
 * tokens accepted.
 */
export const getJwtVerificationKey = (): KeyObject => {
  const secret = getJwtSecret();
  if (verificationKey?.secret !== secret)
    verificationKey = {
      secret,
      key: createSecretKey(Buffer.from(secret, 'utf8')),
    };
  return verificationKey.key;
};

export const getOtpSecret = (): string => {
  const secret = process.env.OTP_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '[Security] OTP_SECRET is mandatory in production environment.',
      );
    }
    return 'dev-insecure-otp-secret-do-not-use-in-production';
  }
  return secret;
};
