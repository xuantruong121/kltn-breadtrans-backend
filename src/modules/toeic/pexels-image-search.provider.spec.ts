import { PexelsImageSearchProvider } from './pexels-image-search.provider';
import { imageSearchErrorCode } from './image-search-error';

describe('PexelsImageSearchProvider', () => {
  const redis = { get: jest.fn(), set: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PEXELS_API_KEY = 'test-key';
    redis.get.mockResolvedValue(null);
  });

  it('classifies a missing PEXELS_API_KEY as PROVIDER_NOT_CONFIGURED instead of failing the whole search', async () => {
    delete process.env.PEXELS_API_KEY;
    const provider = new PexelsImageSearchProvider(redis as any);
    let caught: unknown;
    try {
      await provider.search('people greeting');
    } catch (error) {
      caught = error;
    }
    expect(imageSearchErrorCode(caught)).toBe('PROVIDER_NOT_CONFIGURED');
  });

  it('normalizes a bounded Pexels response, preserving photographer attribution, and caches it for 24 hours', async () => {
    (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
      ok: true,
      json: () => ({
        photos: [
          {
            id: 42,
            width: 1200,
            height: 800,
            url: 'https://www.pexels.com/photo/42/',
            photographer: 'Jane Doe',
            photographer_url: 'https://www.pexels.com/@janedoe',
            alt: 'two people greeting',
            src: {
              medium: 'https://images.pexels.com/photos/42/medium.jpg',
              large: 'https://images.pexels.com/photos/42/large.jpg',
            },
          },
        ],
      }),
    });
    const provider = new PexelsImageSearchProvider(redis as any);
    await expect(provider.search('people greeting')).resolves.toEqual([
      expect.objectContaining({
        provider: 'PEXELS',
        providerAssetId: '42',
        author: 'Jane Doe',
        attribution: 'Photo by Jane Doe on Pexels',
      }),
    ]);
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining('pexels:search:'),
      expect.any(String),
      'EX',
      86400,
    );
  });

  it('classifies a Cloudflare/HTML challenge body as PROVIDER_BLOCKED', async () => {
    (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: () =>
        Promise.resolve('<!DOCTYPE html><html>Just a moment...</html>'),
    });
    const provider = new PexelsImageSearchProvider(redis as any);
    let caught: unknown;
    try {
      await provider.search('people greeting');
    } catch (error) {
      caught = error;
    }
    expect(imageSearchErrorCode(caught)).toBe('PROVIDER_BLOCKED');
  });

  it('rejects a candidate whose download URL is not on images.pexels.com', async () => {
    const provider = new PexelsImageSearchProvider(redis as any);
    await expect(
      provider.download({
        provider: 'PEXELS',
        providerAssetId: '1',
        previewUrl: 'https://images.pexels.com/photos/1/medium.jpg',
        downloadUrl: 'https://evil.example.com/image.jpg',
        sourcePageUrl: 'https://www.pexels.com/photo/1/',
        width: 800,
        height: 600,
        author: 'author',
        tags: [],
        license: 'Pexels License',
      }),
    ).rejects.toThrow('Nguồn tải ảnh Pexels không hợp lệ');
  });
});
