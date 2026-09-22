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
    expect(result.entries[0].definitions[0]).toEqual({
      definition: 'mở',
      meaningVi: 'mở',
      example: 'Open the door.',
    });
  });

  it('keeps IPA available for common function words such as within', async () => {
    const { prisma, service } = createService();
    (prisma.vocabWord.findMany as jest.Mock).mockResolvedValue([
      {
        ...localWord,
        id: 20,
        word: 'within',
        pos: 'preposition',
        ipaUs: '/wɪˈθɪn/',
        ipaUk: '/wɪˈðɪn/',
        meaning: 'trong vòng; bên trong',
      },
    ]);

    const result = await service.lookup('within');

    expect(result.source).toBe('LOCAL');
    expect(result.entries[0].ipaUs).toBe('/wɪˈθɪn/');
    expect(result.entries[0].ipaUk).toBe('/wɪˈðɪn/');
  });

  it('uses the canonical lemma and removes duplicate local part-of-speech tabs', async () => {
    const { prisma, service } = createService();
    (prisma.vocabWord.findMany as jest.Mock).mockResolvedValue([
      {
        ...localWord,
        id: 2,
        word: 'opens',
        ipaUs: null,
        ipaUk: null,
      },
      localWord,
    ]);

    const result = await service.lookup('opens');

    expect(result.canonicalWord).toBe('open');
    expect(result.isInflectionMatch).toBe(true);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].ipaUs).toBe('/oʊpən/');
  });

  it('returns every curated local part of speech with its own IPA', async () => {
    const { prisma, service } = createService();
    (prisma.vocabWord.findMany as jest.Mock).mockResolvedValue([
      {
        ...localWord,
        id: 10,
        word: 'present',
        pos: 'verb',
        ipaUs: '/prɪˈzent/',
        ipaUk: '/prɪˈzent/',
        meaning: 'trình bày; giới thiệu',
      },
      {
        ...localWord,
        id: 11,
        word: 'present',
        pos: 'noun',
        ipaUs: '/ˈprezənt/',
        ipaUk: '/ˈprezənt/',
        meaning: 'hiện tại; món quà',
      },
    ]);

    const result = await service.lookup('present');

    expect(result.entries).toHaveLength(2);
    expect(result.entries.map((entry) => entry.partOfSpeech)).toEqual([
      'verb',
      'noun',
    ]);
    expect(result.entries.map((entry) => entry.ipaUs)).toEqual([
      '/prɪˈzent/',
      '/ˈprezənt/',
    ]);
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
    const redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
    };
    const { prisma, service } = createService(redis);
    (prisma.vocabWord.findMany as jest.Mock).mockResolvedValue([]);
    const provider = {
      lookup: jest.fn().mockRejectedValue(new Error('timeout')),
    } satisfies jest.Mocked<DictionaryProvider>;
    service.provider = provider;
    service.fallbackProvider = provider;

    const result = await service.lookup('sustainable');

    expect(result.entries).toEqual([]);
    expect(result.providerUnavailable).toBe(true);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('falls back to AI provider when primary provider fails', async () => {
    const { prisma, service } = createService();
    (prisma.vocabWord.findMany as jest.Mock).mockResolvedValue([]);
    const primary = {
      lookup: jest.fn().mockRejectedValue(new Error('HTTP timeout')),
    } satisfies jest.Mocked<DictionaryProvider>;
    const fallback = {
      lookup: jest.fn().mockResolvedValue([
        {
          word: 'sustainable',
          partOfSpeech: 'adjective',
          ipaUs: '/səˈsteɪnəbl/',
          ipaUk: '/səˈsteɪnəbl/',
          definitions: [
            {
              definition: 'able to be maintained at a certain rate or level',
              example: 'sustainable development',
              synonyms: [],
              antonyms: [],
            },
          ],
          audioUs: null,
          audioUk: null,
        },
      ]),
    } satisfies jest.Mocked<DictionaryProvider>;

    service.provider = primary;
    service.fallbackProvider = fallback;

    const result = await service.lookup('sustainable');

    expect(primary.lookup).toHaveBeenCalledWith('sustainable');
    expect(fallback.lookup).toHaveBeenCalledWith('sustainable');
    expect(result.source).toBe('EXTERNAL');
    expect(result.entries[0].definitions[0].definition).toContain('maintained');
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

  it('loads and enriches multiple parts of speech for progressive details', async () => {
    const redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
    };
    const { prisma } = createService(redis);
    const provider = {
      lookup: jest.fn().mockResolvedValue([
        {
          word: 'present',
          partOfSpeech: 'noun',
          ipaUs: '/ˈprezənt/',
          ipaUk: '/ˈprezənt/',
          audioUs: null,
          audioUk: null,
          definitions: [
            {
              definition: 'the current time',
              example: 'Focus on the present.',
              synonyms: ['now'],
              antonyms: ['past'],
            },
          ],
        },
        {
          word: 'present',
          partOfSpeech: 'verb',
          ipaUs: '/prɪˈzent/',
          ipaUk: '/prɪˈzent/',
          audioUs: null,
          audioUk: null,
          definitions: [
            {
              definition: 'to show or explain something',
              example: 'She will present the report.',
              synonyms: ['show'],
              antonyms: [],
            },
          ],
        },
      ]),
    } satisfies jest.Mocked<DictionaryProvider>;
    const ai = {
      enrichDictionaryEntry: jest
        .fn()
        .mockResolvedValueOnce({ meaningVi: 'hiện tại' })
        .mockResolvedValueOnce({ meaningVi: 'trình bày' }),
    };
    const service = new DictionaryLookupService(
      prisma,
      redis as never,
      ai as never,
    );
    (service as unknown as { provider: DictionaryProvider }).provider =
      provider;

    const result = await service.lookupExtended('present');

    expect(result.entries).toHaveLength(2);
    expect(result.entries.map((entry) => entry.partOfSpeech)).toEqual([
      'noun',
      'verb',
    ]);
    expect(result.entries.map((entry) => entry.meaningVi)).toEqual([
      'hiện tại',
      'trình bày',
    ]);
    expect(ai.enrichDictionaryEntry).toHaveBeenCalledTimes(2);
    expect(redis.set).toHaveBeenCalledWith(
      'dictionary:extended:v1:en:present',
      expect.any(String),
      'EX',
      30 * 24 * 60 * 60,
    );
  });
});
