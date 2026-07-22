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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UploadController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const upload_service_1 = require("./upload.service");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const swagger_1 = require("@nestjs/swagger");
let UploadController = class UploadController {
    uploadService;
    constructor(uploadService) {
        this.uploadService = uploadService;
    }
    async uploadFile(file) {
        const result = await this.uploadService.uploadFile(file);
        return {
            message: 'Upload file thành công',
            url: result.url,
            key: result.key,
            contentType: result.contentType,
        };
    }
    async deleteFile(key) {
        await this.uploadService.deleteFile(key);
        return { message: 'Đã xóa file thành công' };
    }
    async getPresignedUrl(key, mimeType, expiresIn) {
        const url = await this.uploadService.getPresignedUploadUrl(key, mimeType, expiresIn);
        return { presignedUrl: url, key };
    }
};
exports.UploadController = UploadController;
__decorate([
    (0, common_1.Post)(),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file')),
    (0, swagger_1.ApiOperation)({ summary: 'Upload file lên Cloudflare R2 (Ảnh, Audio, Video, PDF)' }),
    (0, swagger_1.ApiConsumes)('multipart/form-data'),
    (0, swagger_1.ApiBody)({
        schema: {
            type: 'object',
            properties: {
                file: {
                    type: 'string',
                    format: 'binary',
                    description: 'File cần tải lên (Tối đa 50MB)',
                },
            },
        },
    }),
    __param(0, (0, common_1.UploadedFile)(new common_1.ParseFilePipe({
        validators: [
            new common_1.MaxFileSizeValidator({ maxSize: 50 * 1024 * 1024 }),
            new common_1.FileTypeValidator({
                fileType: /^(image\/(jpeg|png|webp|gif)|audio\/(mpeg|mp4|ogg|wav)|video\/mp4|application\/pdf)$/,
            }),
        ],
    }))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UploadController.prototype, "uploadFile", null);
__decorate([
    (0, common_1.Delete)('*key'),
    (0, swagger_1.ApiOperation)({ summary: 'Xóa file khỏi R2 theo key' }),
    (0, swagger_1.ApiParam)({ name: 'key', description: 'Key của file trong bucket R2 (vd: images/uuid.png)' }),
    __param(0, (0, common_1.Param)('key')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], UploadController.prototype, "deleteFile", null);
__decorate([
    (0, common_1.Get)('presign'),
    (0, swagger_1.ApiOperation)({ summary: 'Lấy presigned URL để FE upload file lớn trực tiếp lên R2' }),
    (0, swagger_1.ApiQuery)({ name: 'key', description: 'Key muốn lưu trong bucket (vd: audio/my-recording.mp3)' }),
    (0, swagger_1.ApiQuery)({ name: 'mimeType', description: 'MIME type của file (vd: audio/mpeg)' }),
    (0, swagger_1.ApiQuery)({ name: 'expiresIn', required: false, description: 'Thời gian hết hạn (giây), mặc định 900s' }),
    __param(0, (0, common_1.Query)('key')),
    __param(1, (0, common_1.Query)('mimeType')),
    __param(2, (0, common_1.Query)('expiresIn')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Number]),
    __metadata("design:returntype", Promise)
], UploadController.prototype, "getPresignedUrl", null);
exports.UploadController = UploadController = __decorate([
    (0, swagger_1.ApiTags)('upload'),
    (0, common_1.Controller)('upload'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiBearerAuth)(),
    __metadata("design:paramtypes", [upload_service_1.UploadService])
], UploadController);
//# sourceMappingURL=upload.controller.js.map