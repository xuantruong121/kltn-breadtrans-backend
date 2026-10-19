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

const CACHE_TTL_SECONDS = 24 * 60 * 60;
const MAX_RESULTS = 5;
const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;
const API_HOST = 'commons.wikimedia.org';
const MEDIA_HOSTS = new Set([
  'upload.wikimedia.org',
  'images.wikimedia.org',
  'commons.wikimedia.org',
]);
const USER_AGENT = 'BreadTrans/1.0 (KLTN educational platform)';

type MetadataValue = { value?: string };
type WikimediaPage = {
  pageid?: number;
  title?: string;
  imageinfo?: Array<{
    thumburl?: string;
    url?: string;
    descriptionurl?: string;
    mime?: string;
    width?: number;
    height?: number;
    thumbwidth?: number;
    thumbheight?: number;
    extmetadata?: Record<string, MetadataValue>;
  }>;
};

function clean(value?: string) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function licenseInfo(metadata: Record<string, MetadataValue>) {
  const shortName = clean(metadata.LicenseShortName?.value);
  const usageTerms = clean(metadata.UsageTerms?.value);
  const source = `${shortName} ${usageTerms}`.toLowerCase();
  if (
    /non[- ]?commercial|\bnd\b|no derivatives|\bsa\b|share[- ]alike/.test(
      source,
    )
  )
    return null;
  if (
    !/public domain|public-domain|\bpd\b|\bcc0\b|creative commons zero|^cc by(?:\s|$)/i.test(
      shortName || usageTerms,
    )
  )
    return null;
  return {
    license: shortName || usageTerms,
    licenseUrl: clean(metadata.LicenseUrl?.value) || undefined,
  };
}

@Injectable()
export class WikimediaCommonsImageSearchProvider implements ImageSearchProvider {
  private readonly logger = new Logger(
    WikimediaCommonsImageSearchProvider.name,
  );
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
    const cacheKey = `wikimedia:search:${createHash('sha256')
      .update(`${normalizedQuery.toLowerCase()}:${limit}`)
      .digest('hex')}`;
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
      candidate.provider !== 'WIKIMEDIA_COMMONS' ||
      !this.isTrustedUrl(candidate.downloadUrl)
    )
      throw new BadRequestException('Nguồn tải ảnh Wikimedia không hợp lệ');

    let url = candidate.downloadUrl;
    for (let redirect = 0; redirect <= 3; redirect += 1) {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(12_000),
        redirect: 'manual',
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location || redirect === 3)
          throw new BadRequestException(
            'Ảnh Wikimedia chuyển hướng quá nhiều lần',
          );
        const next = new URL(location, url).toString();
        if (!this.isTrustedUrl(next))
          throw new BadRequestException(
            'Ảnh Wikimedia chuyển hướng tới nguồn không được phép',
          );
        url = next;
        continue;
      }
      if (!response.ok)
        throw new ServiceUnavailableException(
          `Wikimedia không thể tải ảnh (HTTP ${response.status})`,
        );
      const length = Number(response.headers.get('content-length') || 0);
      if (length > MAX_DOWNLOAD_BYTES)
        throw new BadRequestException(
          'Ảnh Wikimedia vượt quá kích thước cho phép',
        );
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length || buffer.length > MAX_DOWNLOAD_BYTES)
        throw new BadRequestException('Ảnh Wikimedia không hợp lệ');
      return validateImageBuffer(buffer, response.headers.get('content-type'), {
        width: candidate.width,
        height: candidate.height,
      });
    }
    throw new BadRequestException('Không thể tải ảnh Wikimedia');
  }

  private async fetchSearch(query: string, limit: number) {
    const url = new URL(`https://${API_HOST}/w/api.php`);
    url.searchParams.set('action', 'query');
    url.searchParams.set('generator', 'search');
    url.searchParams.set('gsrsearch', `${query} filetype:bitmap`);
    url.searchParams.set('gsrnamespace', '6');
    url.searchParams.set('gsrlimit', String(limit));
    url.searchParams.set('prop', 'imageinfo');
    url.searchParams.set('iiprop', 'url|mime|size|extmetadata');
    url.searchParams.set('iiurlwidth', '1280');
    url.searchParams.set('format', 'json');
    url.searchParams.set('formatversion', '2');
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(12_000),
      });
    } catch (error) {
      this.logger.warn(
        `wikimedia_unavailable error=${error instanceof Error ? error.name : 'unknown'}`,
      );
      throw new ServiceUnavailableException(
        'Wikimedia Commons hiện không khả dụng',
      );
    }
    if (!response.ok)
      throw new ServiceUnavailableException(
        `Wikimedia Commons không khả dụng (HTTP ${response.status})`,
      );
    const body = (await response.json()) as {
      query?: { pages?: WikimediaPage[] };
    };
    return (body.query?.pages ?? [])
      .map((page) => this.normalize(page))
      .filter((candidate): candidate is ImageSearchCandidate =>
        Boolean(candidate),
      )
      .slice(0, limit);
  }

  private normalize(page: WikimediaPage): ImageSearchCandidate | null {
    const info = page.imageinfo?.[0];
    const title = clean(page.title);
    const mediaUrl = String(info?.thumburl || info?.url || '');
    const mime = String(info?.mime || '').toLowerCase();
    const metadata = info?.extmetadata ?? {};
    const license = licenseInfo(metadata);
    if (
      !page.pageid ||
      !title ||
      !mediaUrl ||
      !this.isTrustedUrl(mediaUrl) ||
      !['image/jpeg', 'image/png', 'image/webp'].includes(mime) ||
      !license
    )
      return null;
    const width = Number(info?.thumbwidth || info?.width || 0);
    const height = Number(info?.thumbheight || info?.height || 0);
    if (width < 160 || height < 120) return null;
    const author =
      clean(metadata.Artist?.value || metadata.Credit?.value) ||
      'Wikimedia Commons contributor';
    const sourcePageUrl =
      String(info?.descriptionurl || '') ||
      `https://${API_HOST}/wiki/${encodeURIComponent(title.replace(/\s+/g, '_'))}`;
    return {
      provider: 'WIKIMEDIA_COMMONS',
      providerAssetId: String(page.pageid),
      previewUrl: mediaUrl,
      downloadUrl: mediaUrl,
      sourcePageUrl,
      width,
      height,
      author,
      license: license.license,
      licenseUrl: license.licenseUrl,
      attribution:
        clean(metadata.Credit?.value || metadata.Artist?.value) || undefined,
      tags: title
        .replace(/^File:/i, '')
        .split(/[_\s,-]+/)
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 20),
      source: 'WIKIMEDIA_COMMONS',
      metadata: {
        title,
        mime,
        description: clean(metadata.ImageDescription?.value) || undefined,
        usageTerms: clean(metadata.UsageTerms?.value) || undefined,
      },
    };
  }

  private isTrustedUrl(value: string) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && MEDIA_HOSTS.has(url.hostname);
    } catch {
      return false;
    }
  }
}
