import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { createHash } from 'crypto';
import {
  DownloadedImage,
  ImageSearchCandidate,
  ImageSearchProvider,
  validateImageBuffer,
} from './pixabay-image-search.provider';
import {
  classifySearchHttpFailure,
  withImageSearchErrorCode,
} from './image-search-error';

const CACHE_TTL_SECONDS = 24 * 60 * 60;
const MAX_RESULTS = 5;
const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_HOSTS = new Set(['images.pexels.com']);

type PexelsPhoto = {
  id?: number;
  width?: number;
  height?: number;
  url?: string;
  photographer?: string;
  photographer_url?: string;
  alt?: string;
  src?: {
    large?: string;
    medium?: string;
    original?: string;
  };
};

/** Free, API-key-gated stock photo search. Rate limit per Pexels' own terms
 * is 200 requests/hour by default — results are cached 24h to stay well
 * under that, same pattern as the other providers in this chain. */
@Injectable()
export class PexelsImageSearchProvider implements ImageSearchProvider {
  private readonly logger = new Logger(PexelsImageSearchProvider.name);
  private readonly inFlight = new Map<
    string,
    Promise<ImageSearchCandidate[]>
  >();

  constructor(@InjectRedis() private readonly redis: Redis) {}

  isConfigured() {
    return Boolean(process.env.PEXELS_API_KEY?.trim());
  }

  async search(
    query: string,
    options?: { limit?: number },
  ): Promise<ImageSearchCandidate[]> {
    const normalizedQuery = query.trim().replace(/\s+/g, ' ').slice(0, 120);
    if (!normalizedQuery)
      throw new BadRequestException('Từ khóa tìm ảnh không được để trống');
    if (!this.isConfigured())
      throw withImageSearchErrorCode(
        new ServiceUnavailableException(
          'Tìm ảnh Pexels chưa được cấu hình. Bạn có thể tải ảnh lên thủ công.',
        ),
        'PROVIDER_NOT_CONFIGURED',
      );
    const limit = Math.min(Math.max(options?.limit ?? 5, 1), MAX_RESULTS);
    const cacheKey = `pexels:search:${createHash('sha256').update(`${normalizedQuery.toLowerCase()}:${limit}`).digest('hex')}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as ImageSearchCandidate[];
    const existing = this.inFlight.get(cacheKey);
    if (existing) return existing;
    const request = this.fetchSearch(normalizedQuery, limit)
      .then(async (results) => {
        await this.redis.set(
          cacheKey,
          JSON.stringify(results),
          'EX',
          CACHE_TTL_SECONDS,
        );
        return results;
      })
      .finally(() => this.inFlight.delete(cacheKey));
    this.inFlight.set(cacheKey, request);
    return request;
  }

  async download(candidate: ImageSearchCandidate): Promise<DownloadedImage> {
    if (
      candidate.provider !== 'PEXELS' ||
      !this.isTrustedUrl(candidate.downloadUrl)
    )
      throw new BadRequestException('Nguồn tải ảnh Pexels không hợp lệ');
    let url = candidate.downloadUrl;
    for (let redirect = 0; redirect <= 3; redirect += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12_000);
      let response: Response;
      try {
        response = await fetch(url, {
          signal: controller.signal,
          redirect: 'manual',
        });
      } finally {
        clearTimeout(timeout);
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location || redirect === 3)
          throw new BadRequestException(
            'Ảnh Pexels chuyển hướng quá nhiều lần',
          );
        const next = new URL(location, url).toString();
        if (!this.isTrustedUrl(next))
          throw new BadRequestException(
            'Ảnh Pexels chuyển hướng tới nguồn không được phép',
          );
        url = next;
        continue;
      }
      if (!response.ok)
        throw new ServiceUnavailableException(
          `Không thể tải ảnh Pexels (HTTP ${response.status})`,
        );
      const length = Number(response.headers.get('content-length') || 0);
      if (length > MAX_DOWNLOAD_BYTES)
        throw new BadRequestException(
          'Ảnh Pexels vượt quá kích thước cho phép',
        );
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length || buffer.length > MAX_DOWNLOAD_BYTES)
        throw new BadRequestException('Ảnh Pexels không hợp lệ');
      return validateImageBuffer(buffer, response.headers.get('content-type'), {
        width: candidate.width,
        height: candidate.height,
      });
    }
    throw new BadRequestException('Không thể tải ảnh Pexels');
  }

  private async fetchSearch(query: string, limit: number) {
    const url = new URL('https://api.pexels.com/v1/search');
    url.searchParams.set('query', query);
    url.searchParams.set('per_page', String(limit));
    url.searchParams.set('orientation', 'landscape');
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: process.env.PEXELS_API_KEY!.trim() },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      this.logger.warn(
        `pexels_unavailable error=${error instanceof Error ? error.name : 'unknown'}`,
      );
      throw withImageSearchErrorCode(
        new ServiceUnavailableException('Pexels hiện không khả dụng'),
        error instanceof Error && error.name === 'AbortError'
          ? 'PROVIDER_TIMEOUT'
          : 'PROVIDER_TRANSIENT',
      );
    }
    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      const code = classifySearchHttpFailure(response.status, bodyText);
      this.logger.warn(
        `pexels_unavailable status=${response.status} code=${code}`,
      );
      throw withImageSearchErrorCode(
        new ServiceUnavailableException(
          `Pexels không khả dụng (HTTP ${response.status})`,
        ),
        code,
      );
    }
    const body = (await response.json()) as { photos?: PexelsPhoto[] };
    return (body.photos ?? [])
      .slice(0, limit)
      .map((photo) => this.normalize(photo))
      .filter((candidate): candidate is ImageSearchCandidate =>
        Boolean(candidate),
      );
  }

  private normalize(photo: PexelsPhoto): ImageSearchCandidate | null {
    const id = photo.id ? String(photo.id) : '';
    const previewUrl = String(photo.src?.medium || '');
    const downloadUrl = String(photo.src?.large || photo.src?.original || '');
    if (
      !id ||
      !this.isTrustedUrl(previewUrl) ||
      !this.isTrustedUrl(downloadUrl)
    )
      return null;
    return {
      provider: 'PEXELS',
      providerAssetId: id,
      previewUrl,
      downloadUrl,
      sourcePageUrl: String(photo.url || ''),
      width: Number(photo.width || 0),
      height: Number(photo.height || 0),
      author: String(photo.photographer || 'Pexels contributor'),
      authorUrl: photo.photographer_url
        ? String(photo.photographer_url)
        : undefined,
      source: 'PEXELS',
      tags: [],
      license: 'Pexels License — free to use, attribution appreciated',
      attribution: photo.photographer
        ? `Photo by ${photo.photographer} on Pexels`
        : undefined,
      metadata: { alt: photo.alt || null },
    };
  }

  private isTrustedUrl(value: string) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && ALLOWED_IMAGE_HOSTS.has(url.hostname);
    } catch {
      this.logger.warn('Rejected malformed Pexels URL');
      return false;
    }
  }
}
