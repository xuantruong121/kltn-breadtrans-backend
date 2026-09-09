import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-google-oauth20';

export type GoogleProfile = {
  providerId: string;
  email: string;
  fullName: string;
  avatar: string | null;
};

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor() {
    super({
      clientID: process.env.GOOGLE_CLIENT_ID || 'google-oauth-not-configured',
      clientSecret:
        process.env.GOOGLE_CLIENT_SECRET || 'google-oauth-not-configured',
      callbackURL:
        process.env.GOOGLE_CALLBACK_URL ||
        'http://localhost:3001/auth/google/callback',
      scope: ['openid', 'email', 'profile'],
      passReqToCallback: false,
    });
  }

  isConfigured() {
    return Boolean(
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
    );
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
  ): GoogleProfile {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('Google Login chưa được cấu hình.');
    }
    const email = profile.emails?.[0]?.value?.trim().toLowerCase();
    if (!email)
      throw new ServiceUnavailableException(
        'Google không trả về email hợp lệ.',
      );
    return {
      providerId: profile.id,
      email,
      fullName: profile.displayName || email.split('@')[0],
      avatar: profile.photos?.[0]?.value || null,
    };
  }
}
