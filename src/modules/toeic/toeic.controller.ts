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
import { AttemptMode } from '@prisma/client';
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
  getExamDetails(@Param('examId') examId: string) {
    return this.toeicService.getExamDetails(+examId);
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
  getRemainingTime(@Param('id') id: string) {
    return this.toeicService.getRemainingTime(+id);
  }

  @Patch('attempts/:id/answers')
  saveAnswers(
    @Param('id') id: string,
    @Body('answers') answers: Record<string, number>,
  ) {
    return this.toeicService.saveAnswers(+id, answers);
  }

  @Post('attempts/:id/submit')
  submitAttempt(@Param('id') id: string) {
    return this.toeicService.submitAttempt(+id);
  }

  @Get('attempts/:id/result')
  getResult(@Param('id') id: string) {
    return this.toeicService.getResult(+id);
  }
}
