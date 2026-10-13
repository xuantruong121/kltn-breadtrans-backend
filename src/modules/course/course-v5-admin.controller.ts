import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CourseV5AdminService } from './course-v5-admin.service';
import {
  CreateV5ExerciseDto,
  CreateV5LessonDto,
  CreateV5MediaDto,
  CreateV5QuestionDto,
  CreateV5SectionDto,
  ReorderV5Dto,
  UpdateV5CourseDto,
  UpdateV5ExerciseDto,
  UpdateV5LessonDto,
  UpdateV5QuestionDto,
  UpdateV5SectionDto,
} from './course-v5-admin.dto';

@ApiTags('admin-course-studio-v5')
@ApiBearerAuth()
@Controller('admin/courses')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class CourseV5AdminController {
  constructor(private readonly studio: CourseV5AdminService) {}
  @Get(':courseId/studio') get(
    @Param('courseId', ParseIntPipe) id: number,
    @Request() r: any,
  ) {
    return this.studio.getStudio(id, r.user);
  }
  @Patch(':courseId/studio') updateCourse(
    @Param('courseId', ParseIntPipe) id: number,
    @Body() dto: UpdateV5CourseDto,
    @Request() r: any,
  ) {
    return this.studio.updateCourse(id, dto, r.user);
  }
  @Post(':courseId/studio/lessons') createLesson(
    @Param('courseId', ParseIntPipe) id: number,
    @Body() dto: CreateV5LessonDto,
    @Request() r: any,
  ) {
    return this.studio.createLesson(id, dto, r.user);
  }
  @Patch(':courseId/studio/lessons/reorder') reorderLesson(
    @Param('courseId', ParseIntPipe) id: number,
    @Body() dto: ReorderV5Dto,
    @Request() r: any,
  ) {
    return this.studio.reorderLessons(id, dto, r.user);
  }
  @Patch(':courseId/studio/lessons/:lessonId') updateLesson(
    @Param('courseId', ParseIntPipe) c: number,
    @Param('lessonId', ParseIntPipe) l: number,
    @Body() dto: UpdateV5LessonDto,
    @Request() r: any,
  ) {
    return this.studio.updateLesson(c, l, dto, r.user);
  }
  @Delete(':courseId/studio/lessons/:lessonId') deleteLesson(
    @Param('courseId', ParseIntPipe) c: number,
    @Param('lessonId', ParseIntPipe) l: number,
    @Request() r: any,
  ) {
    return this.studio.deleteLesson(c, l, r.user);
  }
  @Post(':courseId/studio/lessons/:lessonId/publish') publishLesson(
    @Param('courseId', ParseIntPipe) c: number,
    @Param('lessonId', ParseIntPipe) l: number,
    @Request() r: any,
  ) {
    return this.studio.publishLesson(c, l, r.user);
  }
  @Post(':courseId/studio/lessons/:lessonId/sections') createSection(
    @Param('courseId', ParseIntPipe) c: number,
    @Param('lessonId', ParseIntPipe) l: number,
    @Body() dto: CreateV5SectionDto,
    @Request() r: any,
  ) {
    return this.studio.createSection(c, l, dto, r.user);
  }
  @Patch(':courseId/studio/lessons/:lessonId/sections/reorder') reorderSections(
    @Param('courseId', ParseIntPipe) c: number,
    @Param('lessonId', ParseIntPipe) l: number,
    @Body() dto: ReorderV5Dto,
    @Request() r: any,
  ) {
    return this.studio.reorderSections(c, l, dto, r.user);
  }
  @Patch(':courseId/studio/lessons/:lessonId/sections/:sectionId')
  updateSection(
    @Param('courseId', ParseIntPipe) c: number,
    @Param('lessonId', ParseIntPipe) l: number,
    @Param('sectionId', ParseIntPipe) s: number,
    @Body() dto: UpdateV5SectionDto,
    @Request() r: any,
  ) {
    return this.studio.updateSection(c, l, s, dto, r.user);
  }
  @Delete(':courseId/studio/lessons/:lessonId/sections/:sectionId')
  deleteSection(
    @Param('courseId', ParseIntPipe) c: number,
    @Param('lessonId', ParseIntPipe) l: number,
    @Param('sectionId', ParseIntPipe) s: number,
    @Request() r: any,
  ) {
    return this.studio.deleteSection(c, l, s, r.user);
  }
  @Post(':courseId/studio/lessons/:lessonId/media') media(
    @Param('courseId', ParseIntPipe) c: number,
    @Param('lessonId', ParseIntPipe) l: number,
    @Body() dto: CreateV5MediaDto,
    @Request() r: any,
  ) {
    return this.studio.attachMedia(c, l, dto, r.user);
  }
  @Post(':courseId/studio/lessons/:lessonId/media/presign') presign(
    @Param('courseId', ParseIntPipe) c: number,
    @Param('lessonId', ParseIntPipe) l: number,
    @Query('mimeType') m: string,
    @Request() r: any,
  ) {
    return this.studio.mediaPresign(c, l, m, r.user);
  }
  @Delete(':courseId/studio/lessons/:lessonId/media/:mediaId') unlinkMedia(
    @Param('courseId', ParseIntPipe) c: number,
    @Param('lessonId', ParseIntPipe) l: number,
    @Param('mediaId', ParseIntPipe) m: number,
    @Request() r: any,
  ) {
    return this.studio.unlinkMedia(c, l, m, r.user);
  }
  @Post(':courseId/studio/lessons/:lessonId/exercises') createExercise(
    @Param('courseId', ParseIntPipe) c: number,
    @Param('lessonId', ParseIntPipe) l: number,
    @Body() dto: CreateV5ExerciseDto,
    @Request() r: any,
  ) {
    return this.studio.createExercise(c, l, dto, r.user);
  }
  @Patch(':courseId/studio/lessons/:lessonId/exercises/reorder')
  reorderExercises(
    @Param('courseId', ParseIntPipe) c: number,
    @Param('lessonId', ParseIntPipe) l: number,
    @Body() dto: ReorderV5Dto,
    @Request() r: any,
  ) {
    return this.studio.reorderExercises(c, l, dto, r.user);
  }
  @Patch(':courseId/studio/lessons/:lessonId/exercises/:exerciseId')
  updateExercise(
    @Param('courseId', ParseIntPipe) c: number,
    @Param('lessonId', ParseIntPipe) l: number,
    @Param('exerciseId', ParseIntPipe) e: number,
    @Body() dto: UpdateV5ExerciseDto,
    @Request() r: any,
  ) {
    return this.studio.updateExercise(c, l, e, dto, r.user);
  }
  @Delete(':courseId/studio/lessons/:lessonId/exercises/:exerciseId')
  deleteExercise(
    @Param('courseId', ParseIntPipe) c: number,
    @Param('lessonId', ParseIntPipe) l: number,
    @Param('exerciseId', ParseIntPipe) e: number,
    @Request() r: any,
  ) {
    return this.studio.deleteExercise(c, l, e, r.user);
  }
  @Post(':courseId/studio/lessons/:lessonId/exercises/:exerciseId/questions')
  createQuestion(
    @Param('courseId', ParseIntPipe) c: number,
    @Param('lessonId', ParseIntPipe) l: number,
    @Param('exerciseId', ParseIntPipe) e: number,
    @Body() dto: CreateV5QuestionDto,
    @Request() r: any,
  ) {
    return this.studio.createQuestion(c, l, e, dto, r.user);
  }
  @Patch(
    ':courseId/studio/lessons/:lessonId/exercises/:exerciseId/questions/:questionId',
  )
  updateQuestion(
    @Param('courseId', ParseIntPipe) c: number,
    @Param('lessonId', ParseIntPipe) l: number,
    @Param('exerciseId', ParseIntPipe) e: number,
    @Param('questionId', ParseIntPipe) q: number,
    @Body() dto: UpdateV5QuestionDto,
    @Request() r: any,
  ) {
    return this.studio.updateQuestion(c, l, e, q, dto, r.user);
  }
  @Delete(
    ':courseId/studio/lessons/:lessonId/exercises/:exerciseId/questions/:questionId',
  )
  deleteQuestion(
    @Param('courseId', ParseIntPipe) c: number,
    @Param('lessonId', ParseIntPipe) l: number,
    @Param('exerciseId', ParseIntPipe) e: number,
    @Param('questionId', ParseIntPipe) q: number,
    @Request() r: any,
  ) {
    return this.studio.deleteQuestion(c, l, e, q, r.user);
  }
  @Get(':courseId/studio/validate') validate(
    @Param('courseId', ParseIntPipe) id: number,
    @Request() r: any,
  ) {
    return this.studio.validateCourse(id, r.user);
  }
  @Post(':courseId/studio/publish') publish(
    @Param('courseId', ParseIntPipe) id: number,
    @Request() r: any,
  ) {
    return this.studio.publishCourse(id, r.user);
  }
  @Get(':courseId/studio/lessons/:lessonId/preview') preview(
    @Param('courseId', ParseIntPipe) c: number,
    @Param('lessonId', ParseIntPipe) l: number,
    @Request() r: any,
  ) {
    return this.studio.preview(c, l, r.user);
  }
}
