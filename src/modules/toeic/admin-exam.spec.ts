import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AdminExamService } from './admin-exam.service';
import { QuizPublicationStatus } from '@prisma/client';

describe('AdminExamService (Phase 4)', () => {
  let adminExamService: AdminExamService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      toeicExamSet: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      toeicQuestionGroup: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      toeicQuestion: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      toeicAttempt: {
        findFirst: jest.fn(),
      },
      $transaction: jest.fn((cb) => cb(prisma)),
    };

    adminExamService = new AdminExamService(prisma);
  });

  describe('Exam Lifecycle & Draft Safety', () => {
    const buildFullTest = (missingFirstImage = false) => {
      let questionId = 1;
      let questionNumber = 1;
      let groupId = 1;
      const makeQuestions = (count: number, optionCount = 4) =>
        Array.from({ length: count }, () => ({
          id: questionId++,
          questionNumber: questionNumber++,
          options: Array.from({ length: optionCount }, (_, index) =>
            String.fromCharCode(65 + index),
          ),
          correctIndex: 0,
        }));
      const group = (part: number, count: number, order: number) => ({
        id: groupId++,
        part,
        groupOrder: order,
        audioUrl: part <= 4 ? 'https://cdn.example.r2.dev/audio.mp3' : null,
        imageUrl:
          part === 1 && missingFirstImage && groupId === 2
            ? null
            : part === 1
              ? 'https://cdn.example.r2.dev/image.jpg'
              : null,
        passageText: part >= 6 ? 'A valid reading passage.' : null,
        questions: makeQuestions(count, part === 2 ? 3 : 4),
      });
      const groups = [
        ...Array.from({ length: 6 }, (_, index) => group(1, 1, index + 1)),
        group(2, 25, 7),
        ...Array.from({ length: 13 }, (_, index) => group(3, 3, index + 8)),
        ...Array.from({ length: 10 }, (_, index) => group(4, 3, index + 21)),
        group(5, 30, 31),
        group(6, 16, 32),
        ...Array.from({ length: 9 }, (_, index) => group(7, 3, index + 33)),
        group(7, 2, 42),
        ...Array.from({ length: 5 }, (_, index) => group(7, 5, index + 43)),
      ];
      return { id: 301, title: 'Full Test', type: 'FULL_TEST', groups };
    };

    it('creates an exam set with DRAFT status by default', async () => {
      prisma.toeicExamSet.create.mockResolvedValue({
        id: 301,
        title: 'TOEIC Practice Test 01',
        type: 'PRACTICE_BY_PART',
        publicationStatus: QuizPublicationStatus.DRAFT,
      });

      const result = await adminExamService.createExam(
        {
          title: 'TOEIC Practice Test 01',
          type: 'PRACTICE_BY_PART',
          difficulty: 'medium',
          durationSeconds: 3600,
        },
        1,
      );

      expect(prisma.toeicExamSet.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: 'TOEIC Practice Test 01',
          publicationStatus: QuizPublicationStatus.DRAFT,
        }),
      });
      expect(result.publicationStatus).toBe(QuizPublicationStatus.DRAFT);
    });

    it('rejects publishing an exam with 0 questions (preflight check)', async () => {
      prisma.toeicExamSet.findUnique.mockResolvedValue({
        id: 301,
        title: 'Empty Exam',
        type: 'PRACTICE_BY_PART',
        durationSeconds: 3600,
        groups: [],
      });

      await expect(adminExamService.publishExam(301)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects publishing a FULL_TEST exam if it does not have the full 200 questions', async () => {
      // FULL_TEST requires 200 questions
      prisma.toeicExamSet.findUnique.mockResolvedValue({
        id: 301,
        title: 'Incomplete Full Test',
        type: 'FULL_TEST',
        durationSeconds: 7200,
        groups: [
          {
            id: 1,
            part: 5,
            groupOrder: 1,
            questions: [
              {
                id: 101,
                questionNumber: 101,
                options: ['A', 'B', 'C', 'D'],
                correctIndex: 0,
              },
            ],
          },
        ],
      });

      await expect(adminExamService.publishExam(301)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects publishing a structurally complete FULL_TEST when learner readiness fails', async () => {
      prisma.toeicExamSet.findUnique.mockResolvedValue(buildFullTest(true));

      await expect(adminExamService.publishExam(301)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.toeicExamSet.update).not.toHaveBeenCalled();
    });

    it('rejects publishing if a group is missing required media (e.g. Part 1 missing image)', async () => {
      prisma.toeicExamSet.findUnique.mockResolvedValue({
        id: 301,
        title: 'Missing Image Test',
        type: 'PRACTICE_BY_PART',
        durationSeconds: 3600,
        groups: [
          {
            id: 1,
            part: 1,
            groupOrder: 1,
            audioUrl: 'https://cdn.example.com/audio.mp3',
            imageUrl: null, // Missing required image for Part 1!
            questions: [
              {
                id: 1,
                questionNumber: 1,
                options: ['A', 'B', 'C', 'D'],
                correctIndex: 0,
              },
            ],
          },
        ],
      });

      await expect(adminExamService.publishExam(301)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('publishes a valid exam when all media and questions meet invariants', async () => {
      prisma.toeicExamSet.findUnique.mockResolvedValue({
        id: 301,
        title: 'Valid Part 5 Test',
        type: 'PRACTICE_BY_PART',
        durationSeconds: 1800,
        groups: [
          {
            id: 1,
            part: 5,
            groupOrder: 1,
            questions: [
              {
                id: 101,
                questionNumber: 101,
                options: ['apply', 'application', 'applicable', 'applying'],
                correctIndex: 1,
              },
            ],
          },
        ],
      });
      prisma.toeicExamSet.update.mockResolvedValue({
        id: 301,
        publicationStatus: QuizPublicationStatus.PUBLISHED,
      });

      const result = await adminExamService.publishExam(301);
      expect(result.publicationStatus).toBe(QuizPublicationStatus.PUBLISHED);
    });

    it('unpublishes an exam back to DRAFT', async () => {
      prisma.toeicExamSet.findUnique.mockResolvedValue({ id: 301 });
      prisma.toeicExamSet.update.mockResolvedValue({
        id: 301,
        publicationStatus: QuizPublicationStatus.DRAFT,
      });

      const result = await adminExamService.unpublishExam(301);
      expect(result.publicationStatus).toBe(QuizPublicationStatus.DRAFT);
    });
  });

  describe('History Safety Guards (Exam Attempt Protection)', () => {
    it('blocks exam deletion if learner attempts exist (409 Conflict)', async () => {
      prisma.toeicExamSet.findUnique.mockResolvedValue({ id: 301 });
      prisma.toeicAttempt.findFirst.mockResolvedValue({
        id: 888,
        examId: 301,
        userId: 1,
      });

      await expect(adminExamService.deleteExam(301)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.toeicExamSet.delete).not.toHaveBeenCalled();
    });

    it('allows exam deletion if no learner attempts exist', async () => {
      prisma.toeicExamSet.findUnique.mockResolvedValue({ id: 301 });
      prisma.toeicAttempt.findFirst.mockResolvedValue(null);
      prisma.toeicQuestion.deleteMany = jest.fn();
      prisma.toeicQuestionGroup.deleteMany = jest.fn();
      prisma.toeicExamSet.delete.mockResolvedValue({ id: 301 });

      const result = await adminExamService.deleteExam(301);
      expect(result).toEqual({ id: 301 });
    });

    it('blocks group deletion if exam has attempts', async () => {
      prisma.toeicQuestionGroup.findUnique.mockResolvedValue({
        id: 1,
        examId: 301,
      });
      prisma.toeicAttempt.findFirst.mockResolvedValue({ id: 888, examId: 301 });

      await expect(adminExamService.deleteGroup(301, 1)).rejects.toThrow(
        ConflictException,
      );
    });

    it('blocks question deletion if exam has attempts', async () => {
      prisma.toeicQuestionGroup.findUnique.mockResolvedValue({
        id: 1,
        examId: 301,
      });
      prisma.toeicQuestion.findUnique.mockResolvedValue({
        id: 50,
        groupId: 1,
        group: { examId: 301 },
      });
      prisma.toeicAttempt.findFirst.mockResolvedValue({ id: 888, examId: 301 });

      await expect(adminExamService.deleteQuestion(301, 1, 50)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('Nested Exam Ownership Security', () => {
    it('rejects group update if group does not belong to specified exam', async () => {
      prisma.toeicQuestionGroup.findUnique.mockResolvedValue({
        id: 1,
        examId: 999, // belongs to 999, not 301
      });

      await expect(
        adminExamService.updateGroup(301, 1, { passageText: 'new passage' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects question update if question does not belong to specified group', async () => {
      prisma.toeicQuestionGroup.findUnique.mockResolvedValue({
        id: 1,
        examId: 301,
      });
      prisma.toeicQuestion.findUnique.mockResolvedValue({
        id: 50,
        groupId: 999, // belongs to group 999, not group 1
      });

      await expect(
        adminExamService.updateQuestion(301, 1, 50, { text: 'new prompt' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects group reorder if forged cross-exam group IDs are submitted', async () => {
      prisma.toeicExamSet.findUnique.mockResolvedValue({
        id: 301,
        groups: [{ id: 1 }, { id: 2 }],
      });

      await expect(
        adminExamService.reorderGroups(301, [1, 2, 999]),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
