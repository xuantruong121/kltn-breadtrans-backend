import { Test, TestingModule } from '@nestjs/testing';
import { AssignmentService } from './assignment.service';
import { PrismaService } from '../../prisma/prisma.service';
import { GamificationService } from '../gamification/gamification.service';
import { ForbiddenException } from '@nestjs/common';
import { AssignmentType } from './dto/assignment.dto';

describe('AssignmentService - Cross-Ownership Security Tests', () => {
  let service: AssignmentService;

  const mockPrisma = {
    class: {
      findUnique: jest.fn(),
    },
    assignment: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    assignmentSubmission: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    enrollment: {
      findFirst: jest.fn(),
    },
  };

  const mockGamification = {
    addPoints: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssignmentService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: GamificationService, useValue: mockGamification },
      ],
    }).compile();

    service = module.get<AssignmentService>(AssignmentService);
    jest.clearAllMocks();
  });

  describe('Assignment Cross-Ownership Security (X07, X08)', () => {
    // X07. [ASSIGNMENT CROSS-CREATE] Teacher A gọi createAssignment trên Class của Teacher B -> 403 Forbidden
    it('X07. Teacher A tạo bài tập cho Class của Teacher B -> 403 Forbidden', async () => {
      mockPrisma.class.findUnique.mockResolvedValue({
        id: 18,
        teacherId: 42, // Teacher B
        name: 'Class of Teacher B',
      });

      await expect(
        service.createAssignment(
          18,
          {
            title: 'Hacked Assignment',
            description: 'Unauthorized description',
            type: AssignmentType.ESSAY,
          },
          41, // Teacher A
          'TEACHER',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    // X08. [GRADE CROSS-TEACHER] Teacher A gọi gradeSubmission trên submission thuộc Class của Teacher B -> 403 Forbidden
    it('X08. Teacher A chấm điểm bài nộp của Class thuộc Teacher B -> 403 Forbidden', async () => {
      mockPrisma.assignmentSubmission.findUnique.mockResolvedValue({
        id: 15,
        userId: 48,
        assignment: {
          id: 8,
          class: {
            id: 18,
            teacherId: 42, // Teacher B
          },
        },
      });

      await expect(
        service.gradeSubmission(
          15,
          {
            grade: 10,
            feedback: 'Graded by unauthorized Teacher A',
          },
          41, // Teacher A
          'TEACHER',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    // PEND-SEC-03a: Student with PENDING_PAYMENT / non-active enrollment -> 403 Forbidden on getAssignmentDetail
    it('PEND-SEC-03a. Student with PENDING_PAYMENT -> 403 Forbidden on getAssignmentDetail', async () => {
      mockPrisma.assignment.findUnique.mockResolvedValue({
        id: 101,
        classId: 202,
        class: { id: 202, name: 'Math 101', teacherId: 50 },
        submissions: [],
      });
      // No ACTIVE/COMPLETED enrollment found
      mockPrisma.enrollment.findFirst.mockResolvedValue(null);

      await expect(
        service.getAssignmentDetail(101, 999, 'STUDENT'),
      ).rejects.toThrow(ForbiddenException);
    });

    // PEND-SEC-03b: Student with ACTIVE enrollment -> returns only own submissions
    it('PEND-SEC-03b. Student with ACTIVE enrollment -> sees only own submissions', async () => {
      mockPrisma.assignment.findUnique.mockResolvedValue({
        id: 101,
        classId: 202,
        class: { id: 202, name: 'Math 101', teacherId: 50 },
        submissions: [
          { id: 1, userId: 999, content: 'Own submission' },
          { id: 2, userId: 888, content: 'Peer submission' },
        ],
      });
      mockPrisma.enrollment.findFirst.mockResolvedValue({
        id: 1,
        classId: 202,
        userId: 999,
        status: 'ACTIVE',
      });

      const res = await service.getAssignmentDetail(101, 999, 'STUDENT');
      expect(res.submissions).toHaveLength(1);
      expect(res.submissions[0].userId).toBe(999);
    });

    // PEND-SEC-03c: Owner teacher -> sees all student submissions
    it('PEND-SEC-03c. Owner teacher -> sees all student submissions', async () => {
      mockPrisma.assignment.findUnique.mockResolvedValue({
        id: 101,
        classId: 202,
        class: { id: 202, name: 'Math 101', teacherId: 50 },
        submissions: [
          { id: 1, userId: 999, content: 'Student 1 submission' },
          { id: 2, userId: 888, content: 'Student 2 submission' },
        ],
      });

      const res = await service.getAssignmentDetail(101, 50, 'TEACHER');
      expect(res.submissions).toHaveLength(2);
    });

    // PEND-SEC-03d: Non-owner teacher -> 403 Forbidden
    it('PEND-SEC-03d. Non-owner teacher -> 403 Forbidden', async () => {
      mockPrisma.assignment.findUnique.mockResolvedValue({
        id: 101,
        classId: 202,
        class: { id: 202, name: 'Math 101', teacherId: 50 },
        submissions: [],
      });

      await expect(
        service.getAssignmentDetail(101, 51, 'TEACHER'),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
