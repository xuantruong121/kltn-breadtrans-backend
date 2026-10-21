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
import {
  ApplyCourseCurriculumDto,
  ApplyCourseLessonContentDto,
  GenerateCourseCurriculumDto,
  GenerateCourseLessonContentDto,
  RefineCourseLessonSectionDto,
} from './course-ai-authoring.dto';
import { CourseAiAuthoringService } from './course-ai-authoring.service';
import { CourseAiWorkspaceService } from './course-ai-workspace.service';
import { RunCourseAiWorkspaceDto } from './course-ai-workspace.dto';
import { CourseMediaSearchService } from './course-media-search.service';
import {
  AcceptCourseMediaDto,
  AcceptGeneratedMediaDto,
  SearchCourseMediaDto,
} from './course-media.dto';

@ApiTags('admin-course-studio-v5')
@ApiBearerAuth()
@Controller('admin/courses')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class CourseV5AdminController {
  constructor(
    private readonly studio: CourseV5AdminService,
    private readonly aiAuthoring: CourseAiAuthoringService,
    private readonly aiWorkspace: CourseAiWorkspaceService,
    private readonly mediaSearch: CourseMediaSearchService,
  ) {}
  @Post(':courseId/studio/ai-workspace/audit')
  auditAiWorkspace(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Request() r: any,
  ) {
    return this.aiWorkspace.audit(courseId, r.user);
  }
  @Post(':courseId/studio/ai-workspace')
  createAiWorkspace(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Request() r: any,
  ) {
    return this.aiWorkspace.create(courseId, r.user);
  }
  @Get(':courseId/studio/ai-workspace/:workspaceId')
  getAiWorkspace(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Param('workspaceId') workspaceId: string,
    @Request() r: any,
  ) {
    return this.aiWorkspace.get(courseId, workspaceId, r.user);
  }
  @Post(':courseId/studio/ai-workspace/:workspaceId/run')
  runAiWorkspace(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Param('workspaceId') workspaceId: string,
    @Body() dto: RunCourseAiWorkspaceDto,
    @Request() r: any,
  ) {
    return this.aiWorkspace.run(courseId, workspaceId, dto.taskIds, r.user);
  }
  @Post(':courseId/studio/ai-workspace/:workspaceId/tasks/:taskId/retry')
  retryAiWorkspaceTask(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Param('workspaceId') workspaceId: string,
    @Param('taskId') taskId: string,
    @Request() r: any,
  ) {
    return this.aiWorkspace.retry(courseId, workspaceId, taskId, r.user);
  }
  @Post(':courseId/studio/ai-workspace/:workspaceId/tasks/:taskId/apply')
  applyAiWorkspaceTask(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Param('workspaceId') workspaceId: string,
    @Param('taskId') taskId: string,
    @Request() r: any,
  ) {
    return this.aiWorkspace.apply(courseId, workspaceId, taskId, r.user);
  }
  @Post(':courseId/studio/ai/curriculum/generate')
  generateCurriculum(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Body() dto: GenerateCourseCurriculumDto,
    @Request() r: any,
  ) {
    return this.aiAuthoring.generateCurriculum(courseId, dto, r.user);
  }
  @Post(':courseId/studio/ai/curriculum/apply')
  applyCurriculum(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Body() dto: ApplyCourseCurriculumDto,
    @Request() r: any,
  ) {
    return this.aiAuthoring.applyCurriculum(courseId, dto, r.user);
  }
  @Post(':courseId/studio/lessons/:lessonId/ai/content/generate')
  generateLessonContent(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Param('lessonId', ParseIntPipe) lessonId: number,
    @Body() dto: GenerateCourseLessonContentDto,
    @Request() r: any,
  ) {
    return this.aiAuthoring.generateLessonContent(
      courseId,
      lessonId,
      dto,
      r.user,
    );
  }
  @Post(':courseId/studio/lessons/:lessonId/ai/content/apply')
  applyLessonContent(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Param('lessonId', ParseIntPipe) lessonId: number,
    @Body() dto: ApplyCourseLessonContentDto,
    @Request() r: any,
  ) {
    return this.aiAuthoring.applyLessonContent(courseId, lessonId, dto, r.user);
  }
  @Post(':courseId/studio/lessons/:lessonId/ai/sections/:sectionId/refine')
  refineLessonSection(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Param('lessonId', ParseIntPipe) lessonId: number,
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @Body() dto: RefineCourseLessonSectionDto,
    @Request() r: any,
  ) {
    return this.aiAuthoring.refineLessonSection(
      courseId,
      lessonId,
      sectionId,
      dto,
      r.user,
    );
  }
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
  @Get(':courseId/studio/lessons/:lessonId/validate') validateLesson(
    @Param('courseId', ParseIntPipe) c: number,
    @Param('lessonId', ParseIntPipe) l: number,
    @Request() r: any,
  ) {
    return this.studio.validateLesson(c, l, r.user);
  }
  @Post(':courseId/studio/lessons/:lessonId/publish') publishLesson(
    @Param('courseId', ParseIntPipe) c: number,
    @Param('lessonId', ParseIntPipe) l: number,
    @Request() r: any,
  ) {
    return this.studio.publishLesson(c, l, r.user);
  }
  @Post(':courseId/studio/lessons/:lessonId/revert-to-draft')
  revertLessonToDraft(
    @Param('courseId', ParseIntPipe) c: number,
    @Param('lessonId', ParseIntPipe) l: number,
    @Request() r: any,
  ) {
    return this.studio.revertLessonToDraft(c, l, r.user);
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
  @Post(':courseId/studio/media/search') searchCourseCover(
    @Param('courseId', ParseIntPipe) c: number,
    @Body() dto: SearchCourseMediaDto,
    @Request() r: any,
  ) {
    return this.mediaSearch.searchCourseCover(c, dto, r.user);
  }
  @Post(':courseId/studio/media/accept') acceptCourseCover(
    @Param('courseId', ParseIntPipe) c: number,
    @Body() dto: AcceptCourseMediaDto,
    @Request() r: any,
  ) {
    return this.mediaSearch.acceptCourseCover(c, dto, r.user);
  }
  @Post(':courseId/studio/lessons/:lessonId/media/search') searchLessonMedia(
    @Param('courseId', ParseIntPipe) c: number,
    @Param('lessonId', ParseIntPipe) l: number,
    @Body() dto: SearchCourseMediaDto,
    @Request() r: any,
  ) {
    return this.mediaSearch.searchLessonMedia(c, l, dto, r.user);
  }
  @Post(':courseId/studio/lessons/:lessonId/media/accept') acceptLessonMedia(
    @Param('courseId', ParseIntPipe) c: number,
    @Param('lessonId', ParseIntPipe) l: number,
    @Body() dto: AcceptCourseMediaDto,
    @Request() r: any,
  ) {
    return this.mediaSearch.acceptLessonMedia(c, l, dto, r.user);
  }
  @Post(':courseId/studio/media/generate') generateCourseCover(
    @Param('courseId', ParseIntPipe) c: number,
    @Request() r: any,
  ) {
    return this.mediaSearch.generateCourseCoverImage(c, r.user);
  }
  @Post(':courseId/studio/media/generate/accept') acceptGeneratedCourseCover(
    @Param('courseId', ParseIntPipe) c: number,
    @Body() dto: AcceptGeneratedMediaDto,
    @Request() r: any,
  ) {
    return this.mediaSearch.acceptGeneratedCourseCover(c, dto, r.user);
  }
  @Post(':courseId/studio/lessons/:lessonId/media/generate')
  generateLessonMedia(
    @Param('courseId', ParseIntPipe) c: number,
    @Param('lessonId', ParseIntPipe) l: number,
    @Request() r: any,
  ) {
    return this.mediaSearch.generateLessonMediaImage(c, l, r.user);
  }
  @Post(':courseId/studio/lessons/:lessonId/media/generate/accept')
  acceptGeneratedLessonMedia(
    @Param('courseId', ParseIntPipe) c: number,
    @Param('lessonId', ParseIntPipe) l: number,
    @Body() dto: AcceptGeneratedMediaDto,
    @Request() r: any,
  ) {
    return this.mediaSearch.acceptGeneratedLessonMedia(c, l, dto, r.user);
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
