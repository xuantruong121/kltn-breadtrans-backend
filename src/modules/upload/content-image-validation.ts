import { BadRequestException } from '@nestjs/common';

const RASTER_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const RASTER_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);

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

export function isValidContentImageUpload(
  buffer: Buffer,
  mimeType: string,
): boolean {
  const mime = mimeType.toLowerCase();
  return (
    (mime === 'image/png' && isPng(buffer)) ||
    (mime === 'image/jpeg' && isJpeg(buffer)) ||
    (mime === 'image/webp' && isWebp(buffer))
  );
}

export function assertValidContentImageUpload(file: Express.Multer.File): void {
  if (!RASTER_IMAGE_MIME_TYPES.has(file.mimetype.toLowerCase())) {
    throw new BadRequestException(
      'Ảnh nội dung chỉ hỗ trợ PNG, JPEG hoặc WEBP',
    );
  }
  if (!isValidContentImageUpload(file.buffer, file.mimetype)) {
    throw new BadRequestException(
      'Nội dung tệp ảnh không khớp với định dạng raster đã khai báo',
    );
  }
}

function configuredTrustedHosts(): Set<string> {
  const hosts = new Set<string>();
  for (const value of [
    process.env.R2_PUBLIC_URL,
    process.env.LOCAL_S3_PUBLIC_URL,
  ]) {
    if (!value?.trim()) continue;
    try {
      hosts.add(new URL(value).host.toLowerCase());
    } catch {
      /* refuse malformed config */
    }
  }
  return hosts;
}

/** Drafts may retain unresolved URLs; only trusted raster assets are publishable. */
export function isAcceptedContentImageReference(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  if (
    url.protocol !== 'https:' &&
    !(process.env.NODE_ENV !== 'production' && url.protocol === 'http:')
  )
    return false;
  const extension = url.pathname.split('.').pop()?.toLowerCase();
  if (!extension || !RASTER_IMAGE_EXTENSIONS.has(extension)) return false;
  const host = url.host.toLowerCase();
  return host.endsWith('.r2.dev') || configuredTrustedHosts().has(host);
}
