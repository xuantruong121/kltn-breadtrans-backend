import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ToeicService } from './toeic.service';
import { AttemptMode, Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'; // Assume this exists based on standard NestJS auth

@Controller('toeic')
@UseGuards(JwtAuthGuard)
export class ToeicController {
  constructor(private readonly toeicService: ToeicService) {}

  @Get('exams')
  getExams() {
    return this.toeicService.getExams();
  }

  @Get('exams/:examId')
  getExamDetails(@Param('examId') examId: string, @Req() req: any) {
    const isStaff =
      req.user?.role === Role.ADMIN || req.user?.role === Role.TEACHER;
    return this.toeicService.getExamDetails(+examId, isStaff);
  }

  @Post('exams/:examId/attempts')
  startAttempt(
    @Param('examId') examId: string,
    @Req() req: any,
    @Body('mode') mode: AttemptMode,
  ) {
    // req.user is populated by JwtAuthGuard
    return this.toeicService.startAttempt(
      req.user.id,
      +examId,
      mode || AttemptMode.PRACTICE,
    );
  }

  @Get('attempts/:id/remaining-time')
  getRemainingTime(@Param('id') id: string, @Req() req: any) {
    return this.toeicService.getRemainingTime(+id, req.user.id, req.user.role);
  }

  @Patch('attempts/:id/answers')
  saveAnswers(
    @Param('id') id: string,
    @Req() req: any,
    @Body('answers') answers: Record<string, number>,
  ) {
    return this.toeicService.saveAnswers(+id, req.user.id, answers);
  }

  @Post('attempts/:id/submit')
  submitAttempt(@Param('id') id: string, @Req() req: any) {
    return this.toeicService.submitAttempt(+id, req.user.id);
  }

  @Get('attempts/:id/result')
  getResult(@Param('id') id: string, @Req() req: any) {
    return this.toeicService.getResult(+id, req.user.id, req.user.role);
  }
}
