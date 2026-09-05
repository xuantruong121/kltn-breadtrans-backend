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
