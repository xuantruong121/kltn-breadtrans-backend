import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
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
   * Truy vấn dung lượng thực tế đang lưu trên Cloudflare R2 bucket.
   */
  async getBucketStorageUsage(): Promise<{
    totalBytes: number;
    fileCount: number;
    totalMb: number;
  }> {
    try {
      if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID) {
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
