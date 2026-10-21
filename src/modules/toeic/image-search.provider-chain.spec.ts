import { ServiceUnavailableException } from '@nestjs/common';
import { ImageSearchProviderChain } from './image-search.provider-chain';
import { ImageSearchCandidate } from './pixabay-image-search.provider';
import { withImageSearchErrorCode } from './image-search-error';

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

  describe('searchWithDiagnostics — order: Openverse → Wikimedia → Pixabay', () => {
    it('stops at Openverse when it returns results — Wikimedia/Pixabay are never called', async () => {
      const pixabay = { search: jest.fn() };
      const openverse = {
        search: jest.fn().mockResolvedValue([candidate('OPENVERSE')]),
      };
      const wikimedia = { search: jest.fn() };
      const chain = new ImageSearchProviderChain(
        pixabay as any,
        openverse as any,
        wikimedia as any,
      );
      const result = await chain.searchWithDiagnostics('people greeting');
      expect(result.candidates).toEqual([candidate('OPENVERSE')]);
      expect(result.attempted).toEqual([
        { provider: 'OPENVERSE', outcome: 'OK' },
      ]);
      expect(wikimedia.search).not.toHaveBeenCalled();
      expect(pixabay.search).not.toHaveBeenCalled();
    });

    it('Openverse empty falls through to Wikimedia', async () => {
      const openverse = { search: jest.fn().mockResolvedValue([]) };
      const pixabay = { search: jest.fn() };
      const wikimedia = {
        search: jest.fn().mockResolvedValue([candidate('WIKIMEDIA_COMMONS')]),
      };
      const chain = new ImageSearchProviderChain(
        pixabay as any,
        openverse as any,
        wikimedia as any,
      );
      const result = await chain.searchWithDiagnostics('people greeting');
      expect(result.candidates).toEqual([candidate('WIKIMEDIA_COMMONS')]);
      expect(pixabay.search).not.toHaveBeenCalled();
    });

    it('Openverse unavailable falls through to Wikimedia', async () => {
      const openverse = {
        search: jest
          .fn()
          .mockRejectedValue(
            withImageSearchErrorCode(
              new ServiceUnavailableException('x'),
              'PROVIDER_TIMEOUT',
            ),
          ),
      };
      const pixabay = { search: jest.fn() };
      const wikimedia = {
        search: jest.fn().mockResolvedValue([candidate('WIKIMEDIA_COMMONS')]),
      };
      const chain = new ImageSearchProviderChain(
        pixabay as any,
        openverse as any,
        wikimedia as any,
      );
      const result = await chain.searchWithDiagnostics('people greeting');
      expect(result.candidates).toEqual([candidate('WIKIMEDIA_COMMONS')]);
      expect(pixabay.search).not.toHaveBeenCalled();
    });

    it('Pixabay is tried last and only when healthy — a PROVIDER_BLOCKED classification skips it on the very next search (generic cooldown, not just the legacy Pixabay-only flag)', async () => {
      const openverse = {
        search: jest
          .fn()
          .mockRejectedValue(
            withImageSearchErrorCode(
              new ServiceUnavailableException('x'),
              'PROVIDER_TRANSIENT',
            ),
          ),
      };
      const pixabay = {
        search: jest
          .fn()
          .mockRejectedValue(
            withImageSearchErrorCode(
              new ServiceUnavailableException('blocked'),
              'PROVIDER_BLOCKED',
            ),
          ),
      };
      const chain = new ImageSearchProviderChain(
        pixabay as any,
        openverse as any,
      );
      const first = await chain.searchWithDiagnostics('people greeting');
      expect(first.attempted).toContainEqual({
        provider: 'PIXABAY',
        outcome: 'PROVIDER_BLOCKED',
      });
      expect(pixabay.search).toHaveBeenCalledTimes(1);

      // second search: Pixabay must be skipped outright (cooling down),
      // never re-attempted just because Admin clicked search again.
      const second = await chain.searchWithDiagnostics('people greeting');
      expect(pixabay.search).toHaveBeenCalledTimes(1); // still 1 — not called again
      expect(second.attempted).toContainEqual({
        provider: 'PIXABAY',
        outcome: 'PROVIDER_BLOCKED',
      });
    });

    it('never throws — when every configured provider errors, returns empty candidates with every failure classified, in Openverse→Wikimedia→Pixabay order', async () => {
      const openverse = {
        search: jest
          .fn()
          .mockRejectedValue(
            withImageSearchErrorCode(
              new ServiceUnavailableException('x'),
              'PROVIDER_TIMEOUT',
            ),
          ),
      };
      const pixabay = {
        search: jest
          .fn()
          .mockRejectedValue(
            withImageSearchErrorCode(
              new ServiceUnavailableException('x'),
              'PROVIDER_TRANSIENT',
            ),
          ),
      };
      const chain = new ImageSearchProviderChain(
        pixabay as any,
        openverse as any,
      );
      const result = await chain.searchWithDiagnostics('people greeting');
      expect(result.candidates).toEqual([]);
      expect(result.attempted).toEqual([
        { provider: 'OPENVERSE', outcome: 'PROVIDER_TIMEOUT' },
        { provider: 'PIXABAY', outcome: 'PROVIDER_TRANSIENT' },
      ]);
    });

    it('distinguishes OK_EMPTY (provider responded, zero matches) from an error — both end with empty candidates but different attempted outcomes', async () => {
      const pixabay = { search: jest.fn().mockResolvedValue([]) };
      const openverse = { search: jest.fn().mockResolvedValue([]) };
      const chain = new ImageSearchProviderChain(
        pixabay as any,
        openverse as any,
      );
      const result = await chain.searchWithDiagnostics('people greeting');
      expect(result.candidates).toEqual([]);
      expect(result.attempted).toEqual([
        { provider: 'OPENVERSE', outcome: 'OK_EMPTY' },
        { provider: 'PIXABAY', outcome: 'OK_EMPTY' },
      ]);
    });

    it('deduplicates candidates by providerAssetId before returning', async () => {
      const dupe = candidate('PIXABAY');
      const pixabay = {
        search: jest.fn().mockResolvedValue([dupe, { ...dupe }, dupe]),
      };
      const openverse = { search: jest.fn().mockResolvedValue([]) };
      const chain = new ImageSearchProviderChain(
        pixabay as any,
        openverse as any,
      );
      const result = await chain.searchWithDiagnostics('people greeting');
      expect(result.candidates).toHaveLength(1);
    });
  });
});
