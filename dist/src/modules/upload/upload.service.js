"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var UploadService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.UploadService = void 0;
const common_1 = require("@nestjs/common");
const r2_service_1 = require("./r2.service");
let UploadService = UploadService_1 = class UploadService {
    r2;
    logger = new common_1.Logger(UploadService_1.name);
    constructor(r2) {
        this.r2 = r2;
    }
    async uploadFile(file) {
        if (!file) {
            throw new common_1.BadRequestException('No file provided');
        }
        const folder = this.resolveFolder(file.mimetype);
        const result = await this.r2.uploadFile(file.buffer, file.mimetype, folder, file.originalname);
        this.logger.log(`Uploaded "${file.originalname}" → ${result.url}`);
        return {
            url: result.url,
            key: result.key,
            contentType: result.contentType,
        };
    }
    async uploadRawBuffer(buffer, mimeType, folder = 'uploads', filename) {
        const result = await this.r2.uploadFile(buffer, mimeType, folder, filename);
        this.logger.log(`Uploaded raw buffer → ${result.url}`);
        return {
            url: result.url,
            key: result.key,
            contentType: result.contentType,
        };
    }
    async deleteFile(key) {
        await this.r2.deleteFile(key);
    }
    async getPresignedUploadUrl(key, mimeType, expiresIn = 900) {
        return this.r2.getPresignedUploadUrl(key, mimeType, expiresIn);
    }
    resolveFolder(mimeType) {
        if (mimeType.startsWith('image/'))
            return 'images';
        if (mimeType.startsWith('audio/'))
            return 'audio';
        if (mimeType.startsWith('video/'))
            return 'videos';
        if (mimeType === 'application/pdf')
            return 'documents';
        return 'uploads';
    }
};
exports.UploadService = UploadService;
exports.UploadService = UploadService = UploadService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [r2_service_1.R2Service])
], UploadService);
//# sourceMappingURL=upload.service.js.map