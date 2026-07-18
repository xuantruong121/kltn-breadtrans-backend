import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  Request,
  Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiConsumes,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import { SpeakingService } from './speaking.service';
import { CreateExerciseDto } from './dto/create-exercise.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('Speaking Practice')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('speaking')
export class SpeakingController {
  constructor(private readonly speakingService: SpeakingService) {}

  // ── ADMIN / TEACHER: Quản lý bài tập ──────────────────────────────────────

  @Post('exercises')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.TEACHER)
  @ApiOperation({ summary: '[Admin/Teacher] Tạo bài tập phát âm mới' })
  createExercise(@Body() dto: CreateExerciseDto) {
    return this.speakingService.createExercise(dto);
  }

  // ── STUDENT: Xem & Làm bài ────────────────────────────────────────────────

  @Get('exercises')
  @ApiOperation({ summary: 'Lấy danh sách bài tập phát âm' })
  @ApiQuery({ name: 'category', required: false, enum: ['IELTS', 'TOEIC', 'GENERAL'] })
  findAllExercises(@Query('category') category?: string) {
    return this.speakingService.findAllExercises(category);
  }

  @Get('exercises/:id')
  @ApiOperation({ summary: 'Lấy thông tin chi tiết một bài tập' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.speakingService.findExerciseById(id);
  }

  @Post('exercises/:id/submit')
  @ApiOperation({
    summary: 'Nộp audio để AI chấm phát âm (Azure Speech)',
    description:
      'Upload file audio WAV (16kHz). Hệ thống sẽ dùng Azure để lấy điểm chi tiết và Gemini để sinh lời khuyên.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'File audio giọng đọc',
    schema: {
      type: 'object',
      required: ['audio'],
      properties: {
        audio: {
          type: 'string',
          format: 'binary',
          description: 'File audio (.wav) - tối đa 10MB',
        },
      },
    },
  })
  @UseInterceptors(FileInterceptor('audio'))
  submitAudio(
    @Param('id', ParseIntPipe) exerciseId: number,
    @Request() req: any,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 }),
        ],
      }),
    )
    audio: Express.Multer.File,
  ) {
    return this.speakingService.submitAudio(exerciseId, req.user.id, audio);
  }

  @Get('my-submissions')
  @ApiOperation({ summary: 'Xem lịch sử bài luyện phát âm của tôi' })
  getMySubmissions(@Request() req: any) {
    return this.speakingService.getMySubmissions(req.user.id);
  }
}
