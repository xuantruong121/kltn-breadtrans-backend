import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ToeicAssessmentService } from './toeic-assessment.service';
import {
  CompleteToeicAssessmentComponentDto,
  CreateToeicAssessmentDto,
  SetToeicAssessmentComponentsDto,
  StartToeicAssessmentAttemptDto,
  UpdateToeicAssessmentDto,
} from './toeic-assessment.dto';

@Controller('admin/toeic/assessments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminToeicAssessmentController {
  constructor(private readonly assessments: ToeicAssessmentService) {}

  @Get()
  list() {
    return this.assessments.listAdmin();
  }

  @Post()
  create(@Body() dto: CreateToeicAssessmentDto, @Req() req: any) {
    return this.assessments.create(dto, req.user?.id);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.assessments.getAdmin(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateToeicAssessmentDto,
  ) {
    return this.assessments.update(id, dto);
  }

  @Patch(':id/components')
  setComponents(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetToeicAssessmentComponentsDto,
  ) {
    return this.assessments.setComponents(id, dto);
  }

  @Post(':id/publish')
  publish(@Param('id', ParseIntPipe) id: number) {
    return this.assessments.publish(id);
  }

  @Post(':id/unpublish')
  unpublish(@Param('id', ParseIntPipe) id: number) {
    return this.assessments.unpublish(id);
  }
}

@Controller('toeic/assessments')
@UseGuards(JwtAuthGuard)
export class ToeicAssessmentController {
  constructor(private readonly assessments: ToeicAssessmentService) {}

  @Get()
  list(@Req() req: any) {
    return this.assessments.listLearner(req.user.id, req.user.role);
  }

  @Get('history')
  history(@Req() req: any) {
    return this.assessments.history(req.user.id);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.assessments.getLearnerDetail(id, req.user.id, req.user.role);
  }

  @Post(':id/attempts')
  start(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: any,
    @Body() dto: StartToeicAssessmentAttemptDto,
  ) {
    return this.assessments.startAttempt(
      id,
      req.user.id,
      dto?.idempotencyKey,
      req.user.role,
    );
  }

  @Get('attempts/:attemptId')
  @ApiOperation({
    summary: 'Lượt làm bài kèm đồng hồ cả đề và đồng hồ từng phần',
    description:
      'totalLimitSeconds là tổng thời gian của đề (S&W 4800, 4 kỹ năng 12000); totalRemainingSeconds là thời gian còn lại của phần đang làm cộng đủ giới hạn các phần chưa mở. Mỗi phần vẫn có timeLimitSeconds và deadlineAt riêng.',
  })
  @ApiResponse({ status: 200, description: 'Lượt làm bài' })
  @ApiResponse({ status: 403, description: 'Không phải lượt của bạn' })
  getAttempt(
    @Param('attemptId', ParseIntPipe) attemptId: number,
    @Req() req: any,
  ) {
    return this.assessments.getAttempt(attemptId, req.user.id);
  }

  @Get('attempts/:attemptId/review')
  @ApiOperation({
    summary:
      'Kết quả từng câu Speaking/Writing và lượt L&R con (chỉ đọc, không chấm lại)',
  })
  @ApiResponse({ status: 200, description: 'Danh sách task theo thứ tự đề' })
  @ApiResponse({ status: 403, description: 'Không phải lượt của bạn' })
  getAttemptReview(
    @Param('attemptId', ParseIntPipe) attemptId: number,
    @Req() req: any,
  ) {
    return this.assessments.getAttemptReview(attemptId, req.user.id);
  }

  @Post('attempts/:attemptId/components/:componentId/start')
  startComponent(
    @Param('attemptId', ParseIntPipe) attemptId: number,
    @Param('componentId', ParseIntPipe) componentId: number,
    @Req() req: any,
  ) {
    return this.assessments.startComponent(attemptId, componentId, req.user.id);
  }

  @Post('attempts/:attemptId/components/:componentId/complete')
  @ApiOperation({
    summary: 'Nộp một phần của lượt làm bài',
    description:
      'Bài nói, bài viết chỉ được tính nếu nộp trước khi phần hết giờ cộng 30 giây; câu trả lời Writing gửi sau đó không được lưu.',
  })
  @ApiResponse({ status: 201, description: 'Lượt làm bài sau khi nộp phần' })
  completeComponent(
    @Param('attemptId', ParseIntPipe) attemptId: number,
    @Param('componentId', ParseIntPipe) componentId: number,
    @Req() req: any,
    @Body() dto: CompleteToeicAssessmentComponentDto,
  ) {
    return this.assessments.completeComponent(
      attemptId,
      componentId,
      req.user.id,
      dto,
    );
  }
}
