import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { IsBoolean, IsInt, Max, Min } from 'class-validator';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MistakesService } from './mistakes.service';

class AnswerMistakeDto {
  @IsInt()
  @Min(0)
  @Max(9)
  selectedIndex!: number;
}

class ResolveMistakeDto {
  @IsBoolean()
  resolved!: boolean;
}

@ApiTags('Mistakes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('mistakes')
export class MistakesController {
  constructor(private readonly mistakes: MistakesService) {}

  @Get('summary')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Số lỗi chưa khắc phục của học viên, theo kỹ năng' })
  @ApiResponse({ status: 200, description: 'Tổng số và số theo kỹ năng' })
  summary(@Request() req: any) {
    return this.mistakes.summary(req.user.id);
  }

  @Get('review')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Các câu đã sai để trả lời lại (không kèm đáp án)',
  })
  @ApiQuery({ name: 'skill', required: false })
  @ApiResponse({ status: 200, description: 'Tối đa 10 câu trắc nghiệm' })
  review(@Request() req: any, @Query('skill') skill?: string) {
    return this.mistakes.review(req.user.id, skill);
  }

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Sổ lỗi của học viên' })
  @ApiQuery({ name: 'skill', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ['open', 'resolved'] })
  @ApiQuery({ name: 'page', required: false })
  @ApiResponse({ status: 200, description: 'Danh sách lỗi, mới nhất trước' })
  list(
    @Request() req: any,
    @Query('skill') skill?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
  ) {
    return this.mistakes.list(req.user.id, {
      skill,
      status,
      page: Number(page),
    });
  }

  @Post(':id/answer')
  @HttpCode(200)
  @ApiOperation({ summary: 'Trả lời lại một câu đã sai' })
  @ApiResponse({ status: 200, description: 'Đúng hay sai, đáp án, lời giải' })
  @ApiResponse({ status: 400, description: 'Câu không trả lời lại được' })
  @ApiResponse({ status: 404, description: 'Không phải lỗi của học viên' })
  answer(
    @Request() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: AnswerMistakeDto,
  ) {
    return this.mistakes.answer(req.user.id, id, body.selectedIndex);
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Đánh dấu một lỗi đã khắc phục, hoặc mở lại' })
  @ApiResponse({ status: 200, description: 'Trạng thái mới' })
  @ApiResponse({ status: 404, description: 'Không phải lỗi của học viên' })
  resolve(
    @Request() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ResolveMistakeDto,
  ) {
    return this.mistakes.setResolved(req.user.id, id, body.resolved);
  }
}
