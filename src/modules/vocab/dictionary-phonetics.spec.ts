import { PrismaService } from '../../prisma/prisma.service';
import { DictionaryLookupService } from './dictionary-lookup.service';
import {
  DictionaryApiDevProvider,
  ProviderDictionaryEntry,
  forgetAudioVerdicts,
} from './dictionary-provider';

/**
 * The admin form's "Lấy phiên âm" (owner 2026-11-28): the external dictionary's
 * phonetics for a word, with nothing read from or written to the store.
 */
describe('DictionaryLookupService.phoneticsFor', () => {
  const entry = (
    over: Partial<ProviderDictionaryEntry> = {},
  ): ProviderDictionaryEntry => ({
    word: 'far',
    partOfSpeech: 'adverb',
    ipaUs: '/fɑɹ/',
    ipaUk: '/fɑː/',
    definitions: [],
    audioUs: null,
    audioUk: null,
    ipaUsShared: false,
    ipaUkShared: false,
    ...over,
  });

  function build(providers: { primary?: jest.Mock; fallback?: jest.Mock }) {
    const prisma = {
      dictionaryEntry: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        createMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    const redis = { get: jest.fn(), set: jest.fn() };
    const service = new DictionaryLookupService(
      prisma as unknown as PrismaService,
      redis as never,
    );
    service.provider = {
      lookup: providers.primary ?? jest.fn().mockResolvedValue([]),
    };
    service.fallbackProvider = {
      lookup: providers.fallback ?? jest.fn().mockRejectedValue(new Error('x')),
    };
    return { service, prisma, redis };
  }

  it('asks the external dictionary even for a word the store already has, and writes nothing', async () => {
    const primary = jest.fn().mockResolvedValue([entry()]);
    const { service, prisma, redis } = build({ primary });

    const result = await service.phoneticsFor(' Far ');

    expect(primary).toHaveBeenCalledWith('far');
    expect(result).toEqual(
      expect.objectContaining({
        source: 'DICTIONARY',
        found: true,
        ipaUs: '/fɑɹ/',
        ipaUk: '/fɑː/',
        usIsShared: false,
        ukIsShared: false,
      }),
    );
    // Nothing from the store, nothing into it, nothing in the cache.
    for (const call of Object.values(prisma.dictionaryEntry))
      expect(call).not.toHaveBeenCalled();
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it("says when the UK phonetics is the dictionary's one general phonetics", async () => {
    const primary = jest.fn().mockResolvedValue([
      entry({
        word: 'allegation',
        partOfSpeech: 'noun',
        ipaUs: '/ˌæl.əˈɡeɪ.ʃən/',
        ipaUk: '/ˌæl.əˈɡeɪ.ʃən/',
        ipaUsShared: false,
        ipaUkShared: true,
      }),
    ]);
    const { service } = build({ primary });

    const result = await service.phoneticsFor('allegation');

    expect(result.ipaUk).toBe('/ˌæl.əˈɡeɪ.ʃən/');
    expect(result.ukIsShared).toBe(true);
    expect(result.usIsShared).toBe(false);
  });

  it('takes the entry of the part of speech asked for, else the first with phonetics', async () => {
    const primary = jest
      .fn()
      .mockResolvedValue([
        entry({ partOfSpeech: 'noun', ipaUs: null, ipaUk: null }),
        entry({ partOfSpeech: 'adjective', ipaUs: '/a/', ipaUk: '/a/' }),
        entry({ partOfSpeech: 'adverb', ipaUs: '/b/', ipaUk: '/b/' }),
      ]);
    const { service } = build({ primary });

    expect((await service.phoneticsFor('far', 'Adverb')).ipaUs).toBe('/b/');
    expect((await service.phoneticsFor('far', 'verb')).ipaUs).toBe('/a/');
    expect((await service.phoneticsFor('far')).ipaUs).toBe('/a/');
  });

  it('answers found: false for a word with no phonetics, not an error', async () => {
    const { service } = build({
      primary: jest
        .fn()
        .mockResolvedValue([entry({ ipaUs: null, ipaUk: null })]),
    });
    expect(await service.phoneticsFor('zzzz')).toEqual(
      expect.objectContaining({ found: false, unavailable: false }),
    );
    const none = build({ primary: jest.fn().mockResolvedValue([]) });
    expect((await none.service.phoneticsFor('zzzz')).found).toBe(false);
  });

  it('falls back to the AI dictionary when the public one fails', async () => {
    const fallback = jest
      .fn()
      .mockResolvedValue([entry({ ipaUs: '/x/', ipaUk: '/y/' })]);
    const { service } = build({
      primary: jest.fn().mockRejectedValue(new Error('timeout')),
      fallback,
    });
    const result = await service.phoneticsFor('far');
    expect(fallback).toHaveBeenCalledWith('far');
    expect(result).toEqual(
      expect.objectContaining({
        source: 'AI',
        found: true,
        ipaUs: '/x/',
        ipaUk: '/y/',
      }),
    );
  });

  it('says "unavailable", not "no phonetics", when both dictionaries fail', async () => {
    const { service } = build({
      primary: jest.fn().mockRejectedValue(new Error('timeout')),
      fallback: jest.fn().mockRejectedValue(new Error('no keys')),
    });
    expect(await service.phoneticsFor('far')).toEqual(
      expect.objectContaining({ found: false, unavailable: true }),
    );
  });

  it('refuses text that is not a single word', async () => {
    const { service } = build({});
    await expect(service.phoneticsFor('   ')).rejects.toThrow('Vui lòng nhập');
    await expect(service.phoneticsFor('give up')).rejects.toThrow(
      'một từ hợp lệ',
    );
  });
});

describe('DictionaryApiDevProvider general phonetics flags', () => {
  beforeEach(() => forgetAudioVerdicts());

  const providerFor = (
    phonetics: Array<{ text?: string; audio?: string }>,
    phonetic?: string,
  ) =>
    new DictionaryApiDevProvider(
      jest.fn((url: string | URL | Request) =>
        Promise.resolve(
          String(url).includes('/entries/en/')
            ? new Response(
                JSON.stringify([
                  {
                    word: 'w',
                    phonetic,
                    phonetics,
                    meanings: [
                      {
                        partOfSpeech: 'noun',
                        definitions: [{ definition: 'd' }],
                      },
                    ],
                  },
                ]),
                {
                  status: 200,
                  headers: { 'content-type': 'application/json' },
                },
              )
            : new Response(null, { status: 404 }),
        ),
      ),
    );

  it('marks a UK phonetics that is only the general one', async () => {
    const [entry] = await providerFor([
      { text: '/g/' },
      { text: '/g/', audio: 'https://m.test/w-us.mp3' },
    ]).lookup('w');
    expect(entry.ipaUs).toBe('/g/');
    expect(entry.ipaUsShared).toBe(false); // tagged US by its audio name
    expect(entry.ipaUk).toBe('/g/');
    expect(entry.ipaUkShared).toBe(true);
  });

  it('does not mark an accent the dictionary tagged itself ("far")', async () => {
    const [entry] = await providerFor([
      { text: '/fɑː/', audio: 'https://m.test/far-1-uk.mp3' },
      { text: '/fɑɹ/', audio: 'https://m.test/far-1-us.mp3' },
    ]).lookup('w');
    expect(entry.ipaUkShared).toBe(false);
    expect(entry.ipaUsShared).toBe(false);
    expect(entry.ipaUk).toBe('/fɑː/');
  });

  it('marks both when the dictionary gives one untagged phonetics', async () => {
    const [entry] = await providerFor([{ text: '/o/' }], '/o/').lookup('w');
    expect(entry.ipaUsShared).toBe(true);
    expect(entry.ipaUkShared).toBe(true);
  });

  it('marks neither when there is no phonetics at all', async () => {
    const [entry] = await providerFor([], undefined).lookup('w');
    expect(entry.ipaUs).toBeNull();
    expect(entry.ipaUsShared).toBe(false);
    expect(entry.ipaUkShared).toBe(false);
  });
});
