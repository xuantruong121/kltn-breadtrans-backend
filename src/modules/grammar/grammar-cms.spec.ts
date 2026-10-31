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
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn((cb) => cb(prisma)),
    };

    grammarService = new GrammarService(
      prisma,
      {
        emit: jest.fn(),
        emitAsync: jest.fn().mockResolvedValue([]),
      } as any,
      {} as any,
    );
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
      prisma.grammarAttempt.count.mockResolvedValue(1);

      await expect(grammarService.deleteTopic(201)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.grammarTopic.delete).not.toHaveBeenCalled();
    });

    it('allows topic deletion if no learner attempts exist', async () => {
      prisma.grammarTopic.findUnique.mockResolvedValue({ id: 201 });
      prisma.grammarAttempt.count.mockResolvedValue(0);
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
      prisma.grammarAttempt.count.mockResolvedValue(1);

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
      prisma.grammarAttempt.count.mockResolvedValue(1);

      await expect(
        grammarService.updateQuestion(201, 10, {
          question: 'Changed prompt drastically',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('lets an explanation be corrected after learners attempted the topic', async () => {
      prisma.grammarQuestion.findUnique.mockResolvedValue({
        id: 10,
        topicId: 201,
        question: 'She ___ here.',
        options: ['is', 'are', 'am', 'be'],
        correctIndex: 0,
      });
      prisma.grammarAttempt.count.mockResolvedValue(1);
      prisma.grammarQuestion.update.mockResolvedValue({
        id: 10,
        explanation: 'x',
      });

      await expect(
        grammarService.updateQuestion(201, 10, {
          question: 'She ___ here.',
          options: ['is', 'are', 'am', 'be'],
          correctIndex: 0,
          explanation: 'Chủ ngữ số ít dùng is.',
        }),
      ).resolves.toBeDefined();
    });

    it('still blocks a changed answer after attempts', async () => {
      prisma.grammarQuestion.findUnique.mockResolvedValue({
        id: 10,
        topicId: 201,
        question: 'She ___ here.',
        options: ['is', 'are', 'am', 'be'],
        correctIndex: 0,
      });
      prisma.grammarAttempt.count.mockResolvedValue(1);

      await expect(
        grammarService.updateQuestion(201, 10, { correctIndex: 1 }),
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
      prisma.grammarAttempt.count.mockResolvedValue(0);
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
      expect(adminView).toEqual(
        expect.objectContaining({ learnerAttemptCount: 0, locked: false }),
      );
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

    it('blocks attempts against a topic that is not published', async () => {
      prisma.grammarTopic.findUnique.mockResolvedValue({
        id: 201,
        publicationStatus: QuizPublicationStatus.DRAFT,
        questions: [],
      });

      await expect(grammarService.submitAttempt(201, 7, {})).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('F14 authoring rules', () => {
    const valid = {
      question: 'She ___ to work yesterday.',
      options: ['went', 'goes', 'go', 'going'],
      correctIndex: 0,
      explanation: 'yesterday → quá khứ đơn.',
    };

    it('counts only learner attempts for the lock', async () => {
      prisma.grammarQuestion.findUnique.mockResolvedValue({
        id: 10,
        topicId: 201,
      });
      prisma.grammarAttempt.count.mockResolvedValue(0);
      prisma.grammarQuestion.delete.mockResolvedValue({ id: 10 });
      await grammarService.deleteQuestion(201, 10);
      expect(prisma.grammarAttempt.count).toHaveBeenCalledWith({
        where: { topicId: 201, user: { role: 'STUDENT' } },
      });
      expect(prisma.grammarQuestion.delete).toHaveBeenCalled();
    });

    it('refuses a question without exactly 4 distinct options', async () => {
      prisma.grammarTopic.findUnique.mockResolvedValue({ id: 201 });
      await expect(
        grammarService.createQuestion(201, {
          ...valid,
          options: ['went', 'goes', 'go'],
        }),
      ).rejects.toThrow('Cần đúng 4 đáp án');
      await expect(
        grammarService.createQuestion(201, {
          ...valid,
          options: ['went', 'Went ', 'go', 'going'],
        }),
      ).rejects.toThrow('Có hai đáp án giống nhau');
      expect(prisma.grammarQuestion.create).not.toHaveBeenCalled();
    });

    it('stores why-wrong notes aligned with options, none at the answer', async () => {
      prisma.grammarTopic.findUnique.mockResolvedValue({ id: 201 });
      prisma.grammarQuestion.create.mockResolvedValue({ id: 1 });
      await grammarService.createQuestion(201, {
        ...valid,
        optionExplanations: ['ignored', ' hiện tại đơn ', '', null],
      });
      expect(prisma.grammarQuestion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          optionExplanations: [null, 'hiện tại đơn', null, null],
        }),
      });
    });

    it('adds a batch after the last question, all or nothing', async () => {
      prisma.grammarTopic.findUnique.mockResolvedValue({ id: 201 });
      prisma.grammarQuestion.aggregate = jest
        .fn()
        .mockResolvedValue({ _max: { order: 4 } });
      prisma.grammarQuestion.create.mockImplementation(
        ({ data }: { data: unknown }) => data,
      );
      prisma.$transaction = jest.fn((ops) => Promise.all(ops));

      await expect(
        grammarService.createQuestions(201, [
          valid,
          { ...valid, correctIndex: 7 },
        ]),
      ).rejects.toThrow('Câu 2: Chưa chọn đáp án đúng');
      expect(prisma.grammarQuestion.create).not.toHaveBeenCalled();

      const created = await grammarService.createQuestions(201, [
        valid,
        { ...valid, question: 'They ___ late.' },
      ]);
      expect(created.map((q: any) => q.order)).toEqual([5, 6]);
    });

    it('re-aligns the notes when the answer moves', async () => {
      prisma.grammarQuestion.findUnique.mockResolvedValue({
        id: 10,
        topicId: 201,
        ...valid,
        optionExplanations: [null, 'sai thì', 'sai dạng', 'sai dạng'],
      });
      prisma.grammarQuestion.update.mockResolvedValue({ id: 10 });
      await grammarService.updateQuestion(201, 10, { correctIndex: 1 });
      expect(prisma.grammarQuestion.update).toHaveBeenCalledWith({
        where: { id: 10 },
        data: expect.objectContaining({
          correctIndex: 1,
          optionExplanations: [null, null, 'sai dạng', 'sai dạng'],
        }),
      });
    });

    it('returns the why-wrong notes with the graded result', async () => {
      prisma.grammarTopic.findUnique.mockResolvedValue({
        id: 201,
        publicationStatus: QuizPublicationStatus.PUBLISHED,
        questions: [
          {
            id: 10,
            ...valid,
            optionExplanations: [null, 'hiện tại đơn', null, null],
          },
        ],
      });
      prisma.$executeRaw = jest.fn();
      prisma.grammarAttempt.create.mockResolvedValue({ id: 99 });
      prisma.userGrammarReward = {
        findUnique: jest.fn().mockResolvedValue({ id: 1 }),
        create: jest.fn(),
      };
      const result = await grammarService.submitAttempt(201, 5, { 10: 1 });
      expect(result.questionsResult[0]).toEqual(
        expect.objectContaining({
          isCorrect: false,
          optionExplanations: [null, 'hiện tại đơn', null, null],
        }),
      );
    });

    it('pages the admin topic list with learner attempt counts', async () => {
      prisma.grammarTopic.findMany.mockResolvedValue([
        {
          id: 2,
          title: 'Past simple',
          level: 'BEGINNER',
          publicationStatus: 'PUBLISHED',
          _count: { questions: 5 },
        },
        {
          id: 1,
          title: 'Articles',
          level: 'BEGINNER',
          publicationStatus: 'DRAFT',
          _count: { questions: 0 },
        },
      ]);
      prisma.grammarAttempt.groupBy = jest
        .fn()
        .mockResolvedValue([{ topicId: 2, _count: { _all: 3 } }]);
      const all = (await grammarService.getAdminTopics()) as any[];
      expect(all.map((t) => [t.id, t.learnerAttemptCount])).toEqual([
        [2, 3],
        [1, 0],
      ]);
      const page = (await grammarService.getAdminTopics({
        page: '1',
        status: 'DRAFT',
      })) as any;
      expect(page.items.map((t: any) => t.id)).toEqual([1]);
      expect(page.facets).toEqual({ total: 2, published: 1, locked: 1 });
    });
  });
});
