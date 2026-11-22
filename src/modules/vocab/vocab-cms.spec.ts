import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AdminService } from '../admin/admin.service';
import { QuizPublicationStatus } from '@prisma/client';

describe('AdminVocabCMS (Phase 4)', () => {
  let adminService: AdminService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      vocabTopic: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      vocabWord: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      dictionaryEntry: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      userVocabWordProgress: {
        findFirst: jest.fn(),
      },
      // The row locks of the delete paths (audit A5): SELECT ... FOR UPDATE.
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn((arg) =>
        typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
      ),
    };

    adminService = new AdminService(prisma, {} as any, {} as any, {} as any);
  });

  describe('Topic Lifecycle & Draft Safety', () => {
    it('creates a new topic with DRAFT status by default', async () => {
      prisma.vocabTopic.create.mockResolvedValue({
        id: 101,
        title: 'New Topic',
        categoryName: '600 TỪ TOEIC',
        publicationStatus: QuizPublicationStatus.DRAFT,
      });

      const result = await adminService.createVocabTopic({
        title: 'New Topic',
        categoryName: '600 TỪ TOEIC',
      });

      expect(prisma.vocabTopic.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: 'New Topic',
          publicationStatus: QuizPublicationStatus.DRAFT,
        }),
      });
      expect(result.publicationStatus).toBe(QuizPublicationStatus.DRAFT);
    });

    it('rejects publishing a topic that has 0 words (publish preflight)', async () => {
      prisma.vocabTopic.findUnique.mockResolvedValue({
        id: 101,
        title: 'Empty Topic',
        words: [],
      });

      await expect(adminService.publishVocabTopic(101)).rejects.toThrow(
        BadRequestException,
      );
    });

    const readyWord = (id: number, word: string, meaningVi: string) => ({
      id,
      entry: {
        displayWord: word,
        meaningVi,
        ipaUs: '/ˈkɒntrækt/',
        exampleEn: `The ${word} is ready.`,
      },
    });

    // QA 2026-11-22: a deck at 2/5 of its checklist was published; the
    // server now refuses what the editor's checklist refuses.
    it('rejects a deck the checklist does not pass, naming what is missing', async () => {
      prisma.vocabTopic.findUnique.mockResolvedValue({
        id: 101,
        title: 'Half done',
        words: [
          readyWord(1, 'contract', 'hợp đồng'),
          {
            id: 2,
            entry: { displayWord: 'invoice', meaningVi: 'hoá đơn' },
          },
        ],
      });

      await expect(adminService.publishVocabTopic(101)).rejects.toThrow(
        'Còn thiếu: phiên âm 1/2 từ; câu ví dụ 1/2 từ; ít nhất 4 nghĩa khác nhau cho bước Trắc nghiệm.',
      );
      expect(prisma.vocabTopic.update).not.toHaveBeenCalled();
    });

    it('publishes a deck that passes every checklist item', async () => {
      prisma.vocabTopic.findUnique.mockResolvedValue({
        id: 101,
        title: 'Valid Topic',
        words: [
          readyWord(1, 'contract', 'hợp đồng'),
          readyWord(2, 'invoice', 'hoá đơn'),
          readyWord(3, 'agenda', 'chương trình họp'),
          readyWord(4, 'deadline', 'hạn chót'),
        ],
      });
      prisma.vocabTopic.update.mockResolvedValue({
        id: 101,
        publicationStatus: QuizPublicationStatus.PUBLISHED,
      });

      const result = await adminService.publishVocabTopic(101);
      expect(result.publicationStatus).toBe(QuizPublicationStatus.PUBLISHED);
      expect(prisma.vocabTopic.update).toHaveBeenCalledWith({
        where: { id: 101 },
        data: {
          publicationStatus: QuizPublicationStatus.PUBLISHED,
          totalWords: 4,
        },
      });
      // The words are counted with the topic locked (audit A8).
      expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.vocabTopic.findUnique.mock.invocationCallOrder[0],
      );
    });

    it('unpublishes a topic back to DRAFT', async () => {
      prisma.vocabTopic.findUnique.mockResolvedValue({ id: 101 });
      prisma.vocabTopic.update.mockResolvedValue({
        id: 101,
        publicationStatus: QuizPublicationStatus.DRAFT,
      });

      const result = await adminService.unpublishVocabTopic(101);
      expect(result.publicationStatus).toBe(QuizPublicationStatus.DRAFT);
    });
  });

  describe('History Safety Guards (SRS Progress Protection)', () => {
    it('blocks topic deletion if learner progress exists (409 Conflict)', async () => {
      prisma.vocabTopic.findUnique.mockResolvedValue({
        id: 101,
        words: [{ id: 1 }, { id: 2 }],
      });
      prisma.userVocabWordProgress.findFirst.mockResolvedValue({
        id: 999,
        userId: 1,
        wordId: 1,
      });

      await expect(adminService.deleteVocabTopic(101)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.vocabTopic.delete).not.toHaveBeenCalled();
    });

    it('allows topic deletion if no learner progress exists', async () => {
      prisma.vocabTopic.findUnique.mockResolvedValue({
        id: 101,
        words: [{ id: 1 }],
      });
      prisma.userVocabWordProgress.findFirst.mockResolvedValue(null);
      prisma.vocabWord.deleteMany = jest.fn();
      prisma.vocabTopic.delete.mockResolvedValue({ id: 101 });

      const result = await adminService.deleteVocabTopic(101);
      expect(result).toEqual({ id: 101 });
    });

    it('blocks destructive semantic mutation of word if learner progress exists', async () => {
      prisma.vocabWord.findUnique.mockResolvedValue({
        id: 5,
        topicId: 101,
        entryId: 40,
        entry: {
          id: 40,
          headword: 'abide by',
          displayWord: 'Abide by',
          pos: 'verb',
          meaningVi: 'Tuân theo',
          status: 'APPROVED',
        },
      });
      prisma.userVocabWordProgress.findFirst.mockResolvedValue({
        id: 88,
        wordId: 5,
      });

      // Attempting to change the word to a completely different term
      await expect(
        adminService.updateVocabWord(101, 5, { word: 'Completely different' }),
      ).rejects.toThrow(ConflictException);

      // Attempting to change meaning to something else
      await expect(
        adminService.updateVocabWord(101, 5, {
          meaning: 'Nghĩa khác hoàn toàn',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('allows non-destructive metadata updates (IPA, audio, examples) even if learner progress exists', async () => {
      prisma.vocabWord.findUnique.mockResolvedValue({
        id: 5,
        topicId: 101,
        entryId: 40,
        entry: {
          id: 40,
          headword: 'abide by',
          displayWord: 'Abide by',
          pos: 'verb',
          meaningVi: 'Tuân theo',
          status: 'APPROVED',
        },
      });
      prisma.userVocabWordProgress.findFirst.mockResolvedValue({
        id: 88,
        wordId: 5,
      });
      prisma.vocabWord.update.mockResolvedValue({
        id: 5,
        topicId: 101,
        entryId: 40,
        entry: { id: 40, displayWord: 'Abide by', ipaUs: 'əˈbaɪd baɪ' },
      });

      const result = await adminService.updateVocabWord(101, 5, {
        ipaUs: 'əˈbaɪd baɪ',
      });
      expect(result.ipaUs).toBe('əˈbaɪd baɪ');
      expect(prisma.dictionaryEntry.update).toHaveBeenCalledWith({
        where: { id: 40 },
        data: { ipaUs: 'əˈbaɪd baɪ' },
      });
    });

    it('blocks word deletion if learner progress exists (409 Conflict)', async () => {
      prisma.vocabWord.findUnique.mockResolvedValue({ id: 5, topicId: 101 });
      prisma.userVocabWordProgress.findFirst.mockResolvedValue({
        id: 88,
        wordId: 5,
      });

      await expect(adminService.deleteVocabWord(101, 5)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.vocabWord.delete).not.toHaveBeenCalled();
    });
  });

  describe('Nested Topic Ownership & Reorder Security', () => {
    it('rejects word update if word does not belong to specified topic', async () => {
      prisma.vocabWord.findUnique.mockResolvedValue({
        id: 5,
        topicId: 999, // belongs to topic 999, not 101
      });

      await expect(
        adminService.updateVocabWord(101, 5, { meaning: 'test' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects word deletion if word does not belong to specified topic', async () => {
      prisma.vocabWord.findUnique.mockResolvedValue({
        id: 5,
        topicId: 999, // belongs to topic 999
      });

      await expect(adminService.deleteVocabWord(101, 5)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects reordering when submitted word IDs contain cross-topic forged IDs', async () => {
      prisma.vocabTopic.findUnique.mockResolvedValue({
        id: 101,
        words: [{ id: 1 }, { id: 2 }],
      });

      // Request includes wordId 3 which does not belong to topic 101
      await expect(
        adminService.reorderVocabWords(101, [1, 2, 3]),
      ).rejects.toThrow(BadRequestException);
    });

    it('reorders words within topic successfully when all IDs are valid', async () => {
      prisma.vocabTopic.findUnique.mockResolvedValue({
        id: 101,
        words: [{ id: 1 }, { id: 2 }],
      });
      prisma.vocabWord.update.mockResolvedValue({});

      const result = await adminService.reorderVocabWords(101, [2, 1]);
      expect(result).toEqual({ success: true });
    });
  });
});
