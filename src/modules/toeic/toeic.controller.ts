import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AttemptMode, Role } from '@prisma/client';
import { ToeicService } from './toeic.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StartAttemptDto } from './dto/start-attempt.dto';
import { SaveAnswersDto } from './dto/save-answers.dto';
import { IntegrityEventDto } from './dto/integrity-event.dto';

@Controller('toeic')
export class ToeicController {
  constructor(private readonly toeicService: ToeicService) {}

  @Get('exams') getExams() {
    return this.toeicService.getExams();
  }

  @Get('exams/:examId/briefing')
  @UseGuards(JwtAuthGuard)
  getExamBriefing(@Param('examId') examId: string) {
    return this.toeicService.getExamBriefing(+examId);
  }

  @Get('exams/:examId')
  @UseGuards(JwtAuthGuard)
  getExamDetails(@Param('examId') examId: string) {
    return this.toeicService.getExamBriefing(+examId);
  }

  @Get('bundles/:quizId')
  @UseGuards(JwtAuthGuard)
  getBundle(@Param('quizId') quizId: string, @Req() req: any) {
    return this.toeicService.getBundle(+quizId, req.user?.role === Role.ADMIN);
  }

  @Get('groups/:groupId/audio')
  @UseGuards(JwtAuthGuard)
  async getGroupAudio(
    @Param('groupId') groupId: string,
    @Query('attemptId') attemptId: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const parsedGroupId = Number(groupId);
    const parsedAttemptId = Number(attemptId);
    if (
      !Number.isInteger(parsedGroupId) ||
      !Number.isInteger(parsedAttemptId) ||
      parsedGroupId < 1 ||
      parsedAttemptId < 1
    ) {
      return res.status(400).json({ message: 'Tham số audio không hợp lệ' });
    }
    const audioBuffer = await this.toeicService.generateGroupAudio(
      parsedGroupId,
      req.user.id,
      parsedAttemptId,
    );
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length,
      'Cache-Control': 'private, max-age=3600',
    });
    res.send(audioBuffer);
  }

  @Post('exams/:examId/attempts')
  @UseGuards(JwtAuthGuard)
  startAttempt(
    @Param('examId') examId: string,
    @Req() req: any,
    @Body() body: StartAttemptDto,
  ) {
    return this.toeicService.startAttempt(
      req.user.id,
      +examId,
      body?.mode ?? AttemptMode.PRACTICE,
    );
  }

  @Post('attempts/:id/begin')
  @UseGuards(JwtAuthGuard)
  beginAttempt(@Param('id') id: string, @Req() req: any) {
    return this.toeicService.beginAttempt(+id, req.user.id);
  }

  @Get('attempts/:id')
  @UseGuards(JwtAuthGuard)
  getAttempt(@Param('id') id: string, @Req() req: any) {
    return this.toeicService.getAttemptDetail(+id, req.user.id, req.user.role);
  }

  @Post('attempts/:id/cancel')
  @UseGuards(JwtAuthGuard)
  cancelAttempt(@Param('id') id: string, @Req() req: any) {
    return this.toeicService.cancelAttempt(+id, req.user.id);
  }

  @Get('attempts/:id/remaining-time')
  @UseGuards(JwtAuthGuard)
  getRemainingTime(@Param('id') id: string, @Req() req: any) {
    return this.toeicService.getRemainingTime(+id, req.user.id, req.user.role);
  }

  @Patch('attempts/:id/answers')
  @UseGuards(JwtAuthGuard)
  saveAnswers(
    @Param('id') id: string,
    @Req() req: any,
    @Body() body: SaveAnswersDto,
  ) {
    return this.toeicService.saveAnswers(+id, req.user.id, body.answers);
  }

  @Post('attempts/:id/submit')
  @UseGuards(JwtAuthGuard)
  submitAttempt(@Param('id') id: string, @Req() req: any) {
    return this.toeicService.submitAttempt(+id, req.user.id);
  }

  @Post('attempts/:id/integrity-events')
  @UseGuards(JwtAuthGuard)
  recordIntegrityEvent(
    @Param('id') id: string,
    @Req() req: any,
    @Body() body: IntegrityEventDto,
  ) {
    return this.toeicService.recordIntegrityEvent(
      +id,
      req.user.id,
      body.eventType,
      body.questionId,
      body.metadata,
    );
  }

  @Get('attempts/:id/result')
  @UseGuards(JwtAuthGuard)
  getResult(@Param('id') id: string, @Req() req: any) {
    return this.toeicService.getResult(+id, req.user.id, req.user.role);
  }
}
