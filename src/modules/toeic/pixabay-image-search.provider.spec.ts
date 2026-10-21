import { PixabayImageSearchProvider } from './pixabay-image-search.provider';
import { imageSearchErrorCode } from './image-search-error';

describe('PixabayImageSearchProvider', () => {
  const redis = {
    get: jest.fn(),
    set: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PIXABAY_API_KEY = 'test-key';
    process.env.IMAGE_SEARCH_PROVIDER = 'pixabay';
  });

  it('normalizes a bounded Pixabay response and caches it for 24 hours', async () => {
    (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
      ok: true,
      json: () => ({
        hits: [
          {
            id: 7,
            previewURL: 'https://cdn.pixabay.com/preview.jpg',
            largeImageURL: 'https://cdn.pixabay.com/full.jpg',
            pageURL: 'https://pixabay.com/photos/7',
            imageWidth: 1200,
            imageHeight: 800,
            user: 'author',
            tags: 'office, meeting',
          },
        ],
      }),
    });
    redis.get.mockResolvedValue(null);
    const provider = new PixabayImageSearchProvider(redis as any);

    await expect(
      provider.search('office meeting', { limit: 9 }),
    ).resolves.toEqual([
      expect.objectContaining({
        provider: 'PIXABAY',
        providerAssetId: '7',
        author: 'author',
        tags: ['office', 'meeting'],
      }),
    ]);
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining('pixabay:search:'),
      expect.any(String),
      'EX',
      86400,
    );
  });

  it('classifies a Cloudflare/HTML challenge body on 429 as PROVIDER_BLOCKED, not an ordinary rate limit', async () => {
    (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: () =>
        Promise.resolve(
          '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>Cloudflare</body></html>',
        ),
    });
    const provider = new PixabayImageSearchProvider(redis as any);
    let caught: unknown;
    try {
      await provider.search('office meeting');
    } catch (error) {
      caught = error;
    }
    expect(imageSearchErrorCode(caught)).toBe('PROVIDER_BLOCKED');
  });

  it('classifies an ordinary 429 JSON quota response as PROVIDER_RATE_LIMITED, distinct from a Cloudflare block', async () => {
    (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: () => Promise.resolve('{"error":"quota exceeded"}'),
    });
    const provider = new PixabayImageSearchProvider(redis as any);
    let caught: unknown;
    try {
      await provider.search('office meeting');
    } catch (error) {
      caught = error;
    }
    expect(imageSearchErrorCode(caught)).toBe('PROVIDER_RATE_LIMITED');
  });

  it('classifies a missing API key as PROVIDER_NOT_CONFIGURED', async () => {
    delete process.env.PIXABAY_API_KEY;
    const provider = new PixabayImageSearchProvider(redis as any);
    let caught: unknown;
    try {
      await provider.search('office meeting');
    } catch (error) {
      caught = error;
    }
    expect(imageSearchErrorCode(caught)).toBe('PROVIDER_NOT_CONFIGURED');
  });

  it('rejects non-Pixabay download URLs before making a request', async () => {
    const provider = new PixabayImageSearchProvider(redis as any);
    await expect(
      provider.download({
        provider: 'PIXABAY',
        providerAssetId: '1',
        previewUrl: 'https://cdn.pixabay.com/preview.jpg',
        downloadUrl: 'https://example.com/image.jpg',
        sourcePageUrl: 'https://pixabay.com/photos/1',
        width: 1000,
        height: 700,
        author: 'author',
        tags: [],
        license: 'Pixabay',
      }),
    ).rejects.toThrow('Nguồn tải ảnh không hợp lệ');
  });
});
