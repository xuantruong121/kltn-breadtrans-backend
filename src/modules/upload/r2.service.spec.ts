import { BadRequestException } from '@nestjs/common';
import { R2Service } from './r2.service';

describe('R2Service premium media boundary', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('rejects a premium key through the public URL builder', () => {
    process.env.R2_PUBLIC_URL = 'https://public.example';
    const service = new R2Service();

    expect(() =>
      service.getPublicAssetUrl('premium/listening/quiz-1.mp3'),
    ).toThrow(BadRequestException);
    expect(() =>
      service.getPublicAssetUrl('premium/speaking/exercise-1.mp3'),
    ).toThrow(BadRequestException);
  });

  it('fails closed when the private bucket is not configured', () => {
    delete process.env.R2_PRIVATE_BUCKET_NAME;
    delete process.env.R2_PRIVATE_ENDPOINT;
    delete process.env.R2_PRIVATE_ACCESS_KEY_ID;
    delete process.env.R2_PRIVATE_SECRET_ACCESS_KEY;
    const service = new R2Service();

    expect(service.isPrivateStorageConfigured()).toBe(false);
  });

  it('recognizes a separately configured private bucket without making it public', () => {
    process.env.R2_ACCOUNT_ID = 'test-account';
    process.env.R2_ACCESS_KEY_ID = 'public-key';
    process.env.R2_SECRET_ACCESS_KEY = 'public-secret';
    process.env.R2_PUBLIC_URL = 'https://public.example';
    process.env.R2_PRIVATE_BUCKET_NAME = 'premium-private';
    process.env.R2_PRIVATE_ACCESS_KEY_ID = 'private-key';
    process.env.R2_PRIVATE_SECRET_ACCESS_KEY = 'private-secret';

    const service = new R2Service();

    expect(service.isPrivateStorageConfigured()).toBe(true);
    expect(() =>
      service.getPublicAssetUrl('premium/listening/quiz-1.mp3'),
    ).toThrow(BadRequestException);
  });
});
