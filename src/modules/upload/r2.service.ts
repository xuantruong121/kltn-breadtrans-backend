import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { extname } from 'path';

export interface R2UploadResult {
  /** URL công khai để access file */
  url: string;
  /** Key trong bucket (dùng để xóa sau này) */
  key: string;
  /** MIME type của file */
  contentType: string;
}

@Injectable()
export class R2Service {
  private readonly logger = new Logger(R2Service.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicUrl: string;

  constructor() {
    const accountId = process.env.R2_ACCOUNT_ID;
    const localEndpoint = process.env.LOCAL_S3_ENDPOINT?.trim();
    const localStorage = Boolean(localEndpoint);
    this.bucket = (
      (localStorage
        ? process.env.LOCAL_S3_BUCKET
        : process.env.R2_BUCKET_NAME) ?? 'breadtrans-files'
    ).trim();

    const customEndpoint = localEndpoint || process.env.R2_ENDPOINT;
    const endpoint =
      customEndpoint ||
      (accountId
        ? `https://${accountId}.r2.cloudflarestorage.com`
        : undefined);

    const configuredPublicUrl = (
      localStorage
        ? process.env.LOCAL_S3_PUBLIC_URL
        : process.env.R2_PUBLIC_URL
    )?.trim();
    this.publicUrl = (
      configuredPublicUrl ||
      (localStorage && endpoint
        ? `${endpoint.replace(/\/$/, '')}/${this.bucket}`
        : '')
    ).replace(/\/$/, '');

    const accessKeyId =
      (localStorage
        ? process.env.LOCAL_S3_ACCESS_KEY_ID
        : process.env.R2_ACCESS_KEY_ID) ?? '';
    const secretAccessKey =
      (localStorage
        ? process.env.LOCAL_S3_SECRET_ACCESS_KEY
        : process.env.R2_SECRET_ACCESS_KEY) ?? '';
    const forcePathStyle = localStorage
      ? this.parseBoolean(process.env.LOCAL_S3_FORCE_PATH_STYLE, true)
      : Boolean(customEndpoint);

    this.client = new S3Client({
      region: 'auto',
      ...(endpoint ? { endpoint } : {}),
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      forcePathStyle,
    });

    this.logger.log(
      `Storage provider: ${localStorage ? 'local-s3-compatible' : 'cloudflare-r2'}`,
    );
    if (endpoint) {
      try {
        this.logger.log(`Storage endpoint host: ${new URL(endpoint).host}`);
      } catch {
        this.logger.log('Storage endpoint host: configured');
      }
    }
    this.logger.log(`Bucket: ${this.bucket}`);
    this.logger.log(
      `Presigned upload mode: ${process.env.SPEAKING_AUDIO_UPLOAD_MODE === 'presigned' ? 'enabled' : 'disabled'}`,
    );
  }

  private parseBoolean(value: string | undefined, fallback: boolean): boolean {
    if (value === undefined) return fallback;
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  }

  /**
   * Truy vấn dung lượng thực tế đang lưu trên Cloudflare R2 bucket.
   */
  async getBucketStorageUsage(): Promise<{
    totalBytes: number;
    fileCount: number;
    totalMb: number;
  }> {
    try {
      const localStorage = Boolean(process.env.LOCAL_S3_ENDPOINT);
      const hasCredentials = localStorage
        ? Boolean(
            process.env.LOCAL_S3_ACCESS_KEY_ID &&
              process.env.LOCAL_S3_SECRET_ACCESS_KEY,
          )
        : Boolean(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID);
      if (!hasCredentials) {
        return { totalBytes: 0, fileCount: 0, totalMb: 0 };
      }
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
      });
      const response = await this.client.send(command);
      const objects = response.Contents || [];
      const totalBytes = objects.reduce((sum, obj) => sum + (obj.Size || 0), 0);
      const totalMb = Number((totalBytes / (1024 * 1024)).toFixed(2));
      return { totalBytes, fileCount: objects.length, totalMb };
    } catch (err) {
      this.logger.warn(`Could not query R2 bucket size: ${err}`);
      return { totalBytes: 0, fileCount: 0, totalMb: 0 };
    }
  }

  /**
   * Upload file buffer lên Cloudflare R2.
   * @param buffer   File buffer từ Multer
   * @param mimeType MIME type (vd: 'image/png', 'audio/mpeg')
   * @param folder   Thư mục trong bucket (vd: 'avatars', 'audio')
   * @param originalName Tên file gốc (để giữ extension)
   */
  async uploadFile(
    buffer: Buffer,
    mimeType: string,
    folder: string = 'uploads',
    originalName?: string,
  ): Promise<R2UploadResult> {
    const ext = originalName ? extname(originalName) : this.guessExt(mimeType);
    const key = `${folder}/${randomUUID()}${ext}`;

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: buffer,
          ContentType: mimeType,
        }),
      );

      const url = `${this.publicUrl}/${key}`;
      return { url, key, contentType: mimeType };
    } catch (err) {
      this.logger.error(`Failed to upload file to R2: ${err}`);
      throw new BadRequestException('Failed to upload file to storage');
    }
  }

  /** Upload a deterministic object key (used for immutable authored artifacts). */
  async putObjectAtKey(
    key: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<R2UploadResult> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      }),
    );
    return { key, url: `${this.publicUrl}/${key}`, contentType: mimeType };
  }

  getPublicUrl(): string {
    return this.publicUrl;
  }

  async headObject(key: string): Promise<{
    contentLength: number;
    contentType?: string;
    etag?: string;
  } | null> {
    try {
      const response = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        contentLength: response.ContentLength ?? 0,
        contentType: response.ContentType,
        etag: response.ETag?.replace(/^"|"$/g, ''),
      };
    } catch (error: any) {
      const code = (
        error as { name?: string; $metadata?: { httpStatusCode?: number } }
      ).$metadata?.httpStatusCode;
      if (
        code === 404 ||
        (error as { name?: string }).name === 'NotFound' ||
        (error as { name?: string }).name === 'NoSuchKey'
      ) {
        return null;
      }
      throw error;
    }
  }

  async objectExists(key: string): Promise<boolean> {
    const head = await this.headObject(key);
    return head !== null;
  }

  /**
   * Xóa file khỏi R2 bucket bằng key.
   */
  async deleteFile(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      this.logger.log(`Deleted "${key}" from R2`);
    } catch (err) {
      this.logger.error(`Failed to delete file from R2: ${err}`);
      throw new BadRequestException('Failed to delete file from storage');
    }
  }

  /**
   * Tạo presigned URL để client upload trực tiếp lên R2 (bỏ qua server).
   * Hữu ích cho file lớn (video, audio recording).
   * @param key      Key trong bucket
   * @param mimeType MIME type
   * @param expiresIn Thời gian hết hạn (giây), mặc định 10 phút (600s)
   */
  async getPresignedUploadUrl(
    key: string,
    mimeType: string,
    expiresIn: number = 600,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: mimeType,
    });
    return getSignedUrl(this.client, command, { expiresIn });
  }

  /**
   * Tạo Presigned URL cho phép client download trực tiếp file riêng tư.
   * Hết hạn sau `expiresIn` giây (mặc định 3600s = 1 giờ).
   */
  async getPresignedDownloadUrl(
    key: string,
    expiresIn = 3600,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.client, command, { expiresIn });
  }

  /**
   * Tải file buffer từ Cloudflare R2 bucket bằng key.
   */
  async downloadFileBuffer(key: string): Promise<Buffer> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    const response = await this.client.send(command);
    if (!response.Body) {
      throw new Error(`Empty response body from R2 for key: ${key}`);
    }
    const body = response.Body as
      { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
    if (body && typeof body.transformToByteArray === 'function') {
      const bytes = await body.transformToByteArray();
      return Buffer.from(bytes);
    }
    const chunks: Buffer[] = [];
    for await (const chunk of response.Body as any) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  /**
   * Tự đoán file extension từ MIME type nếu không có originalName.
   */
  private guessExt(mimeType: string): string {
    const map: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif',
      'audio/mpeg': '.mp3',
      'audio/wav': '.wav',
      'audio/webm': '.webm',
      'video/mp4': '.mp4',
      'video/webm': '.webm',
      'application/pdf': '.pdf',
    };
    return map[mimeType] ?? '';
  }
}
