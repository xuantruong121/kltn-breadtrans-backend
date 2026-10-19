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
import Redis from 'ioredis';

const PIXABAY_MATERIALIZATION_COOLDOWN_KEY = 'pixabay:materialization:degraded';
const PIXABAY_MATERIALIZATION_COOLDOWN_SECONDS = 60;

@Injectable()
export class ImageSearchProviderChain implements ImageSearchProvider {
  private readonly logger = new Logger(ImageSearchProviderChain.name);

  constructor(
    private readonly pixabay: PixabayImageSearchProvider,
    private readonly openverse: OpenverseImageSearchProvider,
    @Optional()
    private readonly wikimedia?: WikimediaCommonsImageSearchProvider,
    @Optional() @InjectRedis() private readonly redis?: Redis,
  ) {}

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
