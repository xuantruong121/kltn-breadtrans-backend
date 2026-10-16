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
    return this.assessments.listLearner(req.user.id);
  }

  @Get('history')
  history(@Req() req: any) {
    return this.assessments.history(req.user.id);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.assessments.getLearnerDetail(id, req.user.id);
  }

  @Post(':id/attempts')
  start(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: any,
    @Body() dto: StartToeicAssessmentAttemptDto,
  ) {
    return this.assessments.startAttempt(id, req.user.id, dto?.idempotencyKey);
  }

  @Get('attempts/:attemptId')
  getAttempt(
    @Param('attemptId', ParseIntPipe) attemptId: number,
    @Req() req: any,
  ) {
    return this.assessments.getAttempt(attemptId, req.user.id);
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
