import { OpenverseImageSearchProvider } from './openverse-image-search.provider';

describe('OpenverseImageSearchProvider', () => {
  const redis = {
    get: jest.fn(),
    set: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    redis.get.mockResolvedValue(null);
  });

  it('normalizes permissive Openverse results and uses a provider proxy', async () => {
    (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
      ok: true,
      json: () => ({
        results: [
          {
            id: 'openverse-1',
            title: 'Office meeting',
            thumbnail: 'https://api.openverse.org/v1/images/openverse-1/thumb/',
            url: 'https://upstream.example/full.jpg',
            foreign_landing_url: 'https://flickr.com/photo/1',
            creator: 'A. Creator',
            creator_url: 'https://flickr.com/creator',
            license: 'by',
            license_version: '2.0',
            license_url: 'https://creativecommons.org/licenses/by/2.0/',
            provider: 'flickr',
            source: 'flickr',
            attribution: 'Office meeting by A. Creator',
            width: 1200,
            height: 800,
            mature: false,
            tags: [{ name: 'meeting' }],
          },
          {
            id: 'openverse-2',
            thumbnail: 'https://api.openverse.org/v1/images/openverse-2/thumb/',
            foreign_landing_url: 'https://flickr.com/photo/2',
            license: 'by-nc',
            mature: false,
          },
        ],
      }),
    });
    const provider = new OpenverseImageSearchProvider(redis as any);

    await expect(
      provider.search('office meeting', { limit: 5 }),
    ).resolves.toEqual([
      expect.objectContaining({
        provider: 'OPENVERSE',
        providerAssetId: 'openverse-1',
        downloadUrl: 'https://api.openverse.org/v1/images/openverse-1/thumb/',
        source: 'flickr',
        license: 'by',
        licenseVersion: '2.0',
        author: 'A. Creator',
        tags: ['meeting'],
      }),
    ]);
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining('openverse:search:'),
      expect.any(String),
      'EX',
      86400,
    );
    expect((global.fetch as jest.Mock).mock.calls[0][0].toString()).toContain(
      'license=cc0%2Cby%2Cpdm',
    );
  });

  it('rejects downloads outside the Openverse proxy host', async () => {
    const provider = new OpenverseImageSearchProvider(redis as any);
    await expect(
      provider.download({
        provider: 'OPENVERSE',
        providerAssetId: '1',
        previewUrl: 'https://api.openverse.org/v1/images/1/thumb/',
        downloadUrl: 'https://example.com/image.jpg',
        sourcePageUrl: 'https://flickr.com/photo/1',
        width: 1000,
        height: 700,
        author: 'author',
        tags: [],
        license: 'by',
      }),
    ).rejects.toThrow('Nguồn tải ảnh Openverse không hợp lệ');
  });
});
