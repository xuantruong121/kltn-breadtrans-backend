import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DiagnosticService } from './diagnostic.service';

@ApiTags('diagnostic')
@Controller('diagnostic')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class DiagnosticController {
  constructor(private readonly diagnosticService: DiagnosticService) {}

  @Get('current')
  @ApiOperation({ summary: 'Lấy bài kiểm tra đầu vào đang hoạt động' })
  getCurrent(@Request() req: { user: { id: number } }) {
    return this.diagnosticService.getCurrentAssessment(req.user.id);
  }

  @Post(':id/attempts')
  @ApiOperation({
    summary: 'Nộp bài kiểm tra đầu vào và nhận kết quả từ server',
  })
  submit(
    @Request() req: { user: { id: number } },
    @Param('id', ParseIntPipe) id: number,
    @Body('answers') answers: Record<string, number>,
  ) {
    return this.diagnosticService.submitAssessment(req.user.id, id, answers);
  }
}
