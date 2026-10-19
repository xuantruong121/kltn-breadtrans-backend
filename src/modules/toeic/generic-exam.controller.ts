import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GenericExamService } from './generic-exam.service';

@Controller('exams')
export class GenericExamController {
  constructor(private readonly exams: GenericExamService) {}

  @Get()
  list() {
    return this.exams.listLearner();
  }

  @Get('templates')
  templates() {
    return this.exams.listTemplates();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.exams.getLearner(id);
  }
}
