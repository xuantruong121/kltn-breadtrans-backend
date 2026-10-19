import { WikimediaCommonsImageSearchProvider } from './wikimedia-commons-image-search.provider';

describe('WikimediaCommonsImageSearchProvider', () => {
  const redis = {
    get: jest.fn(),
    set: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('normalizes one licensed Commons image and caches the result', async () => {
    redis.get.mockResolvedValue(null);
    (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
      ok: true,
      json: () => ({
        query: {
          pages: [
            {
              pageid: 42,
              title: 'File:Office meeting.jpg',
              imageinfo: [
                {
                  thumburl: 'https://upload.wikimedia.org/thumb.jpg',
                  descriptionurl:
                    'https://commons.wikimedia.org/wiki/File:Office_meeting.jpg',
                  mime: 'image/jpeg',
                  thumbwidth: 960,
                  thumbheight: 640,
                  extmetadata: {
                    Artist: { value: '<b>Jane Doe</b>' },
                    LicenseShortName: { value: 'CC BY 4.0' },
                    LicenseUrl: {
                      value: 'https://creativecommons.org/licenses/by/4.0/',
                    },
                    Credit: { value: 'Jane Doe / Wikimedia Commons' },
                  },
                },
              ],
            },
          ],
        },
      }),
    });

    const provider = new WikimediaCommonsImageSearchProvider(redis as any);
    await expect(
      provider.search('office meeting', { limit: 9 }),
    ).resolves.toEqual([
      expect.objectContaining({
        provider: 'WIKIMEDIA_COMMONS',
        providerAssetId: '42',
        author: 'Jane Doe',
        license: 'CC BY 4.0',
        width: 960,
        height: 640,
      }),
    ]);
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining('wikimedia:search:'),
      expect.any(String),
      'EX',
      86400,
    );
    expect(
      (global.fetch as jest.Mock).mock.calls[0][1].headers['User-Agent'],
    ).toContain('BreadTrans/1.0');
  });

  it('rejects unclear or restrictive licenses', async () => {
    redis.get.mockResolvedValue(null);
    (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
      ok: true,
      json: () => ({
        query: {
          pages: [
            {
              pageid: 43,
              title: 'File:Restricted.jpg',
              imageinfo: [
                {
                  thumburl: 'https://upload.wikimedia.org/restricted.jpg',
                  mime: 'image/jpeg',
                  thumbwidth: 960,
                  thumbheight: 640,
                  extmetadata: {
                    LicenseShortName: { value: 'CC BY-SA 4.0' },
                  },
                },
              ],
            },
          ],
        },
      }),
    });

    const provider = new WikimediaCommonsImageSearchProvider(redis as any);
    await expect(provider.search('office meeting')).resolves.toEqual([]);
  });

  it('downloads only from trusted Wikimedia media hosts', async () => {
    const provider = new WikimediaCommonsImageSearchProvider(redis as any);
    const candidate = {
      provider: 'WIKIMEDIA_COMMONS' as const,
      providerAssetId: '42',
      previewUrl: 'https://upload.wikimedia.org/thumb.jpg',
      downloadUrl: 'https://upload.wikimedia.org/full.jpg',
      sourcePageUrl: 'https://commons.wikimedia.org/wiki/File:Office.jpg',
      width: 960,
      height: 640,
      author: 'Jane Doe',
      tags: ['office'],
      license: 'CC BY 4.0',
    };
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
    (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: (name: string) => (name === 'content-type' ? 'image/jpeg' : null),
      },
      arrayBuffer: () => Promise.resolve(bytes.buffer),
    });

    await expect(provider.download(candidate)).resolves.toMatchObject({
      mimeType: 'image/jpeg',
      width: 960,
      height: 640,
    });
    await expect(
      provider.download({
        ...candidate,
        downloadUrl: 'https://example.com/image.jpg',
      }),
    ).rejects.toThrow('Nguồn tải ảnh Wikimedia không hợp lệ');
  });
});
