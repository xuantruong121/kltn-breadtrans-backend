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

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'breadtrans',
          resource_type: 'auto', // Hỗ trợ cả image, video, pdf
        },
        (error, result) => {
          if (error) {
            this.logger.error('Error uploading file to Cloudinary', error);
            return reject(
              new BadRequestException('Lỗi tải file lên Cloudinary'),
            );
          }
          resolve(result as CloudinaryResponse);
        },
      );

      // Chuyển Buffer thành Stream và bắn lên Cloudinary
      streamifier.createReadStream(file.buffer).pipe(uploadStream);
    });
  }
}
