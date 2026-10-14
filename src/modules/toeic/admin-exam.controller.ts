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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { AdminExamService } from './admin-exam.service';
import {
  CreateExamSetDto,
  UpdateExamSetDto,
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
  constructor(private readonly adminExamService: AdminExamService) {}

  @Get()
  @ApiOperation({ summary: 'Admin: Lấy danh sách tất cả bộ đề thi' })
  getExams() {
    return this.adminExamService.getExams();
  }

  @Post()
  @ApiOperation({ summary: 'Admin: Tạo bộ đề thi mới (DRAFT)' })
  createExam(@Body() dto: CreateExamSetDto, @Req() req: any) {
    return this.adminExamService.createExam(dto, req.user?.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Admin: Xem chi tiết bộ đề thi kèm các câu hỏi' })
  getExamDetail(@Param('id', ParseIntPipe) id: number) {
    return this.adminExamService.getExamDetail(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Admin: Cập nhật thông tin cơ bản bộ đề thi' })
  updateExam(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateExamSetDto,
  ) {
    return this.adminExamService.updateExam(id, dto);
  }

  @Post(':id/publish')
  @ApiOperation({ summary: 'Admin: Kiểm tra hợp lệ và xuất bản đề thi' })
  publishExam(@Param('id', ParseIntPipe) id: number) {
    return this.adminExamService.publishExam(id);
  }

  @Post(':id/unpublish')
  @ApiOperation({ summary: 'Admin: Gỡ xuất bản đề thi (chuyển về DRAFT)' })
  unpublishExam(@Param('id', ParseIntPipe) id: number) {
    return this.adminExamService.unpublishExam(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Admin: Xóa đề thi (bảo vệ lịch sử thi)' })
  deleteExam(@Param('id', ParseIntPipe) id: number) {
    return this.adminExamService.deleteExam(id);
  }

  // ============== GROUP ENDPOINTS ==============
  @Post(':examId/groups')
  @ApiOperation({ summary: 'Admin: Thêm nhóm câu hỏi vào đề thi' })
  addGroup(
    @Param('examId', ParseIntPipe) examId: number,
    @Body() dto: CreateExamGroupDto,
  ) {
    return this.adminExamService.addGroup(examId, dto);
  }

  @Patch(':examId/groups/:groupId')
  @ApiOperation({ summary: 'Admin: Cập nhật nhóm câu hỏi' })
  updateGroup(
    @Param('examId', ParseIntPipe) examId: number,
    @Param('groupId', ParseIntPipe) groupId: number,
    @Body() dto: UpdateExamGroupDto,
  ) {
    return this.adminExamService.updateGroup(examId, groupId, dto);
  }

  @Delete(':examId/groups/:groupId')
  @ApiOperation({ summary: 'Admin: Xóa nhóm câu hỏi (kiểm tra ownership & history)' })
  deleteGroup(
    @Param('examId', ParseIntPipe) examId: number,
    @Param('groupId', ParseIntPipe) groupId: number,
  ) {
    return this.adminExamService.deleteGroup(examId, groupId);
  }

  @Post(':examId/reorder-groups')
  @ApiOperation({ summary: 'Admin: Sắp xếp thứ tự các nhóm trong đề' })
  reorderGroups(
    @Param('examId', ParseIntPipe) examId: number,
    @Body() dto: ReorderExamGroupsDto,
  ) {
    return this.adminExamService.reorderGroups(examId, dto.groupIds);
  }

  // ============== QUESTION ENDPOINTS ==============
  @Post(':examId/groups/:groupId/questions')
  @ApiOperation({ summary: 'Admin: Thêm câu hỏi vào nhóm' })
  addQuestion(
    @Param('examId', ParseIntPipe) examId: number,
    @Param('groupId', ParseIntPipe) groupId: number,
    @Body() dto: CreateExamQuestionDto,
  ) {
    return this.adminExamService.addQuestion(examId, groupId, dto);
  }

  @Patch(':examId/groups/:groupId/questions/:questionId')
  @ApiOperation({ summary: 'Admin: Cập nhật câu hỏi' })
  updateQuestion(
    @Param('examId', ParseIntPipe) examId: number,
    @Param('groupId', ParseIntPipe) groupId: number,
    @Param('questionId', ParseIntPipe) questionId: number,
    @Body() dto: UpdateExamQuestionDto,
  ) {
    return this.adminExamService.updateQuestion(
      examId,
      groupId,
      questionId,
      dto,
    );
  }

  @Delete(':examId/groups/:groupId/questions/:questionId')
  @ApiOperation({ summary: 'Admin: Xóa câu hỏi (kiểm tra nested ownership & history)' })
  deleteQuestion(
    @Param('examId', ParseIntPipe) examId: number,
    @Param('groupId', ParseIntPipe) groupId: number,
    @Param('questionId', ParseIntPipe) questionId: number,
  ) {
    return this.adminExamService.deleteQuestion(
      examId,
      groupId,
      questionId,
    );
  }
}
