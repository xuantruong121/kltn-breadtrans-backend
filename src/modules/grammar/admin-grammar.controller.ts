import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GrammarService } from './grammar.service';

/** Admin-only grammar views; /grammar/topics stays the learner catalog. */
@ApiTags('Grammar')
@ApiBearerAuth()
@Controller('admin/grammar')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminGrammarController {
  constructor(private readonly grammarService: GrammarService) {}

  @Get('topics')
  @ApiOperation({
    summary:
      '[Admin] Chủ đề ngữ pháp kèm số lượt học viên đã làm; gửi page để nhận một trang đã lọc',
  })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({
    name: 'level',
    required: false,
    enum: ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'],
  })
  @ApiQuery({ name: 'status', required: false, enum: ['DRAFT', 'PUBLISHED'] })
  @ApiQuery({
    name: 'sort',
    required: false,
    enum: ['NEWEST', 'TITLE', 'LEVEL', 'FEWEST'],
  })
  @ApiResponse({
    status: 200,
    description:
      'Mảng (không có page) hoặc { items, total, page, pageSize, facets }',
  })
  getTopics(@Query() query: Record<string, string | undefined>) {
    return this.grammarService.getAdminTopics(query);
  }
}
