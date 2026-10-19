import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  ParseIntPipe,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { AdminExamService } from './admin-exam.service';
import { GenericExamService } from './generic-exam.service';
import { ToeicAiExamService } from './toeic-ai-exam.service';
import {
  CreateToeicAiExamDto,
  RegenerateToeicAiUnitDto,
} from './toeic-ai-exam.dto';
import { CreateGenericExamDto, UpdateGenericExamDto } from './generic-exam.dto';
import {
  SpeakingExerciseDto,
  SpeakingExerciseReorderDto,
} from '../content/skill-cms.dto';
import { SpeakingStimulusDto } from '../content/speaking-stimulus.dto';
import {
  CreateExamGroupDto,
  UpdateExamGroupDto,
  CreateExamQuestionDto,
  UpdateExamQuestionDto,
  ReorderExamGroupsDto,
} from './dto';

@ApiTags('admin-exams')
@Controller('admin/exams')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@ApiBearerAuth()
export class AdminExamController {
  constructor(
    private readonly adminExamService: AdminExamService,
    private readonly genericExamService: GenericExamService,
    private readonly toeicAiExamService: ToeicAiExamService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Admin: Lấy danh sách tất cả bộ đề thi' })
  getExams() {
    return this.genericExamService.listAdmin();
  }

  @Post('ai/generate')
  @ApiOperation({
    summary: 'Admin: tạo Draft TOEIC practice bằng AI theo batch',
  })
  startAiGeneration(@Body() dto: CreateToeicAiExamDto, @Req() req: any) {
    return this.toeicAiExamService.start(
      dto,
      req.user.id,
      req.headers['idempotency-key'],
    );
  }

  @Get('ai/jobs/:jobId')
  @ApiOperation({ summary: 'Admin: xem tiến độ tạo đề TOEIC AI' })
  getAiGenerationStatus(@Param('jobId') jobId: string) {
    return this.toeicAiExamService.status(jobId);
  }

  @Post('ai/jobs/:jobId/retry')
  @ApiOperation({ summary: 'Admin: thử lại job tạo đề TOEIC AI lỗi' })
  retryAiGeneration(@Param('jobId') jobId: string, @Req() req: any) {
    return this.toeicAiExamService.retry(jobId, req.user.id);
  }

  @Post('ai/jobs/:jobId/cancel')
  @ApiOperation({ summary: 'Admin: hủy job tạo đề TOEIC AI' })
  cancelAiGeneration(@Param('jobId') jobId: string, @Req() req: any) {
    return this.toeicAiExamService.cancel(jobId, req.user.id);
  }

  @Post(':id/ai/groups/:groupId/questions/:questionId/regenerate')
  regenerateAiQuestion(
    @Param('id', ParseIntPipe) id: number,
    @Param('groupId', ParseIntPipe) groupId: number,
    @Param('questionId', ParseIntPipe) questionId: number,
    @Body() dto: RegenerateToeicAiUnitDto,
  ) {
    return this.toeicAiExamService.regenerateQuestionCandidate(
      id,
      groupId,
      questionId,
      dto.topic,
    );
  }

  @Post(':id/ai/groups/:groupId/regenerate')
  regenerateAiGroup(
    @Param('id', ParseIntPipe) id: number,
    @Param('groupId', ParseIntPipe) groupId: number,
    @Body() dto: RegenerateToeicAiUnitDto,
  ) {
    return this.toeicAiExamService.regenerateGroupCandidate(
      id,
      groupId,
      dto.topic,
    );
  }

  @Post(':id/ai/parts/:part/regenerate')
  regenerateAiPart(
    @Param('id', ParseIntPipe) id: number,
    @Param('part', ParseIntPipe) part: number,
    @Body() dto: RegenerateToeicAiUnitDto,
  ) {
    return this.toeicAiExamService.regeneratePartCandidate(id, part, dto.topic);
  }

  @Post(':id/ai/groups/:groupId/media/:kind/regenerate')
  regenerateAiMedia(
    @Param('id', ParseIntPipe) id: number,
    @Param('groupId', ParseIntPipe) groupId: number,
    @Param('kind') kind: 'image' | 'audio',
  ) {
    if (!['image', 'audio'].includes(kind))
      throw new BadRequestException('Loại media không hợp lệ');
    return this.toeicAiExamService.regenerateMedia(id, groupId, kind);
  }

  @Get(':id/speaking/stimuli')
  getSpeakingStimuli(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.genericExamService.listSpeakingStimuli(id, req.user);
  }

  @Post(':id/speaking/stimuli')
  createSpeakingStimulus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SpeakingStimulusDto,
    @Req() req: any,
  ) {
    return this.genericExamService.createSpeakingStimulus(id, dto, req.user);
  }

  @Get(':id/speaking')
  getSpeakingAuthoring(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.genericExamService.getSpeakingAuthoring(id, req.user);
  }

  @Post(':id/speaking/exercises')
  createSpeakingExercise(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SpeakingExerciseDto,
    @Req() req: any,
  ) {
    return this.genericExamService.createSpeakingExercise(id, dto, req.user);
  }

  @Patch(':id/speaking/exercises/reorder')
  reorderSpeakingExercises(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SpeakingExerciseReorderDto,
    @Req() req: any,
  ) {
    return this.genericExamService.reorderSpeakingExercises(id, dto, req.user);
  }

  @Patch(':id/speaking/exercises/:exerciseId')
  updateSpeakingExercise(
    @Param('id', ParseIntPipe) id: number,
    @Param('exerciseId', ParseIntPipe) exerciseId: number,
    @Body() dto: SpeakingExerciseDto,
    @Req() req: any,
  ) {
    return this.genericExamService.updateSpeakingExercise(
      id,
      exerciseId,
      dto,
      req.user,
    );
  }

  @Delete(':id/speaking/exercises/:exerciseId')
  deleteSpeakingExercise(
    @Param('id', ParseIntPipe) id: number,
    @Param('exerciseId', ParseIntPipe) exerciseId: number,
    @Req() req: any,
  ) {
    return this.genericExamService.deleteSpeakingExercise(
      id,
      exerciseId,
      req.user,
    );
  }

  @Post(':id/speaking/publish')
  publishSpeakingSource(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: any,
  ) {
    return this.genericExamService.publishSpeakingSource(id, req.user);
  }

  @Post()
  @ApiOperation({ summary: 'Admin: Tạo bộ đề thi mới (DRAFT)' })
  createExam(@Body() dto: CreateGenericExamDto, @Req() req: any) {
    return this.genericExamService.createDraft(dto, req.user?.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Admin: Xem chi tiết bộ đề thi kèm các câu hỏi' })
  getExamDetail(@Param('id', ParseIntPipe) id: number) {
    return this.genericExamService.getAdmin(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Admin: Cập nhật thông tin cơ bản bộ đề thi' })
  updateExam(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateGenericExamDto,
  ) {
    return this.genericExamService.update(id, dto);
  }

  @Post(':id/publish')
  @ApiOperation({ summary: 'Admin: Kiểm tra hợp lệ và xuất bản đề thi' })
  publishExam(@Param('id', ParseIntPipe) id: number) {
    return this.genericExamService.publish(id);
  }

  @Post(':id/unpublish')
  @ApiOperation({ summary: 'Admin: Gỡ xuất bản đề thi (chuyển về DRAFT)' })
  unpublishExam(@Param('id', ParseIntPipe) id: number) {
    return this.genericExamService.unpublish(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Admin: Xóa đề thi (bảo vệ lịch sử thi)' })
  deleteExam(@Param('id', ParseIntPipe) id: number) {
    return this.genericExamService.delete(id);
  }

  // ============== GROUP ENDPOINTS ==============
  @Post(':examId/groups')
  @ApiOperation({ summary: 'Admin: Thêm nhóm câu hỏi vào đề thi' })
  addGroup(
    @Param('examId', ParseIntPipe) examId: number,
    @Body() dto: CreateExamGroupDto,
  ) {
    return this.genericExamService
      .resolveToeicExamId(examId)
      .then((childId) => this.adminExamService.addGroup(childId, dto));
  }

  @Patch(':examId/groups/:groupId')
  @ApiOperation({ summary: 'Admin: Cập nhật nhóm câu hỏi' })
  updateGroup(
    @Param('examId', ParseIntPipe) examId: number,
    @Param('groupId', ParseIntPipe) groupId: number,
    @Body() dto: UpdateExamGroupDto,
  ) {
    return this.genericExamService
      .resolveToeicExamId(examId)
      .then((childId) =>
        this.adminExamService.updateGroup(childId, groupId, dto),
      );
  }

  @Delete(':examId/groups/:groupId')
  @ApiOperation({
    summary: 'Admin: Xóa nhóm câu hỏi (kiểm tra ownership & history)',
  })
  deleteGroup(
    @Param('examId', ParseIntPipe) examId: number,
    @Param('groupId', ParseIntPipe) groupId: number,
  ) {
    return this.genericExamService
      .resolveToeicExamId(examId)
      .then((childId) => this.adminExamService.deleteGroup(childId, groupId));
  }

  @Post(':examId/reorder-groups')
  @ApiOperation({ summary: 'Admin: Sắp xếp thứ tự các nhóm trong đề' })
  reorderGroups(
    @Param('examId', ParseIntPipe) examId: number,
    @Body() dto: ReorderExamGroupsDto,
  ) {
    return this.genericExamService
      .resolveToeicExamId(examId)
      .then((childId) =>
        this.adminExamService.reorderGroups(childId, dto.groupIds),
      );
  }

  // ============== QUESTION ENDPOINTS ==============
  @Post(':examId/groups/:groupId/questions')
  @ApiOperation({ summary: 'Admin: Thêm câu hỏi vào nhóm' })
  addQuestion(
    @Param('examId', ParseIntPipe) examId: number,
    @Param('groupId', ParseIntPipe) groupId: number,
    @Body() dto: CreateExamQuestionDto,
  ) {
    return this.genericExamService
      .resolveToeicExamId(examId)
      .then((childId) =>
        this.adminExamService.addQuestion(childId, groupId, dto),
      );
  }

  @Patch(':examId/groups/:groupId/questions/:questionId')
  @ApiOperation({ summary: 'Admin: Cập nhật câu hỏi' })
  updateQuestion(
    @Param('examId', ParseIntPipe) examId: number,
    @Param('groupId', ParseIntPipe) groupId: number,
    @Param('questionId', ParseIntPipe) questionId: number,
    @Body() dto: UpdateExamQuestionDto,
  ) {
    return this.genericExamService
      .resolveToeicExamId(examId)
      .then((childId) =>
        this.adminExamService.updateQuestion(childId, groupId, questionId, dto),
      );
  }

  @Delete(':examId/groups/:groupId/questions/:questionId')
  @ApiOperation({
    summary: 'Admin: Xóa câu hỏi (kiểm tra nested ownership & history)',
  })
  deleteQuestion(
    @Param('examId', ParseIntPipe) examId: number,
    @Param('groupId', ParseIntPipe) groupId: number,
    @Param('questionId', ParseIntPipe) questionId: number,
  ) {
    return this.genericExamService
      .resolveToeicExamId(examId)
      .then((childId) =>
        this.adminExamService.deleteQuestion(childId, groupId, questionId),
      );
  }
}
