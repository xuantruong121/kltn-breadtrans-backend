import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseInterceptors,
  UploadedFile,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiConsumes,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AiGeneratorService, PublishContentDto } from './ai-generator.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('Admin AI Generator')
@Controller('admin/ai-generator')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.TEACHER)
@ApiBearerAuth()
export class AiGeneratorController {
  constructor(private readonly aiGeneratorService: AiGeneratorService) {}

  @Get('quota-status')
  @ApiOperation({
    summary:
      'Lấy trạng thái Quota request Gemini AI trong ngày (Redis Counter)',
  })
  async getQuotaStatus() {
    return this.aiGeneratorService.getQuotaStatus();
  }

  @Post('upload')
  @ApiOperation({
    summary:
      'Tải lên tài liệu (PDF/DOCX) hoặc nhập text để AI sinh nội dung bất đồng bộ',
  })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async uploadDocument(
    @UploadedFile() file?: Express.Multer.File,
    @Body('text') text?: string,
    @Body('quizCount') quizCount?: string,
    @Body('flashcardCount') flashcardCount?: string,
  ) {
    return this.aiGeneratorService.startGenerationJob(file, text, {
      quizCount: quizCount ? parseInt(quizCount, 10) : 5,
      flashcardCount: flashcardCount ? parseInt(flashcardCount, 10) : 8,
    });
  }

  @Get(':jobId/status')
  @ApiOperation({ summary: 'Kiểm tra trạng thái và tiến độ xử lý của Job' })
  async getJobStatus(@Param('jobId') jobId: string) {
    return this.aiGeneratorService.getJobStatus(jobId);
  }

  @Get(':jobId/result')
  @ApiOperation({
    summary:
      'Lấy kết quả JSON có cấu trúc sau khi AI xử lý xong để Preview/Review',
  })
  async getJobResult(@Param('jobId') jobId: string) {
    return this.aiGeneratorService.getJobResult(jobId);
  }

  @Post(':jobId/publish')
  @ApiOperation({
    summary: 'Phê duyệt & Lưu chính thức nội dung đã chỉnh sửa vào Database',
  })
  async publishContent(
    @Param('jobId') jobId: string,
    @Body() payload: PublishContentDto,
  ) {
    return this.aiGeneratorService.publishContent(jobId, payload);
  }
}
