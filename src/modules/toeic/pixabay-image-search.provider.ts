import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { createHash } from 'crypto';

export type ImageSearchCandidate = {
  provider: 'PIXABAY' | 'OPENVERSE' | 'WIKIMEDIA_COMMONS';
  providerAssetId: string;
  previewUrl: string;
  downloadUrl: string;
  sourcePageUrl: string;
  width: number;
  height: number;
  author: string;
  authorUrl?: string;
  source?: string;
  licenseVersion?: string;
  licenseUrl?: string;
  attribution?: string;
  tags: string[];
  license: string;
  metadata?: Record<string, unknown>;
};

export type DownloadedImage = {
  buffer: Buffer;
  mimeType: string;
  width: number;
  height: number;
};

export interface ImageSearchProvider {
  search(
    query: string,
    options?: { limit?: number },
  ): Promise<ImageSearchCandidate[]>;
  download(candidate: ImageSearchCandidate): Promise<DownloadedImage>;
}

export type ImageSearchProviderName = ImageSearchCandidate['provider'];

const CACHE_TTL_SECONDS = 24 * 60 * 60;
const MAX_RESULTS = 5;
const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_HOSTS = new Set([
  'pixabay.com',
  'images.pixabay.com',
  'cdn.pixabay.com',
]);

function isPng(buffer: Buffer) {
  return (
    buffer.length >= 24 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  );
}

function isJpeg(buffer: Buffer) {
  return (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  );
}

function isWebp(buffer: Buffer) {
  return (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  );
}

function dimensions(buffer: Buffer) {
  if (isPng(buffer))
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  if (
    isWebp(buffer) &&
    buffer.subarray(12, 16).toString('ascii') === 'VP8X' &&
    buffer.length >= 30
  ) {
    return {
      width: 1 + buffer[24] + (buffer[25] << 8) + (buffer[26] << 16),
      height: 1 + buffer[27] + (buffer[28] << 8) + (buffer[29] << 16),
    };
  }
  if (!isJpeg(buffer)) return null;
  for (let offset = 2; offset + 9 < buffer.length;) {
    if (buffer[offset] !== 0xff) break;
    const marker = buffer[offset + 1];
    const size = buffer.readUInt16BE(offset + 2);
    if ([0xc0, 0xc1, 0xc2, 0xc3].includes(marker)) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + size;
  }
  return null;
}

function mimeType(buffer: Buffer, header?: string | null) {
  if (isPng(buffer)) return 'image/png';
  if (isJpeg(buffer)) return 'image/jpeg';
  if (isWebp(buffer)) return 'image/webp';
  return header?.split(';')[0].trim().toLowerCase().startsWith('image/')
    ? header.split(';')[0].trim().toLowerCase()
    : null;
}

export function validateImageBuffer(
  buffer: Buffer,
  header?: string | null,
  fallbackSize?: { width: number; height: number },
): DownloadedImage {
  const type = mimeType(buffer, header);
  const size = dimensions(buffer) ?? fallbackSize;
  if (!type || !size || size.width < 160 || size.height < 120)
    throw new BadRequestException('Ảnh không đạt kích thước hoặc định dạng');
  return { buffer, mimeType: type, width: size.width, height: size.height };
}

@Injectable()
export class PixabayImageSearchProvider implements ImageSearchProvider {
  private readonly logger = new Logger(PixabayImageSearchProvider.name);
  private readonly inFlight = new Map<
    string,
    Promise<ImageSearchCandidate[]>
  >();

  constructor(@InjectRedis() private readonly redis: Redis) {}

  isConfigured() {
    return (
      (process.env.IMAGE_SEARCH_PROVIDER || 'pixabay').toLowerCase() ===
        'pixabay' && Boolean(process.env.PIXABAY_API_KEY?.trim())
    );
  }

  async search(
    query: string,
    options?: { limit?: number },
  ): Promise<ImageSearchCandidate[]> {
    const normalizedQuery = query.trim().replace(/\s+/g, ' ').slice(0, 120);
    if (!normalizedQuery)
      throw new BadRequestException('Từ khóa tìm ảnh không được để trống');
    if (!this.isConfigured())
      throw new ServiceUnavailableException(
        'Tìm ảnh Pixabay chưa được cấu hình. Bạn có thể tải ảnh lên thủ công.',
      );
    const limit = Math.min(Math.max(options?.limit ?? 5, 1), MAX_RESULTS);
    const cacheKey = `pixabay:search:${createHash('sha256').update(`${normalizedQuery.toLowerCase()}:${limit}`).digest('hex')}`;
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
      candidate.provider !== 'PIXABAY' ||
      !this.isTrustedUrl(candidate.downloadUrl)
    ) {
      throw new BadRequestException('Nguồn tải ảnh không hợp lệ');
    }
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
            'Ảnh Pixabay chuyển hướng quá nhiều lần',
          );
        const next = new URL(location, url).toString();
        if (!this.isTrustedUrl(next))
          throw new BadRequestException(
            'Ảnh Pixabay chuyển hướng tới nguồn không được phép',
          );
        url = next;
        continue;
      }
      if (!response.ok)
        throw new ServiceUnavailableException(
          `Không thể tải ảnh Pixabay (HTTP ${response.status})`,
        );
      const length = Number(response.headers.get('content-length') || 0);
      if (length > MAX_DOWNLOAD_BYTES)
        throw new BadRequestException(
          'Ảnh Pixabay vượt quá kích thước cho phép',
        );
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length || buffer.length > MAX_DOWNLOAD_BYTES)
        throw new BadRequestException('Ảnh Pixabay không hợp lệ');
      return this.validateBuffer(buffer, response.headers.get('content-type'), {
        width: candidate.width,
        height: candidate.height,
      });
    }
    throw new BadRequestException('Không thể tải ảnh Pixabay');
  }

  validateBuffer(
    buffer: Buffer,
    header?: string | null,
    fallbackSize?: { width: number; height: number },
  ): DownloadedImage {
    return validateImageBuffer(buffer, header, fallbackSize);
  }

  private async fetchSearch(query: string, limit: number) {
    const url = new URL('https://pixabay.com/api/');
    url.searchParams.set('key', process.env.PIXABAY_API_KEY!.trim());
    url.searchParams.set('q', query);
    url.searchParams.set('image_type', 'photo');
    url.searchParams.set('orientation', 'horizontal');
    url.searchParams.set('safesearch', 'true');
    url.searchParams.set('per_page', String(limit));
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      this.logger.warn(
        `pixabay_unavailable provider=PIXABAY status=${response.status} queryHash=${createHash('sha256').update(query.toLowerCase()).digest('hex').slice(0, 12)} retryable=${retryable}`,
      );
      throw new ServiceUnavailableException(
        `Pixabay không khả dụng (HTTP ${response.status})`,
      );
    }
    const body = (await response.json()) as { hits?: any[] };
    return (body.hits ?? [])
      .slice(0, limit)
      .map((hit) => ({
        provider: 'PIXABAY' as const,
        providerAssetId: String(hit.id),
        previewUrl: String(hit.previewURL || hit.webformatURL),
        downloadUrl: String(hit.largeImageURL || hit.webformatURL),
        sourcePageUrl: String(hit.pageURL),
        width: Number(hit.imageWidth || 0),
        height: Number(hit.imageHeight || 0),
        author: String(hit.user || 'Pixabay contributor'),
        source: 'PIXABAY',
        tags: String(hit.tags || '')
          .split(',')
          .map((tag: string) => tag.trim())
          .filter(Boolean)
          .slice(0, 12),
        license: 'Pixabay Content License — human review required',
      }))
      .filter(
        (candidate) =>
          candidate.previewUrl &&
          candidate.downloadUrl &&
          candidate.sourcePageUrl,
      );
  }

  private isTrustedUrl(value: string) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && ALLOWED_IMAGE_HOSTS.has(url.hostname);
    } catch {
      this.logger.warn('Rejected malformed Pixabay URL');
      return false;
    }
  }
}
