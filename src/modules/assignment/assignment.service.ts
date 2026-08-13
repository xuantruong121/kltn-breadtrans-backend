import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAssignmentDto, SubmitAssignmentDto, GradeAssignmentDto, AssignmentType } from './dto/assignment.dto';

import { GamificationService } from '../gamification/gamification.service';

@Injectable()
export class AssignmentService {
  constructor(
    private prisma: PrismaService,
    private gamification: GamificationService
  ) {}

  async createAssignment(classId: number, dto: CreateAssignmentDto) {
    const cls = await this.prisma.class.findUnique({ where: { id: classId } });
    if (!cls) throw new NotFoundException('Không tìm thấy lớp học');

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
    // Nếu là STUDENT, kèm theo submission của riêng học sinh đó để biết đã nộp chưa
    return this.prisma.assignment.findMany({
      where: { classId },
      include: {
        submissions: role === 'STUDENT' && userId ? {
          where: { userId }
        } : true, // Giáo viên xem được tất cả submissions
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async getAssignmentDetail(id: number) {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id },
      include: {
        submissions: {
          include: {
            user: { select: { id: true, email: true, profile: { select: { fullName: true, avatar: true } } } }
          }
        },
        class: { select: { id: true, name: true, teacherId: true } }
      }
    });
    if (!assignment) throw new NotFoundException('Không tìm thấy bài tập');
    return assignment;
  }

  async submitAssignment(assignmentId: number, userId: number, dto: SubmitAssignmentDto) {
    const assignment = await this.prisma.assignment.findUnique({ where: { id: assignmentId } });
    if (!assignment) throw new NotFoundException('Không tìm thấy bài tập');

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
      grade = (correctCount / questions.length) * 10;
    }

    const submission = await this.prisma.assignmentSubmission.upsert({
      where: { assignmentId_userId: { assignmentId, userId } },
      update: {
        content: dto.content,
        fileUrl: dto.fileUrl,
        quizAnswers: dto.quizAnswers,
        grade,
        submittedAt: new Date(),
      },
      create: {
        assignmentId,
        userId,
        content: dto.content,
        fileUrl: dto.fileUrl,
        quizAnswers: dto.quizAnswers,
        grade,
      }
    });

    // Cộng điểm Gamification cho QUIZ (nếu có điểm)
    if (grade !== undefined && grade !== null) {
      const points = Math.round(grade * 10); // 10 điểm = 100 xp
      if (points > 0) {
        await this.gamification.addPoints(userId, points, `Hoàn thành bài tập trắc nghiệm: ${assignment.title}`);
      }
    } else {
      // Tự luận: nộp bài thành công +50đ (tạm tính)
      await this.gamification.addPoints(userId, 50, `Nộp bài tập tự luận: ${assignment.title}`);
    }

    return submission;
  }

  async gradeSubmission(submissionId: number, dto: GradeAssignmentDto) {
    const updated = await this.prisma.assignmentSubmission.update({
      where: { id: submissionId },
      data: {
        grade: dto.grade,
        feedback: dto.feedback
      },
      include: { assignment: true }
    });

    // Nếu giáo viên chấm điểm tự luận, thưởng thêm điểm dựa trên grade (0-10) -> 0-100đ
    if (dto.grade !== undefined && dto.grade !== null) {
      const points = Math.round(dto.grade * 10);
      await this.gamification.addPoints(updated.userId, points, `Giáo viên chấm điểm bài tập: ${updated.assignment.title}`);
    }

    return updated;
  }
}
