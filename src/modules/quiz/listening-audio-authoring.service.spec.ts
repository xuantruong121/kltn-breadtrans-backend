import {
  buildListeningSsml,
  escapeXml,
  resolveListeningVoice,
  resolveDeliveryStyle,
  resolveDeliveryRate,
  renderEmphasizedText,
  renderTextWithEndBookmark,
  sha256,
  stableJson,
  validateTimeline,
} from './listening-audio-authoring.service';
import { parseEncodedMp3DurationMs } from './listening-media-metadata';
import {
  normalizeDialogueSegments,
  withSpeakerTurnIds,
} from './listening-dialogue.contract';

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
    expect(resolveListeningVoice('Khách hàng', 'US')).toEqual({
      voiceKey: 'en-us-female-01',
      providerVoice: 'en-US-JennyNeural',
    });
    expect(resolveListeningVoice('Nhân viên hỗ trợ', 'US')).toEqual({
      voiceKey: 'en-us-male-01',
      providerVoice: 'en-US-GuyNeural',
    });
    expect(resolveListeningVoice('speaker-a', 'US', undefined, 0)).toEqual({
      voiceKey: 'en-us-female-01',
      providerVoice: 'en-US-JennyNeural',
    });
    expect(resolveListeningVoice('speaker-b', 'US', undefined, 1)).toEqual({
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

  it('keeps speaker turns separate from dictation chunks', () => {
    const chunks = withSpeakerTurnIds(
      normalizeDialogueSegments([
        { speakerId: 'maya', speaker: 'Maya', text: 'I have two points.' },
        { speakerId: 'maya', speaker: 'Maya', text: 'First, the timing.' },
        { speakerId: 'ben', speaker: 'Ben', text: 'I agree.' },
      ]),
    );
    expect(chunks[0].speakerTurnId).toBe(chunks[1].speakerTurnId);
    expect(chunks[0].speakerTurnId).not.toBe(chunks[2].speakerTurnId);
  });

  it('keeps consecutive chunks inside one provider voice block', () => {
    const payload = {
      schemaVersion: 'listening-audio.v2',
      quizId: 23,
      locale: 'en-US',
      accent: 'US',
      outputFormat: 'audio-16khz-128kbitrate-mono-mp3',
      voiceRegistryVersion: 'test',
      ssmlPolicyVersion: 'safe-ssml.v2',
      turns: [
        {
          turnId: 'chunk-001',
          speakerTurnId: 'speaker-turn-001',
          speakerId: 'maya',
          text: 'I have two points.',
          tone: 'NEUTRAL',
          rate: '0%',
          pauseMs: 220,
          voiceKey: 'en-us-female-01',
          providerVoice: 'en-US-JennyNeural',
        },
        {
          turnId: 'chunk-002',
          speakerTurnId: 'speaker-turn-001',
          speakerId: 'maya',
          text: 'First, the timing.',
          tone: 'NEUTRAL',
          rate: '0%',
          pauseMs: 220,
          voiceKey: 'en-us-female-01',
          providerVoice: 'en-US-JennyNeural',
        },
        {
          turnId: 'chunk-003',
          speakerTurnId: 'speaker-turn-002',
          speakerId: 'ben',
          text: 'I agree.',
          tone: 'NEUTRAL',
          rate: '0%',
          pauseMs: 220,
          voiceKey: 'en-us-male-01',
          providerVoice: 'en-US-GuyNeural',
        },
      ],
    };
    const ssml = buildListeningSsml(payload);
    expect((ssml.match(/<voice /g) ?? []).length).toBe(2);
    expect(ssml).toContain('<bookmark mark="chunk-002:start"/>');
  });

  it('maps domain delivery metadata to conservative deterministic prosody', () => {
    expect(resolveDeliveryRate('0%', 'URGENT')).toBe('+4%');
    expect(resolveDeliveryRate('0%', 'CALM')).toBe('-4%');
    expect(resolveDeliveryRate('0%', 'FRIENDLY_UPBEAT')).toBe('+3%');
    expect(resolveDeliveryRate('0%', 'THOUGHTFUL')).toBe('-3%');
    expect(resolveDeliveryRate('-2%', 'URGENT')).toBe('-2%');
  });

  it('emits only capability-safe expressive styles and restrained styledegree', () => {
    expect(resolveDeliveryStyle('en-US-JennyNeural', 'CONVERSATIONAL')).toEqual(
      {
        style: 'chat',
        styleDegree: 0.9,
      },
    );
    expect(resolveDeliveryStyle('en-US-GuyNeural', 'CONVERSATIONAL')).toEqual({
      style: 'friendly',
      styleDegree: 0.9,
    });
    expect(resolveDeliveryStyle('en-US-GuyNeural', 'FRIENDLY_UPBEAT')).toEqual({
      style: 'cheerful',
      styleDegree: 0.85,
    });
    expect(resolveDeliveryStyle('en-GB-SoniaNeural', 'CONVERSATIONAL')).toEqual(
      {},
    );
  });

  it('renders express-as for a turn without exposing unsupported styles', () => {
    const payload = {
      schemaVersion: 'listening-audio.v2',
      quizId: 23,
      locale: 'en-US',
      accent: 'US',
      outputFormat: 'audio-16khz-128kbitrate-mono-mp3',
      voiceRegistryVersion: 'test',
      ssmlPolicyVersion: 'safe-ssml.v2',
      turns: [
        {
          turnId: 'chunk-001',
          speakerTurnId: 'speaker-turn-001',
          speakerId: 'maya',
          text: 'Hello there.',
          tone: 'NEUTRAL',
          rate: '0%',
          pauseMs: 220,
          delivery: 'CONVERSATIONAL',
          voiceKey: 'en-us-female-01',
          providerVoice: 'en-US-JennyNeural',
        },
        {
          turnId: 'chunk-002',
          speakerTurnId: 'speaker-turn-002',
          speakerId: 'ben',
          text: 'I agree.',
          tone: 'NEUTRAL',
          rate: '0%',
          pauseMs: 220,
          delivery: 'CONVERSATIONAL',
          voiceKey: 'en-us-male-01',
          providerVoice: 'en-US-GuyNeural',
        },
      ],
    };
    const ssml = buildListeningSsml(payload);
    expect(ssml).toContain('style="chat" styledegree="0.9"');
    expect(ssml).toContain('style="friendly" styledegree="0.9"');
    expect(ssml).toContain('xmlns:mstts="https://www.w3.org/2001/mstts"');
  });

  it('allows word emphasis only for verified Guy voice and keeps Jenny plain', () => {
    const emphasis = [{ token: 'north', level: 'moderate' as const }];
    expect(
      renderEmphasizedText('The north entrance.', emphasis, 'en-US-GuyNeural'),
    ).toContain('<emphasis level="moderate">north</emphasis>');
    expect(
      renderEmphasizedText(
        'The north entrance.',
        emphasis,
        'en-US-JennyNeural',
      ),
    ).toBe('The north entrance.');
  });

  it('places end bookmarks before terminal punctuation for multi-voice reliability', () => {
    expect(
      renderTextWithEndBookmark(
        'Hello there.',
        undefined,
        'en-US-JennyNeural',
        'chunk-001:end',
      ),
    ).toBe('Hello there<bookmark mark="chunk-001:end"/>.');
  });
});
