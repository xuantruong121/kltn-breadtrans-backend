import {
  DictionaryApiDevProvider,
  forgetAudioVerdicts,
  normalizeAudioUrl,
  playableAudioUrl,
} from './dictionary-provider';

const answer = (status: number, contentType?: string) =>
  new Response(null, {
    status,
    headers: contentType ? { 'content-type': contentType } : {},
  });

/** A fetch that answers by address; unknown addresses fail like a dead network. */
const fakeFetch = (
  routes: Record<string, (init?: RequestInit) => Response | Promise<Response>>,
) =>
  jest.fn((input: string | URL | Request, init?: RequestInit) => {
    const handler = routes[String(input)];
    if (!handler) return Promise.reject(new Error('network down'));
    return Promise.resolve(handler(init));
  }) as unknown as jest.MockedFunction<typeof fetch>;

const JSON_HEADERS = { 'content-type': 'application/json' };
const US = 'https://media.example/far-1-us.mp3';
const UK = 'https://media.example/far-1-uk.mp3';
const farPayload = (audio: { us: string; uk: string }) =>
  JSON.stringify([
    {
      word: 'far',
      phonetic: '/fɑː/',
      phonetics: [
        { text: '/fɑː/', audio: audio.uk },
        { text: '/fɑɹ/', audio: audio.us },
      ],
      meanings: [
        { partOfSpeech: 'adverb', definitions: [{ definition: 'a long way' }] },
      ],
    },
  ]);

beforeEach(() => forgetAudioVerdicts());

describe('normalizeAudioUrl', () => {
  it('makes a protocol-relative address https and drops what a browser cannot open', () => {
    expect(normalizeAudioUrl('//ssl.gstatic.com/a.mp3')).toBe(
      'https://ssl.gstatic.com/a.mp3',
    );
    expect(normalizeAudioUrl('  https://x.test/a.mp3 ')).toBe(
      'https://x.test/a.mp3',
    );
    expect(normalizeAudioUrl('http://x.test/a.mp3')).toBe(
      'http://x.test/a.mp3',
    );
    expect(normalizeAudioUrl('')).toBeNull();
    expect(normalizeAudioUrl(null)).toBeNull();
    expect(normalizeAudioUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeAudioUrl('far.mp3')).toBeNull();
  });
});

describe('playableAudioUrl', () => {
  it('keeps an address that serves audio', async () => {
    const fetchImpl = fakeFetch({ [US]: () => answer(200, 'audio/mpeg') });
    expect(await playableAudioUrl(US, { fetchImpl })).toBe(US);
    expect(fetchImpl).toHaveBeenCalledWith(
      US,
      expect.objectContaining({ method: 'HEAD' }),
    );
  });

  it('drops an address that answers 404, or serves something that is not audio', async () => {
    const fetchImpl = fakeFetch({
      [US]: () => answer(404),
      [UK]: () => answer(200, 'text/html'),
    });
    expect(await playableAudioUrl(US, { fetchImpl })).toBeNull();
    expect(await playableAudioUrl(UK, { fetchImpl })).toBeNull();
  });

  it('asks a host that refuses HEAD for the first byte instead', async () => {
    const fetchImpl = fakeFetch({
      [US]: (init) =>
        init?.method === 'HEAD' ? answer(405) : answer(206, 'audio/mpeg'),
    });
    expect(await playableAudioUrl(US, { fetchImpl })).toBe(US);
    expect(fetchImpl).toHaveBeenLastCalledWith(
      US,
      expect.objectContaining({
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
      }),
    );
  });

  it('remembers an answer for an hour, even a 404, then asks again', async () => {
    let clock = 1_000;
    const fetchImpl = fakeFetch({ [US]: () => answer(404) });
    const options = { fetchImpl, now: () => clock };
    expect(await playableAudioUrl(US, options)).toBeNull();
    expect(await playableAudioUrl(US, options)).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    clock += 61 * 60 * 1000;
    expect(await playableAudioUrl(US, options)).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not remember a failure to answer: the next lookup asks again', async () => {
    const fetchImpl = fakeFetch({}); // every call rejects
    expect(await playableAudioUrl(US, { fetchImpl })).toBeNull();
    expect(await playableAudioUrl(US, { fetchImpl })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('gives up after the timeout instead of holding the lookup', async () => {
    jest.useFakeTimers();
    try {
      const fetchImpl = jest.fn(
        (_input: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new Error('aborted')),
            );
          }),
      ) as unknown as jest.MockedFunction<typeof fetch>;
      const pending = playableAudioUrl(US, { fetchImpl });
      await jest.advanceTimersByTimeAsync(1600);
      expect(await pending).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('asks for a protocol-relative address over https', async () => {
    const fetchImpl = fakeFetch({
      'https://ssl.gstatic.com/a.mp3': () => answer(200, 'audio/mpeg'),
    });
    expect(
      await playableAudioUrl('//ssl.gstatic.com/a.mp3', { fetchImpl }),
    ).toBe('https://ssl.gstatic.com/a.mp3');
  });
});

describe('DictionaryApiDevProvider audio', () => {
  const lookup = (routes: Parameters<typeof fakeFetch>[0]) => {
    const fetchImpl = fakeFetch({
      'https://api.dictionaryapi.dev/api/v2/entries/en/far': () =>
        new Response(farPayload({ us: US, uk: UK }), {
          status: 200,
          headers: JSON_HEADERS,
        }),
      ...routes,
    });
    return {
      fetchImpl,
      result: new DictionaryApiDevProvider(fetchImpl).lookup('far'),
    };
  };

  it('keeps the phonetics and drops both audio addresses when both are dead (the word "far", 2026-11-28)', async () => {
    const { result } = lookup({
      [US]: () => answer(404),
      [UK]: () => answer(404),
    });
    const [entry] = await result;
    expect(entry.partOfSpeech).toBe('adverb');
    expect(entry.ipaUs).toBe('/fɑɹ/');
    expect(entry.ipaUk).toBe('/fɑː/');
    expect(entry.audioUs).toBeNull();
    expect(entry.audioUk).toBeNull();
  });

  it('keeps the address that plays and drops the one that does not', async () => {
    const { result } = lookup({
      [US]: () => answer(200, 'audio/mpeg'),
      [UK]: () => answer(404),
    });
    const [entry] = await result;
    expect(entry.audioUs).toBe(US);
    expect(entry.audioUk).toBeNull();
  });

  it('asks each address once even when several meanings share it', async () => {
    const fetchImpl = fakeFetch({
      'https://api.dictionaryapi.dev/api/v2/entries/en/far': () =>
        new Response(
          JSON.stringify([
            {
              word: 'far',
              phonetics: [{ text: '/fɑɹ/', audio: US }],
              meanings: [
                { partOfSpeech: 'adverb', definitions: [{ definition: 'a' }] },
                {
                  partOfSpeech: 'adjective',
                  definitions: [{ definition: 'b' }],
                },
              ],
            },
          ]),
          { status: 200, headers: JSON_HEADERS },
        ),
      [US]: () => answer(200, 'audio/mpeg'),
    });
    const entries = await new DictionaryApiDevProvider(fetchImpl).lookup('far');
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.audioUs === US)).toBe(true);
    const audioCalls = fetchImpl.mock.calls.filter(([url]) => url === US);
    expect(audioCalls).toHaveLength(1);
  });

  it('still answers when the audio check cannot reach the network', async () => {
    const { result } = lookup({}); // the audio addresses are unknown: rejects
    const [entry] = await result;
    expect(entry.ipaUs).toBe('/fɑɹ/');
    expect(entry.audioUs).toBeNull();
  });

  it('returns nothing for a word the provider does not know', async () => {
    const fetchImpl = fakeFetch({
      'https://api.dictionaryapi.dev/api/v2/entries/en/zzz': () => answer(404),
    });
    expect(await new DictionaryApiDevProvider(fetchImpl).lookup('zzz')).toEqual(
      [],
    );
  });
});
