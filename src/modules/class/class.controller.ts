import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { ClassService } from './class.service';

@ApiTags('Classes')
@Controller('classes')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClassController {
  constructor(private readonly classService: ClassService) {}

  @Post(':classId/sessions')
  @Roles(Role.ADMIN, Role.TEACHER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Tạo buổi học mới (Session)' })
  createSession(
    @Param('classId', ParseIntPipe) classId: number,
    @Body() dto: any,
  ) {
    return this.classService.createSession(classId, dto);
  }

  @Get(':classId')
  @ApiOperation({ summary: 'Lấy chi tiết lớp học (Course, Lessons, Sessions, Assignments)' })
  getClassDetail(
    @Param('classId', ParseIntPipe) classId: number,
    @Request() req: any
  ) {
    return this.classService.getClassDetail(classId, req.user.id, req.user.role);
  }
}
