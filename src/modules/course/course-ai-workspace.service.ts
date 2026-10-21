import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { CourseStatus, Role } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { CourseAiAuthoringService } from './course-ai-authoring.service';
import { CourseMediaSearchService } from './course-media-search.service';

type Admin = { id: number; role: Role };
type Severity = 'REQUIRED' | 'RECOMMENDED' | 'OPTIONAL';
type TaskStatus =
  'PLANNED' | 'RUNNING' | 'CANDIDATE_READY' | 'FAILED' | 'APPLIED';
type TaskType =
  | 'CURRICULUM_SUGGESTION'
  | 'LESSON_CONTENT_CREATE'
  | 'LESSON_CONTENT_IMPROVE'
  | 'GUIDED_PRACTICE_CREATE'
  | 'FINAL_CHECK_CREATE'
  | 'COURSE_COVER_SEARCH'
  | 'COURSE_COVER_GENERATE'
  | 'LESSON_IMAGE_SEARCH'
  | 'LESSON_IMAGE_GENERATE';

type WorkspaceTask = {
  id: string;
  type: TaskType;
  severity: Severity;
  label: string;
  target: { courseId: number; lessonId?: number; lessonTitle?: string };
  selectedByDefault: boolean;
  status: TaskStatus;
  sourceSignature: string;
  candidate?: any;
  error?: string;
};

type Workspace = {
  id: string;
  courseId: number;
  adminId: number;
  createdAt: string;
  updatedAt: string;
  audit: any;
  tasks: WorkspaceTask[];
};

const WORKSPACE_TTL_SECONDS = 45 * 60;
const MAX_CONCURRENCY = 2;

@Injectable()
export class CourseAiWorkspaceService {
  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly authoring: CourseAiAuthoringService,
    private readonly media: CourseMediaSearchService,
  ) {}

  private admin(user: Admin) {
    if (user.role !== Role.ADMIN) throw new ForbiddenException('Admin only');
  }

  private key(id: string) {
    return `course-ai:workspace:${id}`;
  }

  private signature(value: unknown) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  private async course(courseId: number) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
    });
    if (!course) throw new NotFoundException('Course not found');
    return course;
  }

  private assertDraftCourse(course: { status: CourseStatus }) {
    if (course.status !== CourseStatus.DRAFT)
      throw new ConflictException(
        'AI chỉ hỗ trợ hoàn thiện Course ở trạng thái bản nháp',
      );
  }

  private async courseGraph(courseId: number) {
    return this.prisma.course.findUnique({
      where: { id: courseId },
      include: {
        courseLessons: {
          orderBy: { order: 'asc' },
          include: {
            sections: { orderBy: { order: 'asc' } },
            media: true,
            exercises: {
              orderBy: { order: 'asc' },
              include: { questions: true },
            },
          },
        },
      },
    });
  }

  private meaningfulSection(section: { content: unknown }) {
    const content = section.content as Record<string, unknown> | null;
    if (!content || typeof content !== 'object') return false;
    return ['text', 'paragraphs', 'bullets', 'examples', 'audioExamples'].some(
      (key) => {
        const value = content[key];
        return typeof value === 'string'
          ? Boolean(value.trim())
          : Array.isArray(value) && value.length > 0;
      },
    );
  }

  private async buildAudit(courseId: number) {
    const course = await this.course(courseId);
    const graph = await this.courseGraph(courseId);
    if (!graph) throw new NotFoundException('Course not found');
    const tasks: WorkspaceTask[] = [];
    const add = (
      type: TaskType,
      severity: Severity,
      label: string,
      target: WorkspaceTask['target'],
      source: unknown,
    ) =>
      tasks.push({
        id: randomUUID(),
        type,
        severity,
        label,
        target,
        selectedByDefault: severity !== 'OPTIONAL',
        status: 'PLANNED',
        sourceSignature: this.signature(source),
      });

    if (!graph.courseLessons.length) {
      add(
        'CURRICULUM_SUGGESTION',
        'REQUIRED',
        'Gợi ý chương trình học',
        { courseId },
        graph,
      );
    }
    if (!course.thumbnail) {
      add(
        'COURSE_COVER_SEARCH',
        'OPTIONAL',
        'Tìm ảnh bìa khóa học',
        { courseId },
        { thumbnail: null },
      );
      add(
        'COURSE_COVER_GENERATE',
        'OPTIONAL',
        'Sinh ảnh bìa khóa học',
        { courseId },
        { thumbnail: null },
      );
    }

    const lessons = graph.courseLessons.map((lesson) => {
      const requiredSections = lesson.sections.filter(
        (section) => section.isRequired,
      );
      const hasContent = requiredSections.some((section) =>
        this.meaningfulSection(section),
      );
      const hasGuidedPractice = lesson.exercises.some(
        (exercise) =>
          exercise.slug === 'guided-practice' && exercise.questions.length > 0,
      );
      const hasFinalCheck = lesson.exercises.some(
        (exercise) =>
          exercise.slug === 'final-check' && exercise.questions.length > 0,
      );
      const source = {
        id: lesson.id,
        title: lesson.title,
        summary: lesson.summary,
        objectives: lesson.learningObjectives,
        sections: lesson.sections,
        exercises: lesson.exercises.map((exercise) => ({
          id: exercise.id,
          slug: exercise.slug,
          updatedAt: exercise.updatedAt,
        })),
      };
      const target = {
        courseId,
        lessonId: lesson.id,
        lessonTitle: lesson.title,
      };
      if (!hasContent)
        add(
          'LESSON_CONTENT_CREATE',
          'REQUIRED',
          'Tạo nội dung bài học',
          target,
          source,
        );
      else if (lesson.sections.length <= 1)
        add(
          'LESSON_CONTENT_IMPROVE',
          'OPTIONAL',
          'Cải thiện nội dung',
          target,
          source,
        );
      if (!hasGuidedPractice)
        add(
          'GUIDED_PRACTICE_CREATE',
          'RECOMMENDED',
          'Tạo bài luyện tập',
          target,
          source,
        );
      if (lesson.requiresFinalCheck && !hasFinalCheck)
        add(
          'FINAL_CHECK_CREATE',
          'REQUIRED',
          'Tạo kiểm tra cuối bài',
          target,
          source,
        );
      if (!lesson.media.some((media) => media.type === 'image')) {
        add(
          'LESSON_IMAGE_SEARCH',
          'OPTIONAL',
          'Tìm ảnh minh họa',
          target,
          source,
        );
        add(
          'LESSON_IMAGE_GENERATE',
          'OPTIONAL',
          'Sinh ảnh minh họa',
          target,
          source,
        );
      }
      return {
        id: lesson.id,
        title: lesson.title,
        status: lesson.status,
        contentReady: hasContent,
        guidedPracticeReady: hasGuidedPractice,
        finalCheckReady: !lesson.requiresFinalCheck || hasFinalCheck,
        hasImage: lesson.media.some((media) => media.type === 'image'),
      };
    });
    const required = tasks.filter(
      (task) => task.severity === 'REQUIRED',
    ).length;
    const recommended = tasks.filter(
      (task) => task.severity === 'RECOMMENDED',
    ).length;
    const optional = tasks.filter(
      (task) => task.severity === 'OPTIONAL',
    ).length;
    return {
      courseId,
      courseStatus: course.status,
      metadata: {
        title: Boolean(course.title.trim()),
        description: Boolean(course.description?.trim()),
        level: Boolean(course.level),
        cover: Boolean(course.thumbnail),
      },
      curriculum: { lessonCount: lessons.length, ordered: true },
      lessons,
      summary: {
        ready: tasks.length === 0,
        needsAttention: required + recommended,
        optional,
      },
      suggestedTasks: tasks,
    };
  }

  async audit(courseId: number, user: Admin) {
    this.admin(user);
    return this.buildAudit(courseId);
  }

  async create(courseId: number, user: Admin) {
    this.admin(user);
    const audit = await this.buildAudit(courseId);
    const now = new Date().toISOString();
    const workspace: Workspace = {
      id: randomUUID(),
      courseId,
      adminId: user.id,
      createdAt: now,
      updatedAt: now,
      audit,
      tasks: audit.suggestedTasks,
    };
    await this.save(workspace);
    return workspace;
  }

  private async read(courseId: number, workspaceId: string, user: Admin) {
    this.admin(user);
    const raw = await this.redis.get(this.key(workspaceId));
    if (!raw)
      throw new GoneException(
        'Phiên hỗ trợ AI đã hết hạn. Hãy phân tích lại khóa học.',
      );
    let workspace: Workspace;
    try {
      workspace = JSON.parse(raw) as Workspace;
    } catch {
      throw new GoneException('Phiên hỗ trợ AI không hợp lệ.');
    }
    if (workspace.courseId !== courseId || workspace.adminId !== user.id)
      throw new ForbiddenException(
        'Phiên hỗ trợ AI không thuộc khóa học hoặc quản trị viên hiện tại.',
      );
    return workspace;
  }

  private async save(workspace: Workspace) {
    workspace.updatedAt = new Date().toISOString();
    await this.redis.set(
      this.key(workspace.id),
      JSON.stringify(workspace),
      'EX',
      WORKSPACE_TTL_SECONDS,
    );
  }

  async get(courseId: number, workspaceId: string, user: Admin) {
    return this.read(courseId, workspaceId, user);
  }

  private async currentSignature(task: WorkspaceTask) {
    if (!task.target.lessonId) {
      if (task.type.startsWith('COURSE_COVER')) {
        const course = await this.prisma.course.findUnique({
          where: { id: task.target.courseId },
          select: { thumbnail: true },
        });
        if (!course) throw new NotFoundException('Course not found');
        return this.signature({ thumbnail: course.thumbnail });
      }
      return this.signature(await this.courseGraph(task.target.courseId));
    }
    const lesson = await this.prisma.courseLesson.findFirst({
      where: { id: task.target.lessonId, courseId: task.target.courseId },
      include: {
        sections: { orderBy: { order: 'asc' } },
        media: true,
        exercises: { orderBy: { order: 'asc' }, include: { questions: true } },
      },
    });
    if (!lesson)
      throw new NotFoundException('Bài học mục tiêu không còn tồn tại.');
    return this.signature({
      id: lesson.id,
      title: lesson.title,
      summary: lesson.summary,
      objectives: lesson.learningObjectives,
      sections: lesson.sections,
      exercises: lesson.exercises.map((exercise) => ({
        id: exercise.id,
        slug: exercise.slug,
        updatedAt: exercise.updatedAt,
      })),
    });
  }

  private async runTask(task: WorkspaceTask, user: Admin) {
    const courseId = task.target.courseId;
    const lessonId = task.target.lessonId;
    switch (task.type) {
      case 'CURRICULUM_SUGGESTION':
        return this.authoring.generateCurriculum(courseId, {}, user);
      case 'LESSON_CONTENT_CREATE':
        return this.authoring.generateLessonContent(
          courseId,
          lessonId!,
          { scope: 'SECTIONS' },
          user,
        );
      case 'LESSON_CONTENT_IMPROVE':
        return this.authoring.generateLessonContent(
          courseId,
          lessonId!,
          { scope: 'IMPROVE_SECTIONS' },
          user,
        );
      case 'GUIDED_PRACTICE_CREATE':
        return this.authoring.generateLessonContent(
          courseId,
          lessonId!,
          { scope: 'GUIDED_PRACTICE' },
          user,
        );
      case 'FINAL_CHECK_CREATE':
        return this.authoring.generateLessonContent(
          courseId,
          lessonId!,
          { scope: 'FINAL_CHECK' },
          user,
        );
      case 'COURSE_COVER_SEARCH':
        return this.media.searchCourseCover(courseId, {}, user);
      case 'COURSE_COVER_GENERATE':
        return this.media.generateCourseCoverImage(courseId, user);
      case 'LESSON_IMAGE_SEARCH':
        return this.media.searchLessonMedia(courseId, lessonId!, {}, user);
      case 'LESSON_IMAGE_GENERATE':
        return this.media.generateLessonMediaImage(courseId, lessonId!, user);
    }
  }

  async run(
    courseId: number,
    workspaceId: string,
    taskIds: string[],
    user: Admin,
  ) {
    const workspace = await this.read(courseId, workspaceId, user);
    this.assertDraftCourse(await this.course(courseId));
    const tasks = workspace.tasks.filter(
      (task) => taskIds.includes(task.id) && task.status !== 'APPLIED',
    );
    if (tasks.length !== new Set(taskIds).size || !tasks.length)
      throw new BadRequestException('Danh sách tác vụ không hợp lệ.');
    for (const task of tasks) {
      task.status = 'RUNNING';
      task.error = undefined;
    }
    await this.save(workspace);
    for (let index = 0; index < tasks.length; index += MAX_CONCURRENCY) {
      await Promise.all(
        tasks.slice(index, index + MAX_CONCURRENCY).map(async (task) => {
          try {
            task.candidate = await this.runTask(task, user);
            task.status = 'CANDIDATE_READY';
          } catch (error: any) {
            task.status = 'FAILED';
            task.error = error?.message || 'Không thể hoàn tất tác vụ AI.';
          }
          await this.save(workspace);
        }),
      );
    }
    return workspace;
  }

  async retry(
    courseId: number,
    workspaceId: string,
    taskId: string,
    user: Admin,
  ) {
    const workspace = await this.read(courseId, workspaceId, user);
    const task = workspace.tasks.find((item) => item.id === taskId);
    if (!task || task.status !== 'FAILED')
      throw new BadRequestException('Chỉ có thể thử lại tác vụ thất bại.');
    return this.run(courseId, workspaceId, [taskId], user);
  }

  async apply(
    courseId: number,
    workspaceId: string,
    taskId: string,
    user: Admin,
  ) {
    const workspace = await this.read(courseId, workspaceId, user);
    this.assertDraftCourse(await this.course(courseId));
    const task = workspace.tasks.find((item) => item.id === taskId);
    if (!task) throw new NotFoundException('Không tìm thấy tác vụ.');
    if (task.status === 'APPLIED')
      return { mode: 'ALREADY_APPLIED', workspace };
    if (task.status !== 'CANDIDATE_READY' || !task.candidate)
      throw new ConflictException('Tác vụ chưa có kết quả để áp dụng.');
    if ((await this.currentSignature(task)) !== task.sourceSignature)
      throw new ConflictException(
        'Nội dung đích đã thay đổi sau khi AI tạo gợi ý. Hãy chạy lại tác vụ để xem xét bản mới.',
      );
    const candidate = task.candidate.candidate;
    switch (task.type) {
      case 'CURRICULUM_SUGGESTION':
        await this.authoring.applyCurriculum(
          courseId,
          { candidateCourseId: courseId, lessons: candidate.lessons },
          user,
        );
        break;
      case 'LESSON_CONTENT_CREATE':
      case 'LESSON_CONTENT_IMPROVE':
      case 'GUIDED_PRACTICE_CREATE':
      case 'FINAL_CHECK_CREATE':
        await this.authoring.applyLessonContent(
          courseId,
          task.target.lessonId!,
          candidate,
          user,
        );
        break;
      case 'COURSE_COVER_SEARCH':
        if (!task.candidate.candidate)
          throw new ConflictException('Không có ảnh phù hợp để dùng.');
        await this.media.acceptCourseCover(
          courseId,
          { brief: task.candidate.brief, candidate: task.candidate.candidate },
          user,
        );
        break;
      case 'COURSE_COVER_GENERATE':
        if (!task.candidate.candidate?.token)
          throw new ConflictException('Ảnh AI không còn khả dụng.');
        await this.media.acceptGeneratedCourseCover(
          courseId,
          {
            token: task.candidate.candidate.token,
            brief: task.candidate.brief || 'Ảnh bìa khóa học',
          },
          user,
        );
        break;
      case 'LESSON_IMAGE_SEARCH':
        if (!task.candidate.candidate)
          throw new ConflictException('Không có ảnh phù hợp để dùng.');
        await this.media.acceptLessonMedia(
          courseId,
          task.target.lessonId!,
          { brief: task.candidate.brief, candidate: task.candidate.candidate },
          user,
        );
        break;
      case 'LESSON_IMAGE_GENERATE':
        if (!task.candidate.candidate?.token)
          throw new ConflictException('Ảnh AI không còn khả dụng.');
        await this.media.acceptGeneratedLessonMedia(
          courseId,
          task.target.lessonId!,
          {
            token: task.candidate.candidate.token,
            brief: task.candidate.brief || 'Ảnh minh họa bài học',
          },
          user,
        );
        break;
    }
    task.status = 'APPLIED';
    await this.save(workspace);
    return { mode: 'APPLIED_TO_DRAFT', workspace };
  }
}
