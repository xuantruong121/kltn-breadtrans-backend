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
  classifySearchHttpFailure,
  withImageSearchErrorCode,
} from './image-search-error';
import {
  DownloadedImage,
  ImageSearchCandidate,
  ImageSearchProvider,
  validateImageBuffer,
} from './pixabay-image-search.provider';

const CACHE_TTL_SECONDS = 24 * 60 * 60;
const MAX_RESULTS = 5;
const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;
const OPENVERSE_HOST = 'api.openverse.org';
const PERMISSIVE_LICENSES = new Set(['cc0', 'pdm', 'by']);

type OpenverseImage = {
  id?: string;
  title?: string;
  url?: string;
  thumbnail?: string;
  foreign_landing_url?: string;
  creator?: string;
  creator_url?: string;
  license?: string;
  license_version?: string;
  license_url?: string;
  provider?: string;
  source?: string;
  attribution?: string;
  width?: number;
  height?: number;
  mature?: boolean;
  tags?: Array<{ name?: string }>;
};

@Injectable()
export class OpenverseImageSearchProvider implements ImageSearchProvider {
  private readonly logger = new Logger(OpenverseImageSearchProvider.name);
  private readonly inFlight = new Map<
    string,
    Promise<ImageSearchCandidate[]>
  >();

  constructor(@InjectRedis() private readonly redis: Redis) {}

  isConfigured() {
    return true;
  }

  async search(
    query: string,
    options?: { limit?: number },
  ): Promise<ImageSearchCandidate[]> {
    const normalizedQuery = query.trim().replace(/\s+/g, ' ').slice(0, 120);
    if (!normalizedQuery)
      throw new BadRequestException('Từ khóa tìm ảnh không được để trống');
    const limit = Math.min(Math.max(options?.limit ?? 5, 1), MAX_RESULTS);
    const cacheKey = `openverse:search:${createHash('sha256').update(`${normalizedQuery.toLowerCase()}:${limit}`).digest('hex')}`;
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
      candidate.provider !== 'OPENVERSE' ||
      !this.isTrustedUrl(candidate.downloadUrl)
    ) {
      throw new BadRequestException('Nguồn tải ảnh Openverse không hợp lệ');
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
            'Ảnh Openverse chuyển hướng quá nhiều lần',
          );
        const next = new URL(location, url).toString();
        if (!this.isTrustedUrl(next))
          throw new BadRequestException(
            'Ảnh Openverse chuyển hướng tới nguồn không được phép',
          );
        url = next;
        continue;
      }
      if (!response.ok)
        throw new ServiceUnavailableException(
          `Openverse không thể tải ảnh (HTTP ${response.status})`,
        );
      const length = Number(response.headers.get('content-length') || 0);
      if (length > MAX_DOWNLOAD_BYTES)
        throw new BadRequestException(
          'Ảnh Openverse vượt quá kích thước cho phép',
        );
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length || buffer.length > MAX_DOWNLOAD_BYTES)
        throw new BadRequestException('Ảnh Openverse không hợp lệ');
      return validateImageBuffer(buffer, response.headers.get('content-type'), {
        width: candidate.width,
        height: candidate.height,
      });
    }
    throw new BadRequestException('Không thể tải ảnh Openverse');
  }

  private async fetchSearch(query: string, limit: number) {
    const url = new URL('https://api.openverse.org/v1/images/');
    url.searchParams.set('q', query);
    url.searchParams.set('page_size', String(limit));
    url.searchParams.set('license', 'cc0,by,pdm');
    url.searchParams.set('include_sensitive_results', 'false');
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    } catch (error) {
      this.logger.warn(
        `openverse_unavailable provider=OPENVERSE queryHash=${this.queryHash(query)} error=${error instanceof Error ? error.name : 'unknown'}`,
      );
      throw withImageSearchErrorCode(
        new ServiceUnavailableException('Openverse hiện không khả dụng'),
        error instanceof Error && error.name === 'AbortError'
          ? 'PROVIDER_TIMEOUT'
          : 'PROVIDER_TRANSIENT',
      );
    }
    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      const code = classifySearchHttpFailure(response.status, bodyText);
      this.logger.warn(
        `openverse_unavailable provider=OPENVERSE status=${response.status} code=${code} queryHash=${this.queryHash(query)}`,
      );
      throw withImageSearchErrorCode(
        new ServiceUnavailableException(
          `Openverse không khả dụng (HTTP ${response.status})`,
        ),
        code,
      );
    }
    const body = (await response.json()) as { results?: OpenverseImage[] };
    return (body.results ?? [])
      .filter(
        (item) =>
          Boolean(item.id && item.thumbnail && item.foreign_landing_url) &&
          !item.mature &&
          PERMISSIVE_LICENSES.has(String(item.license || '').toLowerCase()),
      )
      .slice(0, limit)
      .map((item) => this.normalize(item))
      .filter((candidate): candidate is ImageSearchCandidate =>
        Boolean(candidate),
      );
  }

  private normalize(item: OpenverseImage): ImageSearchCandidate | null {
    const id = String(item.id || '');
    const thumbnail = String(item.thumbnail || '');
    if (!id || !this.isTrustedUrl(thumbnail)) return null;
    const license = String(item.license || '').toLowerCase();
    if (!PERMISSIVE_LICENSES.has(license)) return null;
    return {
      provider: 'OPENVERSE',
      providerAssetId: id,
      previewUrl: thumbnail,
      downloadUrl: thumbnail,
      sourcePageUrl: String(item.foreign_landing_url),
      width: Number(item.width || 0),
      height: Number(item.height || 0),
      author: String(item.creator || 'Openverse contributor'),
      authorUrl: item.creator_url ? String(item.creator_url) : undefined,
      source: String(item.source || item.provider || 'UNKNOWN'),
      license,
      licenseVersion: item.license_version
        ? String(item.license_version)
        : undefined,
      licenseUrl: item.license_url ? String(item.license_url) : undefined,
      attribution: item.attribution ? String(item.attribution) : undefined,
      tags: (item.tags ?? [])
        .map((tag) => String(tag.name || '').trim())
        .filter(Boolean)
        .slice(0, 20),
      metadata: {
        aggregationProvider: 'OPENVERSE',
        upstreamProvider: item.provider || null,
        title: item.title || null,
        fullSizeUrl: item.url || null,
      },
    };
  }

  private queryHash(query: string) {
    return createHash('sha256')
      .update(query.toLowerCase())
      .digest('hex')
      .slice(0, 12);
  }

  private isTrustedUrl(value: string) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname === OPENVERSE_HOST;
    } catch {
      this.logger.warn('Rejected malformed Openverse URL');
      return false;
    }
  }
}
