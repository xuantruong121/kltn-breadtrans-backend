import { ServiceUnavailableException } from '@nestjs/common';
import { ImageSearchProviderChain } from './image-search.provider-chain';
import { ImageSearchCandidate } from './pixabay-image-search.provider';

const candidate = (provider: ImageSearchCandidate['provider']) => ({
  provider,
  providerAssetId: '1',
  previewUrl: 'https://example.com/preview.jpg',
  downloadUrl: 'https://example.com/image.jpg',
  sourcePageUrl: 'https://example.com/source',
  width: 1200,
  height: 800,
  author: 'author',
  tags: [],
  license: 'by',
});

describe('ImageSearchProviderChain', () => {
  beforeEach(() => {
    process.env.IMAGE_SEARCH_PROVIDER_FALLBACK_READY = 'true';
  });

  it('falls back to Openverse when Pixabay returns 429', async () => {
    const pixabay = {
      search: jest.fn().mockRejectedValue(new Error('HTTP 429')),
    };
    const openverse = {
      search: jest.fn().mockResolvedValue([candidate('OPENVERSE')]),
    };
    const chain = new ImageSearchProviderChain(
      pixabay as any,
      openverse as any,
    );

    await expect(chain.search('office meeting')).resolves.toEqual([
      candidate('OPENVERSE'),
    ]);
    expect(openverse.search).toHaveBeenCalledWith('office meeting', undefined);
  });

  it('keeps both-provider failure non-fatal and exposes manual fallback text', async () => {
    const pixabay = {
      search: jest.fn().mockRejectedValue(new Error('HTTP 429')),
    };
    const openverse = {
      search: jest.fn().mockRejectedValue(new Error('HTTP 503')),
    };
    const chain = new ImageSearchProviderChain(
      pixabay as any,
      openverse as any,
    );

    await expect(chain.search('office meeting')).rejects.toEqual(
      expect.objectContaining({
        message:
          'Không thể tìm ảnh tự động lúc này. Bạn có thể thử lại sau hoặc tải ảnh lên thủ công.',
      } as ServiceUnavailableException),
    );
  });

  it('routes selected downloads to the matching provider', async () => {
    const pixabay = { download: jest.fn() };
    const openverse = { download: jest.fn() };
    const chain = new ImageSearchProviderChain(
      pixabay as any,
      openverse as any,
    );
    const openverseCandidate = candidate('OPENVERSE');

    await chain.download(openverseCandidate);
    expect(openverse.download).toHaveBeenCalledWith(openverseCandidate);
    expect(pixabay.download).not.toHaveBeenCalled();
  });

  it('falls through to Wikimedia when Pixabay materialization is degraded', async () => {
    const pixabay = { search: jest.fn() };
    const openverse = {
      search: jest.fn().mockRejectedValue(new Error('timeout')),
    };
    const wikimedia = {
      search: jest.fn().mockResolvedValue([candidate('WIKIMEDIA_COMMONS')]),
    };
    const redis = { get: jest.fn().mockResolvedValue('429') };
    const chain = new ImageSearchProviderChain(
      pixabay as any,
      openverse as any,
      wikimedia as any,
      redis as any,
    );

    await expect(chain.search('office meeting')).resolves.toEqual([
      candidate('WIKIMEDIA_COMMONS'),
    ]);
    expect(pixabay.search).not.toHaveBeenCalled();
    expect(wikimedia.search).toHaveBeenCalledWith('office meeting', undefined);
  });

  it('routes Wikimedia downloads to the Wikimedia provider', async () => {
    const pixabay = { download: jest.fn() };
    const openverse = { download: jest.fn() };
    const wikimedia = { download: jest.fn().mockResolvedValue({}) };
    const chain = new ImageSearchProviderChain(
      pixabay as any,
      openverse as any,
      wikimedia as any,
    );

    const wikimediaCandidate = candidate('WIKIMEDIA_COMMONS');
    await chain.download(wikimediaCandidate);
    expect(wikimedia.download).toHaveBeenCalledWith(wikimediaCandidate);
    expect(pixabay.download).not.toHaveBeenCalled();
  });

  it('does not redownload Pixabay while materialization cooldown is active', async () => {
    const pixabay = { download: jest.fn() };
    const openverse = { download: jest.fn() };
    const redis = { get: jest.fn().mockResolvedValue('429') };
    const chain = new ImageSearchProviderChain(
      pixabay as any,
      openverse as any,
      undefined,
      redis as any,
    );

    await expect(chain.download(candidate('PIXABAY'))).rejects.toThrow(
      'Pixabay hiện đang giới hạn tải ảnh',
    );
    expect(pixabay.download).not.toHaveBeenCalled();
  });
});
