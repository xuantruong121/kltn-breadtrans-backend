import {
  buildListeningSsml,
  escapeXml,
  resolveListeningVoice,
  sha256,
  stableJson,
  validateTimeline,
} from './listening-audio-authoring.service';
import { parseEncodedMp3DurationMs } from './listening-media-metadata';

describe('ListeningAudioAuthoring primitives', () => {
  it('escapes admin text before it reaches SSML', () => {
    expect(escapeXml(`A & <B> "C"`)).toBe('A &amp; &lt;B&gt; &quot;C&quot;');
  });

  it('serializes object keys deterministically for synthesis hashes', () => {
    expect(stableJson({ z: 1, a: { b: 2, a: 1 } })).toBe(
      '{"a":{"a":1,"b":2},"z":1}',
    );
    expect(sha256(stableJson({ a: 1 }))).toBe(sha256(stableJson({ a: 1 })));
    expect(sha256(stableJson({ a: 1 }))).not.toBe(sha256(stableJson({ a: 2 })));
  });

  it('accepts a monotonic authoritative timeline', () => {
    expect(() =>
      validateTimeline(
        [
          { turnId: 't1', startMs: 0, endMs: 900 },
          { turnId: 't2', startMs: 1100, endMs: 2100 },
        ],
        2200,
        ['t1', 't2'],
      ),
    ).not.toThrow();
  });

  it('rejects empty encoded media instead of inventing a duration', async () => {
    await expect(parseEncodedMp3DurationMs(Buffer.alloc(0))).rejects.toThrow(
      'Encoded audio is empty',
    );
  });

  it('rejects missing, reversed, or out-of-range timeline turns', () => {
    expect(() =>
      validateTimeline([{ turnId: 't1', startMs: 500, endMs: 400 }], 1000, [
        't1',
      ]),
    ).toThrow();
    expect(() =>
      validateTimeline([{ turnId: 't1', startMs: 0, endMs: 1200 }], 1000, [
        't1',
      ]),
    ).toThrow();
    expect(() =>
      validateTimeline([{ turnId: 'wrong', startMs: 0, endMs: 100 }], 1000, [
        't1',
      ]),
    ).toThrow();
    expect(() =>
      validateTimeline(
        [
          { turnId: 't1', startMs: 0, endMs: 100 },
          { turnId: 't1', startMs: 100, endMs: 200 },
        ],
        300,
        ['t1', 't2'],
      ),
    ).toThrow();
  });

  it('maps explicit participant roles to distinct provider voices', () => {
    expect(resolveListeningVoice('maya', 'US', 'female-01')).toEqual({
      voiceKey: 'en-us-female-01',
      providerVoice: 'en-US-JennyNeural',
    });
    expect(resolveListeningVoice('ben', 'US', 'male-01')).toEqual({
      voiceKey: 'en-us-male-01',
      providerVoice: 'en-US-GuyNeural',
    });
  });

  it('builds multi-voice SSML in turn order and voice changes affect the hash', () => {
    const base = {
      schemaVersion: 'listening-audio.v1',
      quizId: 24,
      locale: 'en-US',
      accent: 'US',
      outputFormat: 'audio-16khz-128kbitrate-mono-mp3',
      voiceRegistryVersion: 'test',
      ssmlPolicyVersion: 'safe-ssml.v1',
      turns: [
        {
          turnId: 'turn-001',
          speakerId: 'maya',
          text: 'Hello',
          tone: 'NEUTRAL',
          rate: '0%',
          pauseMs: 260,
          voiceKey: 'en-us-female-01',
          providerVoice: 'en-US-JennyNeural',
        },
        {
          turnId: 'turn-002',
          speakerId: 'ben',
          text: 'Hi',
          tone: 'NEUTRAL',
          rate: '0%',
          pauseMs: 260,
          voiceKey: 'en-us-male-01',
          providerVoice: 'en-US-GuyNeural',
        },
        {
          turnId: 'turn-003',
          speakerId: 'maya',
          text: 'Goodbye',
          tone: 'NEUTRAL',
          rate: '0%',
          pauseMs: 260,
          voiceKey: 'en-us-female-01',
          providerVoice: 'en-US-JennyNeural',
        },
      ],
    };
    const ssml = buildListeningSsml(base);
    expect(ssml.indexOf('en-US-JennyNeural')).toBeLessThan(
      ssml.indexOf('en-US-GuyNeural'),
    );
    expect(ssml).toContain('<bookmark mark="turn-002:start"/>');
    expect(sha256(stableJson(base))).not.toBe(
      sha256(
        stableJson({
          ...base,
          turns: base.turns.map((turn, index) =>
            index === 1
              ? { ...turn, providerVoice: 'en-US-JennyNeural' }
              : turn,
          ),
        }),
      ),
    );
  });
});
