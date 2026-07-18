import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import * as streamifier from 'streamifier';

export interface CloudinaryResponse {
  secure_url: string;
  public_id: string;
  format: string;
}

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  async uploadFile(file: Express.Multer.File): Promise<CloudinaryResponse> {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    return this.uploadStream(file.buffer, { folder: 'breadtrans', resource_type: 'auto' });
  }

  async uploadStream(
    buffer: Buffer,
    options: { folder?: string; resource_type?: string },
  ): Promise<CloudinaryResponse> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: options.folder || 'breadtrans',
          resource_type: (options.resource_type || 'auto') as any,
        },
        (error, result) => {
          if (error) {
            this.logger.error('Error uploading to Cloudinary', error);
            return reject(new BadRequestException('Lỗi tải file lên Cloudinary'));
          }
          resolve(result as CloudinaryResponse);
        },
      );
      streamifier.createReadStream(buffer).pipe(uploadStream);
    });
  }
}
