import { UploadService } from './upload.service';
export declare class UploadController {
    private readonly uploadService;
    constructor(uploadService: UploadService);
    uploadFile(file: Express.Multer.File): Promise<{
        message: string;
        url: string;
        key: string;
        contentType: string;
    }>;
    deleteFile(key: string): Promise<{
        message: string;
    }>;
    getPresignedUrl(key: string, mimeType: string, expiresIn?: number): Promise<{
        presignedUrl: string;
        key: string;
    }>;
}
