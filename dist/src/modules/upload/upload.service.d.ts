export interface CloudinaryResponse {
    secure_url: string;
    public_id: string;
    format: string;
}
export declare class UploadService {
    private readonly logger;
    uploadFile(file: Express.Multer.File): Promise<CloudinaryResponse>;
}
