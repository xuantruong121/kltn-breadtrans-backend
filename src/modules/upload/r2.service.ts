import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
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
    this.bucket = process.env.R2_BUCKET_NAME ?? 'breadtrans-files';
    this.publicUrl = (process.env.R2_PUBLIC_URL ?? '').replace(/\/$/, '');

    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
      },
    });
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
          // Cache 1 năm cho static assets
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
    } catch (err) {
      this.logger.error('R2 upload failed', err);
      throw new BadRequestException('Lỗi tải file lên Cloudflare R2');
    }

    return {
      url: `${this.publicUrl}/${key}`,
      key,
      contentType: mimeType,
    };
  }

  /**
   * Xóa file khỏi bucket theo key.
   */
  async deleteFile(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (err) {
      this.logger.warn(`R2 delete failed for key "${key}"`, err);
    }
  }

  /**
   * Tạo presigned URL để client upload trực tiếp lên R2 (bỏ qua server).
   * Hữu ích cho file lớn (video, audio recording).
   * @param key      Key trong bucket
   * @param mimeType MIME type
   * @param expiresIn Thời gian hết hạn (giây), mặc định 15 phút
   */
  async getPresignedUploadUrl(
    key: string,
    mimeType: string,
    expiresIn: number = 900,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: mimeType,
    });
    return getSignedUrl(this.client, command, { expiresIn });
  }

  /**
   * Tạo presigned URL để download file private (nếu bucket không public).
   */
  async getPresignedDownloadUrl(
    key: string,
    expiresIn: number = 3600,
  ): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn });
  }

  private guessExt(mimeType: string): string {
    const map: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif',
      'audio/mpeg': '.mp3',
      'audio/mp4': '.m4a',
      'audio/ogg': '.ogg',
      'audio/wav': '.wav',
      'video/mp4': '.mp4',
      'application/pdf': '.pdf',
    };
    return map[mimeType] ?? '';
  }
}
