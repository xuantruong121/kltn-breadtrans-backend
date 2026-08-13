import { Controller, Get, Post, Body, Param, Put, UseGuards, Request, ParseIntPipe } from '@nestjs/common';
import { AssignmentService } from './assignment.service';
import { CreateAssignmentDto, SubmitAssignmentDto, GradeAssignmentDto } from './dto/assignment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

@ApiTags('assignments')
@Controller('courses')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class AssignmentController {
  constructor(private readonly assignmentService: AssignmentService) {}

  @Post('classes/:classId/assignments')
  @Roles(Role.TEACHER, Role.ADMIN)
  @ApiOperation({ summary: 'Giao bài tập mới cho lớp' })
  createAssignment(
    @Param('classId', ParseIntPipe) classId: number,
    @Body() dto: CreateAssignmentDto
  ) {
    return this.assignmentService.createAssignment(classId, dto);
  }

  @Get('classes/:classId/assignments')
  @ApiOperation({ summary: 'Lấy danh sách bài tập của lớp' })
  getAssignments(
    @Param('classId', ParseIntPipe) classId: number,
    @Request() req: any
  ) {
    return this.assignmentService.getAssignmentsByClass(classId, req.user.id, req.user.role);
  }

  @Get('assignments/:id')
  @ApiOperation({ summary: 'Chi tiết bài tập' })
  getAssignmentDetail(@Param('id', ParseIntPipe) id: number) {
    return this.assignmentService.getAssignmentDetail(id);
  }

  @Post('assignments/:id/submit')
  @Roles(Role.STUDENT)
  @ApiOperation({ summary: 'Học sinh nộp bài tập' })
  submitAssignment(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: any,
    @Body() dto: SubmitAssignmentDto
  ) {
    return this.assignmentService.submitAssignment(id, req.user.id, dto);
  }

  @Put('submissions/:id/grade')
  @Roles(Role.TEACHER, Role.ADMIN)
  @ApiOperation({ summary: 'Giáo viên chấm điểm bài tập' })
  gradeSubmission(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: GradeAssignmentDto
  ) {
    return this.assignmentService.gradeSubmission(id, dto);
  }
}
