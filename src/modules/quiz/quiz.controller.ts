import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  Req,
  Query,
  ParseIntPipe,
  Res,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
} from '@nestjs/common';
import type { Response } from 'express';
import { QuizService } from './quiz.service';
import {
  CreateQuizDto,
  CreateQuestionDto,
  SubmitQuizDto,
  CheckPracticeQuestionDto,
  SaveListeningAttemptDto,
  PublishQuizDto,
} from './dto/quiz.dto';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiConsumes,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { ListeningAudioAuthoringService } from './listening-audio-authoring.service';

@ApiTags('quizzes')
@Controller('quizzes')
export class QuizController {
  constructor(
    private readonly quizService: QuizService,
    private readonly listeningAudioAuthoringService: ListeningAudioAuthoringService,
  ) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Tạo bài trắc nghiệm (Admin)' })
  createQuiz(@Body() dto: CreateQuizDto, @Request() req: any) {
    return this.quizService.createQuiz(dto, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Cập nhật đề thi (Admin)' })
  updateQuiz(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: Partial<CreateQuizDto>,
    @Request() req: any,
  ) {
    return this.quizService.updateQuiz(id, dto, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Patch(':id/publication')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Đổi trạng thái xuất bản bài luyện nghe' })
  publishQuiz(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PublishQuizDto,
  ) {
    return this.quizService.publishQuiz(id, dto.status);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Xóa đề thi (Admin)' })
  deleteQuiz(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.quizService.deleteQuiz(id, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Lấy tất cả quizzes (Admin)' })
  getAllQuizzes() {
    return this.quizService.getAllQuizzes();
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get('listening-practice')
  @ApiOperation({ summary: 'Lấy danh sách các bài Luyện Nghe (Nghe Chép)' })
  getListeningPractices(@Request() req: any) {
    return this.quizService.getListeningPractices(req.user?.id);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get('toeic-papers')
  @ApiOperation({ summary: 'Lấy danh sách đề TOEIC 2 và 4 kỹ năng' })
  getToeicPapers(@Request() req: any) {
    return this.quizService.getToeicPapers(req.user?.id);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post(':quizId/listening-attempts')
  @ApiOperation({ summary: 'Tạo hoặc khôi phục phiên luyện nghe' })
  getOrCreateListeningAttempt(
    @Param('quizId', ParseIntPipe) quizId: number,
    @Request() req: any,
  ) {
    return this.quizService.getOrCreateListeningAttempt(req.user.id, quizId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Patch(':quizId/listening-attempts/:attemptId')
  @ApiOperation({ summary: 'Lưu tiến độ phiên luyện nghe' })
  saveListeningAttempt(
    @Param('quizId', ParseIntPipe) quizId: number,
    @Param('attemptId', ParseIntPipe) attemptId: number,
    @Body() dto: SaveListeningAttemptDto,
    @Request() req: any,
  ) {
    return this.quizService.saveListeningAttempt(
      req.user.id,
      quizId,
      attemptId,
      dto,
    );
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post(':quizId/listening-attempts/:attemptId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hủy phiên luyện nghe đang làm dở' })
  cancelListeningAttempt(
    @Param('quizId', ParseIntPipe) quizId: number,
    @Param('attemptId', ParseIntPipe) attemptId: number,
    @Request() req: any,
  ) {
    return this.quizService.cancelListeningAttempt(
      req.user.id,
      quizId,
      attemptId,
    );
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get(':quizId/questions/:questionId/audio')
  @ApiOperation({ summary: 'Phát audio cho một câu luyện nghe' })
  async streamQuestionAudio(
    @Param('quizId', ParseIntPipe) quizId: number,
    @Param('questionId', ParseIntPipe) questionId: number,
    @Query('artifactId') artifactId: string | undefined,
    @Query('v') version: string | undefined,
    @Query('checksum') checksumSha256: string | undefined,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const result = await this.quizService.streamQuestionAudio(
      quizId,
      questionId,
      this.parseAudioIdentity(artifactId, version, checksumSha256),
    );
    return this.sendListeningAudio(res, req, result);
  }

  private parseAudioIdentity(
    artifactId?: string,
    version?: string,
    checksumSha256?: string,
  ) {
    return {
      ...(artifactId && Number.isInteger(Number(artifactId))
        ? { artifactId: Number(artifactId) }
        : {}),
      ...(version && Number.isInteger(Number(version))
        ? { version: Number(version) }
        : {}),
      ...(checksumSha256 ? { checksumSha256 } : {}),
    };
  }

  private sendListeningAudio(
    res: Response,
    req: any,
    result:
      | Buffer
      | {
          buffer: Buffer;
          artifact?: {
            id: number;
            version: number;
            checksumSha256: string | null;
            durationMs: number | null;
          } | null;
        },
  ) {
    const payload = Buffer.isBuffer(result)
      ? { buffer: result, artifact: null }
      : result;
    const checksum = payload.artifact?.checksumSha256;
    const etag = checksum ? `"${checksum}"` : undefined;
    if (etag && req.headers?.['if-none-match'] === etag) {
      res.status(HttpStatus.NOT_MODIFIED).end();
      return;
    }
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': payload.buffer.length,
      'Cache-Control': etag
        ? 'private, max-age=31536000, immutable'
        : 'private, no-cache',
      Vary: 'Authorization',
      ...(etag ? { ETag: etag } : {}),
      ...(payload.artifact
        ? {
            'X-Listening-Audio-Artifact-Id': String(payload.artifact.id),
            'X-Listening-Audio-Version': String(payload.artifact.version),
            'X-Listening-Audio-Checksum': payload.artifact.checksumSha256 ?? '',
            'X-Listening-Audio-Duration-Ms': String(
              payload.artifact.durationMs ?? '',
            ),
          }
        : {}),
    });
    res.send(payload.buffer);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post(':quizId/questions/:questionId/check')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Kiểm tra đáp án tức thời cho bài luyện nghe' })
  checkPracticeQuestion(
    @Param('quizId', ParseIntPipe) quizId: number,
    @Param('questionId', ParseIntPipe) questionId: number,
    @Body() dto: CheckPracticeQuestionDto,
  ) {
    return this.quizService.checkPracticeQuestion(quizId, questionId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post(':quizId/transcript/reveal')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ghi nhận học viên chủ động xem transcript' })
  revealListeningTranscript(
    @Request() req: any,
    @Param('quizId', ParseIntPipe) quizId: number,
  ) {
    return this.quizService.revealListeningTranscript(req.user.id, quizId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get(':quizId/transcript')
  @ApiOperation({ summary: 'Lấy toàn bộ transcript của bài nghe chép' })
  getListeningTranscript(
    @Request() req: any,
    @Param('quizId', ParseIntPipe) quizId: number,
  ) {
    return this.quizService.getListeningTranscript(req.user.id, quizId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get(':quizId/transcript/audio')
  @ApiOperation({
    summary: 'Phát một audio liền mạch cho toàn bộ bài nghe chép',
  })
  async streamListeningTranscriptAudio(
    @Param('quizId', ParseIntPipe) quizId: number,
    @Query('artifactId') artifactId: string | undefined,
    @Query('v') version: string | undefined,
    @Query('checksum') checksumSha256: string | undefined,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const result = await this.quizService.streamListeningTranscriptAudio(
      quizId,
      this.parseAudioIdentity(artifactId, version, checksumSha256),
    );
    return this.sendListeningAudio(res, req, result);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Post(':quizId/listening-audio/validate')
  @Roles(Role.ADMIN)
  validateListeningAudio(@Param('quizId', ParseIntPipe) quizId: number) {
    return this.listeningAudioAuthoringService.validateContent(quizId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Post(':quizId/listening-audio/generate-preview')
  @Roles(Role.ADMIN)
  generateListeningAudioPreview(
    @Param('quizId', ParseIntPipe) quizId: number,
    @Request() req: any,
  ) {
    return this.listeningAudioAuthoringService.generatePreview(
      quizId,
      req.user.id,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Get(':quizId/listening-audio')
  @Roles(Role.ADMIN)
  getListeningAudioArtifact(@Param('quizId', ParseIntPipe) quizId: number) {
    return this.listeningAudioAuthoringService.listArtifacts(quizId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Post(':quizId/listening-audio/:artifactId/approve')
  @Roles(Role.ADMIN)
  approveListeningAudio(
    @Param('quizId', ParseIntPipe) quizId: number,
    @Param('artifactId', ParseIntPipe) artifactId: number,
    @Request() req: any,
  ) {
    return this.listeningAudioAuthoringService.approve(
      quizId,
      artifactId,
      req.user.id,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Post(':quizId/listening-audio/:artifactId/publish')
  @Roles(Role.ADMIN)
  publishListeningAudio(
    @Param('quizId', ParseIntPipe) quizId: number,
    @Param('artifactId', ParseIntPipe) artifactId: number,
    @Request() req: any,
  ) {
    return this.listeningAudioAuthoringService.publish(
      quizId,
      artifactId,
      req.user.id,
    );
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id')
  @ApiOperation({ summary: 'Lấy chi tiết Quiz và danh sách Questions' })
  getQuizById(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    const isStaff = req.user?.role === Role.ADMIN;
    return this.quizService.getQuizById(id, isStaff, req.user?.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Post(':id/questions')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Thêm câu hỏi vào Quiz (Admin)' })
  createQuestion(
    @Param('id', ParseIntPipe) quizId: number,
    @Body() dto: CreateQuestionDto,
  ) {
    return this.quizService.createQuestion(quizId, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Post('questions/:questionId/audio-assets')
  @Roles(Role.ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Tải audio phiên bản mới cho câu luyện nghe' })
  createAudioAsset(
    @Param('questionId', ParseIntPipe) questionId: number,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 50 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: /^audio\// }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.quizService.createAudioAsset(questionId, file);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Post('questions/:questionId/audio-assets/generate-dialogue')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Sinh audio đa giọng cho câu hội thoại' })
  generateDialogueAudio(@Param('questionId', ParseIntPipe) questionId: number) {
    return this.quizService.generateDialogueAudioAsset(questionId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Post('questions/:questionId/diagnostic-clips')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Gắn clip audio chẩn đoán cho câu luyện nghe' })
  createDiagnosticClip(
    @Param('questionId', ParseIntPipe) questionId: number,
    @Body()
    dto: {
      label: string;
      key: string;
      url: string;
      startMs?: number;
      endMs?: number;
    },
  ) {
    return this.quizService.createDiagnosticClip(questionId, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Patch('questions/:questionId')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Cập nhật câu hỏi trong Quiz (Admin)' })
  updateQuestion(
    @Param('questionId', ParseIntPipe) questionId: number,
    @Body() dto: Partial<CreateQuestionDto>,
  ) {
    return this.quizService.updateQuestion(questionId, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Delete('questions/:questionId')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Xóa câu hỏi khỏi Quiz (Admin)' })
  deleteQuestion(@Param('questionId', ParseIntPipe) questionId: number) {
    return this.quizService.deleteQuestion(questionId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post(':id/submit')
  @ApiOperation({ summary: 'Nộp bài và chấm điểm tự động (cơ bản)' })
  submitQuiz(
    @Param('id', ParseIntPipe) quizId: number,
    @Body() dto: SubmitQuizDto,
    @Request() req: any,
  ) {
    return this.quizService.submitQuiz(quizId, req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('submissions/:id/analytics')
  @ApiOperation({
    summary:
      'Báo cáo phân tích điểm mạnh, điểm yếu và lỗ hổng kiến thức sau khi nộp bài',
  })
  getSubmissionAnalytics(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: any,
  ) {
    return this.quizService.getSubmissionAnalytics(
      id,
      req.user.id,
      req.user.role,
    );
  }

  @Post('score-conversion')
  @ApiOperation({
    summary:
      'Quy đổi số câu đúng Listening/Reading ra thang điểm TOEIC (10 - 990)',
  })
  calculateToeicScore(
    @Body('listeningCorrect') listeningCorrect: number,
    @Body('readingCorrect') readingCorrect: number,
  ) {
    return this.quizService.calculateToeicScore(
      listeningCorrect,
      readingCorrect,
    );
  }
}
