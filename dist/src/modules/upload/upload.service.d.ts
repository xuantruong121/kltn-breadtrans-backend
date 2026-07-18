export interface CloudinaryResponse {
    secure_url: string;
    public_id: string;
    format: string;
}
export declare class UploadService {
    private readonly logger;
    uploadFile(file: Express.Multer.File): Promise<CloudinaryResponse>;
    uploadStream(buffer: Buffer, options: {
        folder?: string;
        resource_type?: string;
    }): Promise<CloudinaryResponse>;
}
