import {
  buildToeicListeningSsml,
  normalizeAzureSpeechResponse,
} from './ai.service';

describe('Azure Speech SSML authoring', () => {
  // Exams 1 and 3 store every Part 3 turn on one line; one voice used to read
  // the whole dialogue, "W:" included.
  it('gives each speaker of a one-line dialogue its own voice, without labels', () => {
    const ssml = buildToeicListeningSsml(
      'W: Good morning, I would like to book a table. M: Certainly, for how many people? W: Four, at 7:30 tonight.\n\nWhat does the woman want to do?',
    );
    const voices = [...ssml.matchAll(/<voice name="([^"]+)">([^<]*)/g)];
    const bySpeaker = voices.map(([, voice, text]) => [voice, text.trim()]);
    expect(bySpeaker.slice(0, 3)).toEqual([
      ['en-US-JennyNeural', 'Good morning, I would like to book a table.'],
      ['en-US-GuyNeural', 'Certainly, for how many people?'],
      ['en-US-JennyNeural', 'Four, at 7:30 tonight.'],
    ]);
    expect(ssml).not.toMatch(/>\s*[MW]:/);
  });

  it('includes the required synthesis namespace and escapes transcript text', () => {
    const ssml = buildToeicListeningSsml(
      'Narrator: Read <this> & say "hello".',
    );

    expect(ssml).toContain('xmlns="http://www.w3.org/2001/10/synthesis"');
    expect(ssml).toContain('Read &lt;this&gt; &amp; say &quot;hello&quot;.');
    expect(ssml).not.toContain('<break');
  });

  it('speaks a TOEIC option letter as a character name, never a narrated label word', () => {
    const ssml = buildToeicListeningSsml(
      'Where will the meeting be held?\n\nA. In the main hall.\n\nB. Near the lobby.',
    );

    expect(ssml).toContain(
      '<say-as interpret-as="characters">A</say-as>. In the main hall.',
    );
    expect(ssml).toContain(
      '<say-as interpret-as="characters">B</say-as>. Near the lobby.',
    );
    expect(ssml).not.toContain('Statement');
    expect(ssml).not.toContain('Response');
    expect(ssml).not.toContain('Option');
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
