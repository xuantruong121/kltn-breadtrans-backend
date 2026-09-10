import { PrismaService } from '../../prisma/prisma.service';
import { DictionaryLookupService } from './dictionary-lookup.service';
import { DictionaryProvider } from './dictionary-provider';

describe('DictionaryLookupService', () => {
  const localWord = {
    id: 1,
    word: 'open',
    pos: 'verb',
    ipaUs: '/oʊpən/',
    ipaUk: '/əʊpən/',
    meaning: 'mở',
    exampleEn: 'Open the door.',
    exampleVi: 'Mở cửa.',
    audioUs: null,
    audioUk: null,
    collocations: [],
  };

  function createService(redis?: { get: jest.Mock; set: jest.Mock }) {
    const prisma = {
      vocabWord: { findMany: jest.fn() },
    } as unknown as PrismaService;
    const service = new DictionaryLookupService(prisma, redis as never);
    return { prisma, service };
  }

  it('prefers curated local data over external provider', async () => {
    const { prisma, service } = createService();
    (prisma.vocabWord.findMany as jest.Mock).mockResolvedValue([localWord]);
    const provider = {
      lookup: jest.fn(),
    } satisfies jest.Mocked<DictionaryProvider>;
    (service as unknown as { provider: DictionaryProvider }).provider =
      provider;

    const result = await service.lookup('opens');

    expect(result.source).toBe('LOCAL');
    expect(result.canonicalWord).toBe('open');
    expect(result.isInflectionMatch).toBe(true);
    expect(provider.lookup).not.toHaveBeenCalled();
  });

  it('normalizes an external result and caches it', async () => {
    const redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
    };
    const { prisma, service } = createService(redis);
    (prisma.vocabWord.findMany as jest.Mock).mockResolvedValue([]);
    const provider = {
      lookup: jest.fn().mockResolvedValue([
        {
          word: 'architecture',
          partOfSpeech: 'noun',
          ipaUs: '/ˈɑːrkɪtektʃər/',
          ipaUk: '/ˈɑːkɪtektʃə/',
          audioUs: null,
          audioUk: null,
          definitions: [
            {
              definition: 'the design of a building',
              example: 'The architecture is distinctive.',
              synonyms: [],
              antonyms: [],
            },
          ],
        },
      ]),
    } satisfies jest.Mocked<DictionaryProvider>;
    (service as unknown as { provider: DictionaryProvider }).provider =
      provider;

    const result = await service.lookup('architecture');

    expect(result.source).toBe('EXTERNAL');
    expect(result.entries[0].partOfSpeech).toBe('noun');
    expect(result.entries[0].definitions[0].definition).toContain('design');
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining('dictionary:v2:en:architecture'),
      expect.any(String),
      'EX',
      5 * 60,
    );

    redis.get.mockResolvedValueOnce(JSON.stringify(result));
    const cached = await service.lookup('architecture');
    expect(cached.source).toBe('CACHE');
    expect(provider.lookup).toHaveBeenCalledTimes(1);
  });

  it('returns a graceful provider-unavailable response', async () => {
    const { prisma, service } = createService();
    (prisma.vocabWord.findMany as jest.Mock).mockResolvedValue([]);
    const provider = {
      lookup: jest.fn().mockRejectedValue(new Error('timeout')),
    } satisfies jest.Mocked<DictionaryProvider>;
    (service as unknown as { provider: DictionaryProvider }).provider =
      provider;

    const result = await service.lookup('sustainable');

    expect(result.entries).toEqual([]);
    expect(result.providerUnavailable).toBe(true);
  });

  it('enriches external entries once and keeps the English provider data', async () => {
    const { prisma } = createService();
    (prisma.vocabWord.findMany as jest.Mock).mockResolvedValue([]);
    const provider = {
      lookup: jest.fn().mockResolvedValue([
        {
          word: 'interoperability',
          partOfSpeech: 'noun',
          ipaUs: '/ˌɪntərˌɑːpərəˈbɪləti/',
          ipaUk: '/ˌɪntərˌɒpərəˈbɪləti/',
          audioUs: null,
          audioUk: null,
          definitions: [
            {
              definition: 'the ability of systems to work together',
              example: 'Interoperability improves data exchange.',
              synonyms: [],
              antonyms: [],
            },
          ],
        },
      ]),
    } satisfies jest.Mocked<DictionaryProvider>;
    const ai = {
      enrichDictionaryEntry: jest.fn().mockResolvedValue({
        meaningVi: 'khả năng tương tác',
        exampleVi: 'Khả năng tương tác giúp trao đổi dữ liệu.',
        collocations: [
          {
            phrase: 'system interoperability',
            meaningVi: 'khả năng tương tác hệ thống',
          },
        ],
      }),
    };
    const enrichedService = new DictionaryLookupService(
      prisma,
      undefined,
      ai as never,
    );
    (enrichedService as unknown as { provider: DictionaryProvider }).provider =
      provider;
    const result = await enrichedService.lookup('interoperability');
    expect(result.entries[0].meaningVi).toBe('khả năng tương tác');
    expect(result.entries[0].ipaUs).toContain('ɑ');
    expect(ai.enrichDictionaryEntry).toHaveBeenCalledTimes(1);
  });
});
