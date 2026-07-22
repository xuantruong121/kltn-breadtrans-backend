import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { R2Service, R2UploadResult } from './r2.service';

export interface UploadResult {
  /** URL công khai để truy cập file */
  url: string;
  /** Key trong R2 bucket (dùng để xóa) */
  key: string;
  /** MIME type */
  contentType: string;
}

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor(private readonly r2: R2Service) {}

  /**
   * Upload file từ Multer lên Cloudflare R2.
   * Tự động phân loại vào thư mục dựa theo MIME type.
   */
  async uploadFile(file: Express.Multer.File): Promise<UploadResult> {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    const folder = this.resolveFolder(file.mimetype);
    const result: R2UploadResult = await this.r2.uploadFile(
      file.buffer,
      file.mimetype,
      folder,
      file.originalname,
    );

    this.logger.log(`Uploaded "${file.originalname}" → ${result.url}`);

    return {
      url: result.url,
      key: result.key,
      contentType: result.contentType,
    };
  }

  /**
   * Upload raw buffer (không qua Multer) lên R2.
   * Dùng khi các module khác (AI TTS, Speaking...) tạo buffer trực tiếp.
   */
  async uploadRawBuffer(
    buffer: Buffer,
    mimeType: string,
    folder: string = 'uploads',
    filename?: string,
  ): Promise<UploadResult> {
    const result: R2UploadResult = await this.r2.uploadFile(
      buffer,
      mimeType,
      folder,
      filename,
    );

    this.logger.log(`Uploaded raw buffer → ${result.url}`);

    return {
      url: result.url,
      key: result.key,
      contentType: result.contentType,
    };
  }


  /**
   * Xóa file theo key (khi user đổi avatar / xóa tài liệu).
   */
  async deleteFile(key: string): Promise<void> {
    await this.r2.deleteFile(key);
  }

  /**
   * Lấy presigned URL để FE upload file lớn trực tiếp lên R2.
   */
  async getPresignedUploadUrl(
    key: string,
    mimeType: string,
    expiresIn = 900,
  ): Promise<string> {
    return this.r2.getPresignedUploadUrl(key, mimeType, expiresIn);
  }

  /** Phân loại thư mục theo MIME type */
  private resolveFolder(mimeType: string): string {
    if (mimeType.startsWith('image/')) return 'images';
    if (mimeType.startsWith('audio/')) return 'audio';
    if (mimeType.startsWith('video/')) return 'videos';
    if (mimeType === 'application/pdf') return 'documents';
    return 'uploads';
  }
}
