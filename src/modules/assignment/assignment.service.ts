import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateAssignmentDto,
  SubmitAssignmentDto,
  GradeAssignmentDto,
  AssignmentType,
} from './dto/assignment.dto';

import { GamificationService } from '../gamification/gamification.service';

@Injectable()
export class AssignmentService {
  constructor(
    private prisma: PrismaService,
    private gamification: GamificationService,
  ) {}

  async createAssignment(
    classId: number,
    dto: CreateAssignmentDto,
    userId?: number,
    role?: string,
  ) {
    const cls = await this.prisma.class.findUnique({ where: { id: classId } });
    if (!cls) throw new NotFoundException('Không tìm thấy lớp học');

    if (role !== 'ADMIN' && cls.teacherId !== userId) {
      throw new ForbiddenException(
        'Bạn không phải là giảng viên phụ trách lớp học này',
      );
    }

    return this.prisma.assignment.create({
      data: {
        classId,
        title: dto.title,
        description: dto.description,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        type: dto.type,
        quizData: dto.type === AssignmentType.QUIZ ? dto.quizData : null,
      },
    });
  }

  async getAssignmentsByClass(classId: number, userId?: number, role?: string) {
    const cls = await this.prisma.class.findUnique({ where: { id: classId } });
    if (!cls) throw new NotFoundException('Không tìm thấy lớp học');

    if (role === 'STUDENT' && userId) {
      const enrollment = await this.prisma.enrollment.findFirst({
        where: {
          classId,
          userId,
          status: { in: ['ACTIVE', 'COMPLETED'] },
        },
      });
      if (!enrollment) {
        throw new ForbiddenException(
          'Bạn chưa ghi danh hoặc không có quyền truy cập bài tập của lớp học này',
        );
      }
    } else if (role === 'TEACHER' && userId) {
      if (cls.teacherId !== userId) {
        throw new ForbiddenException(
          'Bạn không phải là giảng viên phụ trách lớp học này',
        );
      }
    }

    // Nếu là STUDENT, kèm theo submission của riêng học sinh đó để biết đã nộp chưa
    return this.prisma.assignment.findMany({
      where: { classId },
      include: {
        submissions:
          role === 'STUDENT' && userId
            ? {
                where: { userId },
              }
            : true, // Giáo viên xem được tất cả submissions
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAssignmentDetail(id: number) {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id },
      include: {
        submissions: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                profile: { select: { fullName: true, avatar: true } },
              },
            },
          },
        },
        class: { select: { id: true, name: true, teacherId: true } },
      },
    });
    if (!assignment) throw new NotFoundException('Không tìm thấy bài tập');
    return assignment;
  }

  async submitAssignment(
    assignmentId: number,
    userId: number,
    dto: SubmitAssignmentDto,
  ) {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: { class: true },
    });
    if (!assignment) throw new NotFoundException('Không tìm thấy bài tập');

    // Chỉ học sinh có enrollment ACTIVE trong lớp mới có thể nộp bài tập
    const enrollment = await this.prisma.enrollment.findFirst({
      where: {
        classId: assignment.classId,
        userId,
        status: 'ACTIVE',
      },
    });
    if (!enrollment) {
      throw new ForbiddenException(
        'Chỉ học sinh đang hoạt động (ACTIVE) trong lớp mới có thể nộp bài tập',
      );
    }

    const existingSubmission =
      await this.prisma.assignmentSubmission.findUnique({
        where: { assignmentId_userId: { assignmentId, userId } },
      });

    if (existingSubmission) {
      // Rule 1: QUIZ chỉ được làm và nộp 1 lần duy nhất để bảo đảm tính trung thực
      if (assignment.type === 'QUIZ') {
        throw new ForbiddenException(
          'Bài tập trắc nghiệm chỉ được nộp 1 lần duy nhất và bài làm đã được ghi nhận.',
        );
      }
      // Rule 2: ESSAY nếu đã được giáo viên chấm điểm thì bị khóa bài nộp
      if (
        assignment.type === 'ESSAY' &&
        existingSubmission.grade !== null &&
        existingSubmission.grade !== undefined
      ) {
        throw new ForbiddenException(
          'Bài tập tự luận đã được giáo viên chấm điểm và nhận xét, không thể nộp đè bài mới.',
        );
      }
    }

    const now = new Date();
    const isLate = assignment.dueDate
      ? now.getTime() > new Date(assignment.dueDate).getTime()
      : false;

    // Chấm điểm tự động nếu là dạng QUIZ
    let grade = undefined;
    if (assignment.type === 'QUIZ' && dto.quizAnswers && assignment.quizData) {
      const questions = assignment.quizData as any[];
      const answers = dto.quizAnswers as number[]; // [0, 1, 2, ...] array of selected indices
      let correctCount = 0;
      for (let i = 0; i < questions.length; i++) {
        if (answers[i] === questions[i].correctOptionIndex) {
          correctCount++;
        }
      }
      grade = Number(((correctCount / questions.length) * 10).toFixed(1));
    }

    const submission = await this.prisma.assignmentSubmission.upsert({
      where: { assignmentId_userId: { assignmentId, userId } },
      update: {
        content: dto.content,
        fileUrl: dto.fileUrl,
        quizAnswers: dto.quizAnswers,
        grade,
        submittedAt: now,
      },
      create: {
        assignmentId,
        userId,
        content: dto.content,
        fileUrl: dto.fileUrl,
        quizAnswers: dto.quizAnswers,
        grade,
        submittedAt: now,
      },
    });

    // Cập nhật tiến độ học tập (Enrollment.progress) của học sinh cho lớp học
    await this.updateStudentEnrollmentProgress(assignment.classId, userId);

    // Đối với QUIZ: Hệ thống tự chấm điểm và thưởng Bánh Mì/EXP ngay (Đảm bảo Idempotency qua CAS isPointsAwarded)
    if (assignment.type === 'QUIZ' && grade !== undefined && grade !== null) {
      const historyKey = `Hoàn thành bài tập trắc nghiệm: ${assignment.title}`;

      // CAS atomic compare-and-swap trên isPointsAwarded để phòng chống TOCTOU race condition
      const awardUpdate = await this.prisma.assignmentSubmission.updateMany({
        where: { id: submission.id, isPointsAwarded: false },
        data: { isPointsAwarded: true },
      });

      if (awardUpdate.count === 1) {
        const rawPoints = Math.round(grade * 10); // 10 điểm = 100 xp
        const points = isLate ? Math.round(rawPoints * 0.5) : rawPoints;
        if (points > 0) {
          await this.gamification.addPoints(
            userId,
            points,
            `${historyKey}${isLate ? ' (Nộp trễ - Giảm 50% thưởng)' : ''}`,
          );
        }
      }
    }
    // Đối với ESSAY: Điểm thưởng sẽ được hệ thống tính và phát sau khi giáo viên chấm bài xong (Hướng A)

    return {
      ...submission,
      isLate,
      isAutoGraded: assignment.type === 'QUIZ',
    };
  }

  private async updateStudentEnrollmentProgress(
    classId: number,
    userId: number,
  ) {
    try {
      const [totalSessions, totalAssignments] = await Promise.all([
        this.prisma.session.count({ where: { classId } }),
        this.prisma.assignment.count({ where: { classId } }),
      ]);

      if (totalSessions === 0 && totalAssignments === 0) return;

      const [attendedSessions, submittedAssignments] = await Promise.all([
        this.prisma.attendance.count({
          where: {
            session: { classId },
            userId,
            isPresent: true,
          },
        }),
        this.prisma.assignmentSubmission.count({
          where: {
            assignment: { classId },
            userId,
          },
        }),
      ]);

      let progress = 0;
      if (totalSessions > 0 && totalAssignments > 0) {
        const sessionRatio = attendedSessions / totalSessions;
        const assignmentRatio = submittedAssignments / totalAssignments;
        progress = (0.5 * sessionRatio + 0.5 * assignmentRatio) * 100;
      } else if (totalSessions > 0) {
        progress = (attendedSessions / totalSessions) * 100;
      } else if (totalAssignments > 0) {
        progress = (submittedAssignments / totalAssignments) * 100;
      }

      await this.prisma.enrollment.updateMany({
        where: { classId, userId },
        data: { progress: Math.min(100, Math.round(progress)) },
      });
    } catch (error) {
      console.error(
        `Error recalculating progress for user ${userId} in class ${classId}:`,
        error,
      );
    }
  }

  async gradeSubmission(
    submissionId: number,
    dto: GradeAssignmentDto,
    userId?: number,
    role?: string,
  ) {
    const existing = await this.prisma.assignmentSubmission.findUnique({
      where: { id: submissionId },
      include: { assignment: { include: { class: true } } },
    });

    if (!existing) {
      throw new NotFoundException('Không tìm thấy bài nộp');
    }

    if (role !== 'ADMIN' && existing.assignment.class.teacherId !== userId) {
      throw new ForbiddenException(
        'Bạn không phải là giảng viên phụ trách lớp học này',
      );
    }

    // Atomic compare-and-swap trên isPointsAwarded để phòng chống cộng thưởng 2 lần
    let shouldAwardPoints = false;
    if (
      dto.grade !== undefined &&
      dto.grade !== null &&
      !existing.isPointsAwarded
    ) {
      const awardCheck = await this.prisma.assignmentSubmission.updateMany({
        where: { id: submissionId, isPointsAwarded: false },
        data: { isPointsAwarded: true },
      });
      if (awardCheck.count === 1) {
        shouldAwardPoints = true;
      }
    }

    const updated = await this.prisma.assignmentSubmission.update({
      where: { id: submissionId },
      data: {
        grade: dto.grade,
        feedback: dto.feedback,
      },
      include: { assignment: true },
    });

    // Khi giáo viên chấm bài tự luận (ESSAY), tính thưởng Bánh Mì/EXP theo chất lượng bài làm
    if (shouldAwardPoints && dto.grade !== undefined && dto.grade !== null) {
      const isLate = updated.assignment.dueDate
        ? new Date(updated.submittedAt) > new Date(updated.assignment.dueDate)
        : false;

      const rawPoints = Math.round(dto.grade * 10); // Điểm 10 -> tối đa 100 XP / Bánh Mì
      const points = isLate ? Math.round(rawPoints * 0.5) : rawPoints;

      if (points > 0) {
        await this.gamification.addPoints(
          updated.userId,
          points,
          `Giáo viên chấm điểm bài tập: ${updated.assignment.title}${isLate ? ' (Nộp trễ - Giảm 50% thưởng)' : ''}`,
        );
      }
    }

    return updated;
  }
}
