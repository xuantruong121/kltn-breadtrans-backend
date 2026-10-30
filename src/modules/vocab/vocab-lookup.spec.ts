import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { VocabService } from './vocab.service';

type MockFn = jest.Mock;

describe('VocabService - Interactive Dictionary Lookup', () => {
  let service: VocabService;
  let mockPrisma: {
    dictionaryEntry: { findMany: MockFn };
    vocabTopic: { findMany: MockFn };
  };
  let mockEventEmitter: { emit: MockFn };

  beforeEach(() => {
    mockPrisma = {
      dictionaryEntry: {
        findMany: jest.fn(),
      },
      vocabTopic: {
        findMany: jest.fn(),
      },
    };
    mockEventEmitter = {
      emit: jest.fn(),
    };
    service = new VocabService(
      mockPrisma as unknown as PrismaService,
      mockEventEmitter as unknown as EventEmitter2,
    );
  });

  it('rejects empty or invalid input with BadRequestException', async () => {
    await expect(service.lookupWord('')).rejects.toThrow(BadRequestException);
    await expect(service.lookupWord('   ')).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.lookupWord('!!!')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('performs exact match lookup ignoring case', async () => {
    mockPrisma.dictionaryEntry.findMany.mockResolvedValueOnce([
      {
        id: 10,
        displayWord: 'meeting',
        pos: 'noun',
        ipaUs: 'ˈmiːtɪŋ',
        ipaUk: 'ˈmiːtɪŋ',
        meaningVi: 'cuộc họp',
        exampleEn: 'We have a meeting tomorrow.',
        exampleVi: 'Chúng tôi có một cuộc họp vào ngày mai.',
        audioUs: 'https://cdn.example.com/audio/meeting-us.mp3',
        audioUk: 'https://cdn.example.com/audio/meeting-uk.mp3',
      },
    ]);

    const result = await service.lookupWord('Meeting');
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].word).toBe('meeting');
    expect(result.canonicalWord).toBe('meeting');
    expect(result.isInflectionMatch).toBe(false);
    expect(mockPrisma.dictionaryEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          headword: { in: ['meeting'] },
          status: { not: 'REJECTED' },
        },
      }),
    );
  });

  it('normalizes surrounding punctuation marks correctly', async () => {
    mockPrisma.dictionaryEntry.findMany.mockResolvedValueOnce([
      {
        id: 11,
        displayWord: 'project',
        pos: 'noun',
        meaningVi: 'dự án',
      },
    ]);

    const result = await service.lookupWord('“project”?!');
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].word).toBe('project');
    expect(mockPrisma.dictionaryEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          headword: { in: ['project'] },
          status: { not: 'REJECTED' },
        },
      }),
    );
  });

  it('supports plural inflection matching (e.g. "meetings" -> "meeting")', async () => {
    // 1. Exact match returns empty
    mockPrisma.dictionaryEntry.findMany.mockResolvedValueOnce([]);
    // 2. Inflection candidate lookup returns lemma
    mockPrisma.dictionaryEntry.findMany.mockResolvedValueOnce([
      {
        id: 10,
        displayWord: 'meeting',
        pos: 'noun',
        meaningVi: 'cuộc họp',
      },
    ]);

    const result = await service.lookupWord('meetings');
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].word).toBe('meeting');
    expect(result.canonicalWord).toBe('meeting');
    expect(result.isInflectionMatch).toBe(true);
    expect(mockPrisma.dictionaryEntry.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          headword: { in: expect.arrayContaining(['meeting']) },
          status: { not: 'REJECTED' },
        },
      }),
    );
  });

  it('supports continuous verb inflection (e.g. "making" -> "make")', async () => {
    mockPrisma.dictionaryEntry.findMany.mockResolvedValueOnce([]);
    mockPrisma.dictionaryEntry.findMany.mockResolvedValueOnce([
      {
        id: 20,
        displayWord: 'make',
        pos: 'verb',
        meaningVi: 'làm, chế tạo',
      },
    ]);

    const result = await service.lookupWord('making');
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].word).toBe('make');
  });

  it('supports past tense inflection (e.g. "walked" -> "walk")', async () => {
    mockPrisma.dictionaryEntry.findMany.mockResolvedValueOnce([]);
    mockPrisma.dictionaryEntry.findMany.mockResolvedValueOnce([
      {
        id: 30,
        displayWord: 'walk',
        pos: 'verb',
        meaningVi: 'đi bộ',
      },
    ]);

    const result = await service.lookupWord('walked');
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].word).toBe('walk');
  });

  it('returns an empty result for a valid word absent from the dictionary', async () => {
    mockPrisma.dictionaryEntry.findMany.mockResolvedValueOnce([]);
    mockPrisma.dictionaryEntry.findMany.mockResolvedValueOnce([]);

    await expect(service.lookupWord('supercalifragilistic')).resolves.toEqual(
      expect.objectContaining({
        query: 'supercalifragilistic',
        canonicalWord: null,
        isInflectionMatch: false,
        matches: [],
      }),
    );
  });
});
