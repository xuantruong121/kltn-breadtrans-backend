import {
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import {
  DownloadedImage,
  ImageSearchCandidate,
  ImageSearchProvider,
  PixabayImageSearchProvider,
  validateImageBuffer,
} from './pixabay-image-search.provider';
import { OpenverseImageSearchProvider } from './openverse-image-search.provider';
import { WikimediaCommonsImageSearchProvider } from './wikimedia-commons-image-search.provider';
import {
  ImageSearchErrorCode,
  imageSearchErrorCode,
} from './image-search-error';
import Redis from 'ioredis';

const PIXABAY_MATERIALIZATION_COOLDOWN_KEY = 'pixabay:materialization:degraded';
const PIXABAY_MATERIALIZATION_COOLDOWN_SECONDS = 60;

/** Per-provider cooldown so a known-bad provider (blocked/rate-limited/auth
 * failure) is skipped outright on subsequent searches instead of delaying
 * every Admin search with a doomed retry. Generic version of the Pixabay-only
 * materialization-degraded flag above, used only by searchWithDiagnostics. */
const COOLDOWN_SECONDS: Partial<Record<ImageSearchErrorCode, number>> = {
  PROVIDER_BLOCKED: 300,
  PROVIDER_RATE_LIMITED: 60,
  PROVIDER_AUTH_FAILURE: 3600,
  PROVIDER_TRANSIENT: 30,
  PROVIDER_TIMEOUT: 30,
};

export type ProviderSearchAttempt = {
  provider: string;
  outcome: 'OK' | 'OK_EMPTY' | ImageSearchErrorCode | 'UNKNOWN_ERROR';
};

export type DiagnosedSearchResult = {
  candidates: ImageSearchCandidate[];
  attempted: ProviderSearchAttempt[];
};

@Injectable()
export class ImageSearchProviderChain implements ImageSearchProvider {
  private readonly logger = new Logger(ImageSearchProviderChain.name);
  private readonly localCooldowns = new Map<string, number>();
  private readonly localCooldownCodes = new Map<string, ImageSearchErrorCode>();

  constructor(
    private readonly pixabay: PixabayImageSearchProvider,
    private readonly openverse: OpenverseImageSearchProvider,
    @Optional()
    private readonly wikimedia?: WikimediaCommonsImageSearchProvider,
    @Optional() @InjectRedis() private readonly redis?: Redis,
  ) {}

  /** Order: Openverse → Wikimedia → Pixabay (Pixabay is last and
   * health-gated — it has been observed blocked by Cloudflare in production,
   * so a configured-but-unhealthy Pixabay must not delay every search).
   * Flickr was removed entirely (onboarding its API key was not practically
   * usable for this project) — Cloudflare AI generation and manual upload
   * are the first-class fallbacks when this chain finds nothing. Pexels is
   * intentionally NOT wired into this chain (API-key issuance is paused; its
   * adapter stays dormant in source for possible future reuse without adding
   * runtime cost or noisy NOT_CONFIGURED attempts). Only providers that are
   * actually configured AND not currently cooling down are queried — never
   * all of them in parallel, only as many as needed. Never throws: callers
   * distinguish "found nothing" from "every configured provider was
   * unavailable" via `attempted`. Results are deduplicated by
   * providerAssetId + canonical URL before being returned. */
  async searchWithDiagnostics(
    query: string,
    options?: { limit?: number },
  ): Promise<DiagnosedSearchResult> {
    const attempted: ProviderSearchAttempt[] = [];
    const providers: Array<{
      name: string;
      instance: ImageSearchProvider & { isConfigured?: () => boolean };
    }> = [
      { name: 'OPENVERSE', instance: this.openverse },
      { name: 'WIKIMEDIA_COMMONS', instance: this.wikimedia as any },
      { name: 'PIXABAY', instance: this.pixabay },
    ];
    for (const { name, instance } of providers) {
      if (!instance) continue;
      const cooling = await this.isCoolingDown(name);
      if (cooling) {
        attempted.push({ provider: name, outcome: cooling });
        continue;
      }
      if (instance.isConfigured && !instance.isConfigured()) {
        attempted.push({ provider: name, outcome: 'PROVIDER_NOT_CONFIGURED' });
        continue;
      }
      try {
        const results = await instance.search(query, options);
        if (results.length) {
          attempted.push({ provider: name, outcome: 'OK' });
          return {
            candidates: this.dedupe(results),
            attempted,
          };
        }
        attempted.push({ provider: name, outcome: 'OK_EMPTY' });
      } catch (error) {
        const code = imageSearchErrorCode(error) ?? 'UNKNOWN_ERROR';
        attempted.push({ provider: name, outcome: code });
        if (code in COOLDOWN_SECONDS)
          await this.markCoolingDown(name, code as ImageSearchErrorCode);
        this.logger.warn(
          `${name.toLowerCase()}_fallback provider=${name} code=${code}`,
        );
      }
    }
    return { candidates: [], attempted };
  }

  private cooldownKey(provider: string) {
    return `image-search:${provider.toLowerCase()}:cooldown`;
  }

  private async isCoolingDown(
    provider: string,
  ): Promise<ImageSearchErrorCode | null> {
    const cached = await this.redis?.get(this.cooldownKey(provider));
    if (cached) return cached as ImageSearchErrorCode;
    const until = this.localCooldowns.get(provider);
    if (until && until > Date.now())
      return this.localCooldownCodes.get(provider) ?? 'PROVIDER_TRANSIENT';
    return null;
  }

  private async markCoolingDown(provider: string, code: ImageSearchErrorCode) {
    const seconds = COOLDOWN_SECONDS[code];
    if (!seconds) return;
    this.localCooldowns.set(provider, Date.now() + seconds * 1000);
    this.localCooldownCodes.set(provider, code);
    await this.redis?.set(this.cooldownKey(provider), code, 'EX', seconds);
  }

  private dedupe(candidates: ImageSearchCandidate[]): ImageSearchCandidate[] {
    const seen = new Set<string>();
    return candidates.filter((candidate) => {
      const key = `${candidate.provider}:${candidate.providerAssetId || candidate.downloadUrl}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async search(
    query: string,
    options?: { limit?: number },
  ): Promise<ImageSearchCandidate[]> {
    if (!(await this.isPixabayMaterializationDegraded())) {
      try {
        const results = await this.pixabay.search(query, options);
        if (results.length) return results;
        this.logger.warn('pixabay_empty_results fallback=OPENVERSE');
      } catch (error) {
        this.logger.warn(
          `pixabay_fallback provider=PIXABAY reason=${error instanceof Error ? error.message : 'unavailable'}`,
        );
      }
    } else {
      this.logger.warn('pixabay_materialization_degraded skip=PIXABAY_SEARCH');
    }

    if (
      process.env.IMAGE_SEARCH_PROVIDER_FALLBACK_READY === 'false' &&
      !this.wikimedia
    )
      throw new ServiceUnavailableException(
        'Không thể tìm ảnh tự động lúc này. Bạn có thể thử lại sau hoặc tải ảnh lên thủ công.',
      );

    try {
      const results = await this.openverse.search(query, options);
      if (results.length) return results;
    } catch (error) {
      this.logger.warn(
        `openverse_fallback_failed provider=OPENVERSE reason=${error instanceof Error ? error.message : 'unavailable'}`,
      );
    }
    if (this.wikimedia) {
      try {
        const results = await this.wikimedia.search(query, options);
        if (results.length) return results;
      } catch (error) {
        this.logger.warn(
          `wikimedia_fallback_failed provider=WIKIMEDIA_COMMONS reason=${error instanceof Error ? error.message : 'unavailable'}`,
        );
      }
    }
    throw new ServiceUnavailableException(
      'Không thể tìm ảnh tự động lúc này. Bạn có thể thử lại sau hoặc tải ảnh lên thủ công.',
    );
  }

  async download(candidate: ImageSearchCandidate): Promise<DownloadedImage> {
    if (candidate.provider === 'WIKIMEDIA_COMMONS') {
      if (!this.wikimedia)
        throw new ServiceUnavailableException(
          'Wikimedia Commons chưa được cấu hình',
        );
      return this.wikimedia.download(candidate);
    }
    if (candidate.provider === 'OPENVERSE')
      return this.openverse.download(candidate);
    if (await this.isPixabayMaterializationDegraded())
      throw new ServiceUnavailableException(
        'Pixabay hiện đang giới hạn tải ảnh. Hãy chọn ảnh từ nguồn khác hoặc tải ảnh lên thủ công.',
      );
    try {
      return await this.pixabay.download(candidate);
    } catch (error) {
      if (error instanceof Error && /HTTP 429/.test(error.message)) {
        await this.markPixabayMaterializationDegraded();
      }
      throw error;
    }
  }

  validateBuffer(
    buffer: Buffer,
    header?: string | null,
    fallbackSize?: { width: number; height: number },
  ) {
    return validateImageBuffer(buffer, header, fallbackSize);
  }

  private async isPixabayMaterializationDegraded() {
    if (this.pixabayDegradedUntil > Date.now()) return true;
    const cached = await this.redis?.get(PIXABAY_MATERIALIZATION_COOLDOWN_KEY);
    return Boolean(cached);
  }

  private pixabayDegradedUntil = 0;

  private async markPixabayMaterializationDegraded() {
    this.pixabayDegradedUntil =
      Date.now() + PIXABAY_MATERIALIZATION_COOLDOWN_SECONDS * 1000;
    await this.redis?.set(
      PIXABAY_MATERIALIZATION_COOLDOWN_KEY,
      '429',
      'EX',
      PIXABAY_MATERIALIZATION_COOLDOWN_SECONDS,
    );
  }
}
