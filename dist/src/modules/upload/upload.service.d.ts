import { R2Service } from './r2.service';
export interface UploadResult {
    url: string;
    key: string;
    contentType: string;
}
export declare class UploadService {
    private readonly r2;
    private readonly logger;
    constructor(r2: R2Service);
    uploadFile(file: Express.Multer.File): Promise<UploadResult>;
    uploadRawBuffer(buffer: Buffer, mimeType: string, folder?: string, filename?: string): Promise<UploadResult>;
    deleteFile(key: string): Promise<void>;
    getPresignedUploadUrl(key: string, mimeType: string, expiresIn?: number): Promise<string>;
    private resolveFolder;
}
