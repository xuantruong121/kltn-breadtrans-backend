import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { VocabService } from './vocab.service';

type MockFn = jest.Mock;

describe('VocabService - Interactive Dictionary Lookup', () => {
  let service: VocabService;
  let mockPrisma: {
    vocabWord: { findMany: MockFn };
    vocabTopic: { findMany: MockFn };
  };
  let mockEventEmitter: { emit: MockFn };

  beforeEach(() => {
    mockPrisma = {
      vocabWord: {
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
    mockPrisma.vocabWord.findMany.mockResolvedValueOnce([
      {
        id: 10,
        word: 'meeting',
        pos: 'noun',
        ipaUs: 'ˈmiːtɪŋ',
        ipaUk: 'ˈmiːtɪŋ',
        meaning: 'cuộc họp',
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
    expect(mockPrisma.vocabWord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          word: { equals: 'meeting', mode: 'insensitive' },
        },
      }),
    );
  });

  it('normalizes surrounding punctuation marks correctly', async () => {
    mockPrisma.vocabWord.findMany.mockResolvedValueOnce([
      {
        id: 11,
        word: 'project',
        pos: 'noun',
        meaning: 'dự án',
      },
    ]);

    const result = await service.lookupWord('“project”?!');
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].word).toBe('project');
    expect(mockPrisma.vocabWord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          word: { equals: 'project', mode: 'insensitive' },
        },
      }),
    );
  });

  it('supports plural inflection matching (e.g. "meetings" -> "meeting")', async () => {
    // 1. Exact match returns empty
    mockPrisma.vocabWord.findMany.mockResolvedValueOnce([]);
    // 2. Inflection candidate lookup returns lemma
    mockPrisma.vocabWord.findMany.mockResolvedValueOnce([
      {
        id: 10,
        word: 'meeting',
        pos: 'noun',
        meaning: 'cuộc họp',
      },
    ]);

    const result = await service.lookupWord('meetings');
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].word).toBe('meeting');
    expect(result.canonicalWord).toBe('meeting');
    expect(result.isInflectionMatch).toBe(true);
    expect(mockPrisma.vocabWord.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          word: {
            in: expect.arrayContaining(['meeting']),
            mode: 'insensitive',
          },
        },
      }),
    );
  });

  it('supports continuous verb inflection (e.g. "making" -> "make")', async () => {
    mockPrisma.vocabWord.findMany.mockResolvedValueOnce([]);
    mockPrisma.vocabWord.findMany.mockResolvedValueOnce([
      {
        id: 20,
        word: 'make',
        pos: 'verb',
        meaning: 'làm, chế tạo',
      },
    ]);

    const result = await service.lookupWord('making');
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].word).toBe('make');
  });

  it('supports past tense inflection (e.g. "walked" -> "walk")', async () => {
    mockPrisma.vocabWord.findMany.mockResolvedValueOnce([]);
    mockPrisma.vocabWord.findMany.mockResolvedValueOnce([
      {
        id: 30,
        word: 'walk',
        pos: 'verb',
        meaning: 'đi bộ',
      },
    ]);

    const result = await service.lookupWord('walked');
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].word).toBe('walk');
  });

  it('returns an empty result for a valid word absent from the dictionary', async () => {
    mockPrisma.vocabWord.findMany.mockResolvedValueOnce([]);
    mockPrisma.vocabWord.findMany.mockResolvedValueOnce([]);

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
