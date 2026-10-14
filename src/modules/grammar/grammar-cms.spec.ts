import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { GrammarService } from './grammar.service';
import { QuizPublicationStatus } from '@prisma/client';

describe('AdminGrammarCMS (Phase 4)', () => {
  let grammarService: GrammarService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      grammarTopic: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      grammarQuestion: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      grammarAttempt: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      $transaction: jest.fn((cb) => cb(prisma)),
    };

    grammarService = new GrammarService(prisma, {
      emit: jest.fn(),
      emitAsync: jest.fn().mockResolvedValue([]),
    } as any);
  });

  describe('Grammar Topic Lifecycle & Draft Safety', () => {
    it('creates topic with DRAFT status by default', async () => {
      prisma.grammarTopic.create.mockResolvedValue({
        id: 201,
        title: 'Present Perfect',
        level: 'INTERMEDIATE',
        publicationStatus: QuizPublicationStatus.DRAFT,
      });

      const result = await grammarService.createTopic({
        title: 'Present Perfect',
        level: 'INTERMEDIATE',
      });

      expect(prisma.grammarTopic.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: 'Present Perfect',
          publicationStatus: QuizPublicationStatus.DRAFT,
        }),
      });
      expect(result.publicationStatus).toBe(QuizPublicationStatus.DRAFT);
    });

    it('rejects publishing a grammar topic that has 0 questions', async () => {
      prisma.grammarTopic.findUnique.mockResolvedValue({
        id: 201,
        title: 'Empty Topic',
        questions: [],
      });

      await expect(grammarService.publishTopic(201)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('publishes a grammar topic with valid questions', async () => {
      prisma.grammarTopic.findUnique.mockResolvedValue({
        id: 201,
        title: 'Valid Topic',
        questions: [
          {
            id: 1,
            question: 'She has worked here ___ 2018.',
            options: ['since', 'for', 'in', 'at'],
            correctIndex: 0,
          },
        ],
      });
      prisma.grammarTopic.update.mockResolvedValue({
        id: 201,
        publicationStatus: QuizPublicationStatus.PUBLISHED,
      });

      const result = await grammarService.publishTopic(201);
      expect(result.publicationStatus).toBe(QuizPublicationStatus.PUBLISHED);
    });

    it('unpublishes a grammar topic back to DRAFT', async () => {
      prisma.grammarTopic.findUnique.mockResolvedValue({ id: 201 });
      prisma.grammarTopic.update.mockResolvedValue({
        id: 201,
        publicationStatus: QuizPublicationStatus.DRAFT,
      });

      const result = await grammarService.unpublishTopic(201);
      expect(result.publicationStatus).toBe(QuizPublicationStatus.DRAFT);
    });
  });

  describe('History Safety Guards (Attempt Protection)', () => {
    it('blocks topic deletion if learner attempts exist (409 Conflict)', async () => {
      prisma.grammarTopic.findUnique.mockResolvedValue({ id: 201 });
      prisma.grammarAttempt.findFirst.mockResolvedValue({
        id: 777,
        topicId: 201,
        userId: 1,
      });

      await expect(grammarService.deleteTopic(201)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.grammarTopic.delete).not.toHaveBeenCalled();
    });

    it('allows topic deletion if no learner attempts exist', async () => {
      prisma.grammarTopic.findUnique.mockResolvedValue({ id: 201 });
      prisma.grammarAttempt.findFirst.mockResolvedValue(null);
      prisma.grammarQuestion.deleteMany = jest.fn();
      prisma.grammarTopic.delete.mockResolvedValue({ id: 201 });

      const result = await grammarService.deleteTopic(201);
      expect(result).toEqual({ id: 201 });
    });

    it('blocks question deletion if topic has learner attempts (409 Conflict)', async () => {
      prisma.grammarQuestion.findUnique.mockResolvedValue({
        id: 10,
        topicId: 201,
      });
      prisma.grammarAttempt.findFirst.mockResolvedValue({
        id: 777,
        topicId: 201,
      });

      await expect(grammarService.deleteQuestion(201, 10)).rejects.toThrow(
        ConflictException,
      );
    });

    it('blocks question mutation if topic has learner attempts', async () => {
      prisma.grammarQuestion.findUnique.mockResolvedValue({
        id: 10,
        topicId: 201,
        question: 'Original question prompt',
      });
      prisma.grammarAttempt.findFirst.mockResolvedValue({
        id: 777,
        topicId: 201,
      });

      await expect(
        grammarService.updateQuestion(201, 10, {
          question: 'Changed prompt drastically',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('allows question update if no attempts exist on topic', async () => {
      prisma.grammarQuestion.findUnique.mockResolvedValue({
        id: 10,
        topicId: 201,
        question: 'Original question prompt',
        options: ['A', 'B', 'C', 'D'],
        correctIndex: 0,
      });
      prisma.grammarAttempt.findFirst.mockResolvedValue(null);
      prisma.grammarQuestion.update.mockResolvedValue({
        id: 10,
        explanation: 'Updated explanation text',
      });

      const result = await grammarService.updateQuestion(201, 10, {
        explanation: 'Updated explanation text',
      });
      expect(result.explanation).toBe('Updated explanation text');
    });
  });

  describe('Nested Topic Ownership & Security', () => {
    it('rejects question update if question does not belong to specified topic', async () => {
      prisma.grammarQuestion.findUnique.mockResolvedValue({
        id: 10,
        topicId: 999, // belongs to 999, not 201
      });

      await expect(
        grammarService.updateQuestion(201, 10, { explanation: 'test' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects question reordering if forged cross-topic question IDs are provided', async () => {
      prisma.grammarTopic.findUnique.mockResolvedValue({
        id: 201,
        questions: [{ id: 1 }, { id: 2 }],
      });

      await expect(
        grammarService.reorderQuestions(201, [1, 2, 999]),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Answer Security & Learner Privacy', () => {
    it('redacts correctIndex and explanation for students taking a grammar topic', async () => {
      prisma.grammarTopic.findUnique.mockResolvedValue({
        id: 201,
        title: 'Present Perfect',
        publicationStatus: QuizPublicationStatus.PUBLISHED,
        questions: [
          {
            id: 10,
            question: 'She ___ here since 2018.',
            options: ['works', 'has worked', 'worked', 'working'],
            correctIndex: 1,
            explanation: 'Present perfect is used with since.',
          },
        ],
      });

      // isStaff = false for students
      const studentView = await grammarService.getTopicDetail(
        201,
        undefined,
        false,
      );
      expect(studentView.questions[0].correctIndex).toBeUndefined();
      expect(studentView.questions[0].explanation).toBeUndefined();
      expect(studentView.questions[0].options).toHaveLength(4);
    });

    it('preserves correctIndex and explanation for ADMIN/STAFF users', async () => {
      prisma.grammarTopic.findUnique.mockResolvedValue({
        id: 201,
        title: 'Present Perfect',
        publicationStatus: QuizPublicationStatus.PUBLISHED,
        questions: [
          {
            id: 10,
            question: 'She ___ here since 2018.',
            options: ['works', 'has worked', 'worked', 'working'],
            correctIndex: 1,
            explanation: 'Present perfect is used with since.',
          },
        ],
      });

      // isStaff = true for ADMIN/STAFF
      const adminView = await grammarService.getTopicDetail(
        201,
        undefined,
        true,
      );
      expect(adminView.questions[0].correctIndex).toBe(1);
      expect(adminView.questions[0].explanation).toBe(
        'Present perfect is used with since.',
      );
    });

    it('filters out DRAFT topics from learner catalog for students', async () => {
      prisma.grammarTopic.findMany.mockResolvedValue([
        {
          id: 201,
          title: 'Published Topic',
          publicationStatus: QuizPublicationStatus.PUBLISHED,
          _count: { questions: 5 },
        },
      ]);

      await grammarService.getTopics(undefined, false);
      expect(prisma.grammarTopic.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { publicationStatus: QuizPublicationStatus.PUBLISHED },
        }),
      );
    });
  });
});
