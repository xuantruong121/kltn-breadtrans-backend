import {
  Controller,
  Post,
  Delete,
  Param,
  Body,
  UseInterceptors,
  UploadedFile,
  UseGuards,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
  Get,
  Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadService } from './upload.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '@prisma/client';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';

@ApiTags('upload')
@Controller('upload')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Upload file lên Cloudflare R2 (Ảnh, Audio, Video, PDF)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
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
  })
  async uploadFile(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 50 * 1024 * 1024 }), // 50MB
          new FileTypeValidator({
            fileType:
              /^(image\/(jpeg|png|webp|gif|svg\+xml)|audio\/(mpeg|mp3|mp4|ogg|wav|webm|aac|x-m4a)|video\/(mp4|webm|ogg|quicktime)|application\/pdf|application\/(msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document|vnd\.ms-powerpoint|vnd\.openxmlformats-officedocument\.presentationml\.presentation|vnd\.ms-excel|vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|zip|x-zip-compressed)|text\/plain)$/,
          }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    const result = await this.uploadService.uploadFile(file);
    return {
      message: 'Upload file thành công',
      url: result.url,
      key: result.key,
      contentType: result.contentType,
    };
  }

  @Delete('*key')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Xóa file khỏi R2 theo key' })
  @ApiParam({
    name: 'key',
    description: 'Key của file trong bucket R2 (vd: images/uuid.png)',
  })
  async deleteFile(@Param('key') key: string) {
    await this.uploadService.deleteFile(key);
    return { message: 'Đã xóa file thành công' };
  }

  @Get('presign')
  @ApiOperation({
    summary: 'Lấy presigned URL để FE upload file lớn trực tiếp lên R2',
  })
  @ApiQuery({
    name: 'key',
    description: 'Key muốn lưu trong bucket (vd: audio/my-recording.mp3)',
  })
  @ApiQuery({
    name: 'mimeType',
    description: 'MIME type của file (vd: audio/mpeg)',
  })
  @ApiQuery({
    name: 'expiresIn',
    required: false,
    description: 'Thời gian hết hạn (giây), mặc định 900s',
  })
  async getPresignedUrl(
    @Query('key') key: string,
    @Query('mimeType') mimeType: string,
    @Query('expiresIn') expiresIn?: number,
  ) {
    const url = await this.uploadService.getPresignedUploadUrl(
      key,
      mimeType,
      expiresIn,
    );
    return { presignedUrl: url, key };
  }
}
