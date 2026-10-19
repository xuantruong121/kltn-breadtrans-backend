import {
  buildToeicListeningSsml,
  normalizeAzureSpeechResponse,
} from './ai.service';

describe('Azure Speech SSML authoring', () => {
  it('includes the required synthesis namespace and escapes transcript text', () => {
    const ssml = buildToeicListeningSsml(
      'Narrator: Read <this> & say "hello".',
    );

    expect(ssml).toContain('xmlns="http://www.w3.org/2001/10/synthesis"');
    expect(ssml).toContain('Read &lt;this&gt; &amp; say &quot;hello&quot;.');
    expect(ssml).not.toContain('<break');
  });
});

describe('Azure Speech media normalization', () => {
  it('returns non-empty audio bytes on a successful synthesis response', async () => {
    const bytes = Buffer.from('ID3qa-audio', 'ascii');
    await expect(
      normalizeAzureSpeechResponse({
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: () =>
          Promise.resolve(
            bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            ),
          ),
      }),
    ).resolves.toEqual(bytes);
  });

  it('fails closed when Azure reports success with empty audio', async () => {
    await expect(
      normalizeAzureSpeechResponse({
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      }),
    ).rejects.toThrow('empty audio bytes');
  });

  it('preserves controlled provider status errors without exposing secrets', async () => {
    await expect(
      normalizeAzureSpeechResponse({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        text: () => Promise.resolve('invalid subscription key'),
      }),
    ).rejects.toThrow('Azure Speech synthesis failed (401 Unauthorized)');
  });
});
