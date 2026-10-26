/**
 * Azure unscripted speech adapter. The SDK is replaced at the module boundary,
 * so these tests prove how the adapter drives it and how it reads the result;
 * they say nothing about how the live service behaves.
 */
const mockSdk = {
  configs: [] as any[],
  assessments: [] as any[],
  formats: [] as any[],
  written: [] as ArrayBuffer[],
  closed: 0,
  startedContinuous: 0,
  /** Segment JSON emitted as RecognizedSpeech events, in order. */
  script: [] as string[],
  cancel: null as null | { errorCode: number; errorDetails: string },
  neverEnds: false,
};

jest.mock('microsoft-cognitiveservices-speech-sdk', () => {
  class PronunciationAssessmentConfig {
    enableProsodyAssessment = false;
    constructor(
      public referenceText: string,
      public gradingSystem: number,
      public granularity: number,
      public enableMiscue: boolean,
    ) {
      mockSdk.assessments.push(this);
    }
    applyTo(recognizer: any) {
      recognizer.assessment = this;
    }
  }
  class SpeechRecognizer {
    recognized: any;
    canceled: any;
    sessionStopped: any;
    assessment: any;
    constructor(
      public speechConfig: any,
      public audioConfig: any,
    ) {}
    startContinuousRecognitionAsync(ok: () => void) {
      mockSdk.startedContinuous += 1;
      ok();
      if (mockSdk.neverEnds) return;
      setImmediate(() => {
        for (const json of mockSdk.script)
          this.recognized(this, {
            result: {
              reason: 3,
              properties: {
                getProperty: (id: number) => (id === 23 ? json : ''),
              },
            },
          });
        if (mockSdk.cancel)
          this.canceled(this, { reason: 0, ...mockSdk.cancel });
        else this.sessionStopped(this, {});
      });
    }
    stopContinuousRecognitionAsync(ok: () => void) {
      ok();
    }
    close() {
      mockSdk.closed += 1;
    }
  }
  return {
    SpeechConfig: {
      fromSubscription: (key: string, region: string) => {
        const config = { key, region } as any;
        mockSdk.configs.push(config);
        return config;
      },
    },
    OutputFormat: { Detailed: 1 },
    AudioStreamFormat: {
      getWaveFormatPCM: (...args: number[]) => {
        mockSdk.formats.push(args);
        return { args };
      },
    },
    AudioInputStream: {
      createPushStream: () => ({
        write: (buffer: ArrayBuffer) => mockSdk.written.push(buffer),
        close: () => undefined,
      }),
    },
    AudioConfig: { fromStreamInput: (stream: unknown) => ({ stream }) },
    PronunciationAssessmentConfig,
    PronunciationAssessmentGradingSystem: { HundredMark: 2 },
    PronunciationAssessmentGranularity: { Word: 1 },
    SpeechRecognizer,
    ResultReason: { RecognizedSpeech: 3 },
    CancellationReason: { Error: 0, EndOfStream: 1 },
    CancellationErrorCode: {
      1: 'AuthenticationFailure',
      3: 'TooManyRequests',
      8: 'Forbidden',
    },
    PropertyId: { SpeechServiceResponse_JsonResult: 23 },
  };
});

import {
  aggregateSpeechEvidence,
  AzureUnscriptedSpeechAssessor,
  classifyAzureCancellation,
  createAzureRecognitionSession,
  extractPcmFromWav,
  MIN_RECOGNIZED_WORDS,
  redactProviderDetails,
} from './diagnostic-azure-speech';
import { DiagnosticGraderError } from './diagnostic-productive';

function wav(
  opts: {
    sampleRate?: number;
    channels?: number;
    bits?: number;
    format?: number;
    samples?: number;
    extraChunk?: boolean;
  } = {},
) {
  const sampleRate = opts.sampleRate ?? 16000;
  const channels = opts.channels ?? 1;
  const bits = opts.bits ?? 16;
  const data = Buffer.alloc((opts.samples ?? 1600) * channels * (bits / 8), 7);
  const fmt = Buffer.alloc(24);
  fmt.write('fmt ', 0, 'ascii');
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(opts.format ?? 1, 8);
  fmt.writeUInt16LE(channels, 10);
  fmt.writeUInt32LE(sampleRate, 12);
  fmt.writeUInt32LE((sampleRate * channels * bits) / 8, 16);
  fmt.writeUInt16LE((channels * bits) / 8, 20);
  fmt.writeUInt16LE(bits, 22);
  const list = Buffer.alloc(8 + 3 + 1);
  list.write('LIST', 0, 'ascii');
  list.writeUInt32LE(3, 4);
  const head = Buffer.alloc(8);
  head.write('data', 0, 'ascii');
  head.writeUInt32LE(data.length, 4);
  const body = Buffer.concat([
    fmt,
    ...(opts.extraChunk ? [list] : []),
    head,
    data,
  ]);
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(4 + body.length, 4);
  riff.write('WAVE', 8, 'ascii');
  return Buffer.concat([riff, body]);
}

const TICK = 10_000;
/** One Detailed-format segment; words are [startMs, durationMs, text]. */
function segment(
  words: Array<[number, number, string]>,
  scores: { acc: number; flu: number; pros?: number; pron: number },
  durationMs = words.length ? words[words.length - 1][0] + 500 : 1000,
) {
  const text = words.map((w) => w[2]).join(' ');
  return JSON.stringify({
    RecognitionStatus: 'Success',
    Duration: durationMs * TICK,
    DisplayText: `${text}.`,
    NBest: [
      {
        Display: `${text}.`,
        PronunciationAssessment: {
          AccuracyScore: scores.acc,
          FluencyScore: scores.flu,
          ...(scores.pros === undefined ? {} : { ProsodyScore: scores.pros }),
          PronScore: scores.pron,
        },
        Words: words.map(([start, duration, word]) => ({
          Word: word,
          Offset: start * TICK,
          Duration: duration * TICK,
          PronunciationAssessment: { AccuracyScore: scores.acc },
        })),
      },
    ],
  });
}

const sixWords: Array<[number, number, string]> = [
  [0, 300, 'I'],
  [400, 300, 'like'],
  [800, 300, 'the'],
  [1200, 300, 'park'],
  [3000, 300, 'near'],
  [3400, 300, 'home'],
];

const expectGraderError = (fn: () => unknown, kind: string, code: string) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DiagnosticGraderError);
    expect(error).toMatchObject({ kind, code });
    return;
  }
  throw new Error('expected a DiagnosticGraderError');
};

describe('extractPcmFromWav', () => {
  it('reads the PCM payload of a 16 kHz mono 16-bit WAV, skipping other chunks', () => {
    const pcm = extractPcmFromWav(wav({ extraChunk: true }));
    expect(pcm).toMatchObject({
      sampleRate: 16000,
      channels: 1,
      bitsPerSample: 16,
    });
    expect(pcm.data.length).toBe(3200);
  });

  it.each([
    ['not a RIFF file', Buffer.from('x'.repeat(64)), 'AUDIO_NOT_WAV'],
    ['8 kHz audio', wav({ sampleRate: 8000 }), 'AUDIO_FORMAT_UNSUPPORTED'],
    ['stereo audio', wav({ channels: 2 }), 'AUDIO_FORMAT_UNSUPPORTED'],
    ['8-bit audio', wav({ bits: 8 }), 'AUDIO_FORMAT_UNSUPPORTED'],
    ['float audio', wav({ format: 3 }), 'AUDIO_NOT_PCM'],
    ['an empty data chunk', wav({ samples: 0 }), 'AUDIO_EMPTY'],
  ])('refuses %s as a permanent failure', (_label, buffer, code) => {
    expectGraderError(() => extractPcmFromWav(buffer), 'PERMANENT', code);
  });
});

describe('aggregateSpeechEvidence', () => {
  it('builds transcript, timing and weighted Azure evidence', () => {
    const evidence = aggregateSpeechEvidence(
      [
        segment(
          sixWords.slice(0, 4),
          { acc: 90, flu: 80, pros: 70, pron: 85 },
          2000,
        ),
        segment(
          sixWords.slice(4),
          { acc: 60, flu: 40, pros: 50, pron: 55 },
          1000,
        ),
      ],
      45_000,
    );
    expect(evidence).toMatchObject({
      mode: 'UNSCRIPTED_CONTINUOUS',
      locale: 'en-US',
      transcript: 'I like the park. near home.',
      recognizedWordCount: 6,
      segmentCount: 2,
      recordingDurationMs: 45_000,
      speakingSpanMs: 3700,
      longPauseCount: 1,
      longestPauseMs: 1500,
    });
    // Accuracy and pronunciation by words (4:2), fluency and prosody by
    // segment duration (2000:1000).
    expect(evidence.azure.accuracy).toBe(80);
    expect(evidence.azure.pronunciation).toBe(75);
    expect(evidence.azure.fluency).toBe(66.7);
    expect(evidence.azure.prosody).toBe(63.3);
    expect(evidence.speechRateWpm).toBe(97.3);
  });

  it('reports prosody as unavailable when any segment lacks it', () => {
    const evidence = aggregateSpeechEvidence(
      [
        segment(sixWords.slice(0, 4), { acc: 90, flu: 80, pros: 70, pron: 85 }),
        segment(sixWords.slice(4), { acc: 60, flu: 40, pron: 55 }),
      ],
      10_000,
    );
    expect(evidence.azure.prosody).toBeNull();
  });

  it('ignores empty silent segments', () => {
    const silent = JSON.stringify({
      DisplayText: '',
      NBest: [{ Display: '', Words: [] }],
    });
    expect(
      aggregateSpeechEvidence(
        [silent, segment(sixWords, { acc: 80, flu: 80, pros: 80, pron: 80 })],
        10_000,
      ).segmentCount,
    ).toBe(1);
  });

  it('fails closed with too little speech to judge', () => {
    expectGraderError(
      () => aggregateSpeechEvidence([], 45_000),
      'INSUFFICIENT_EVIDENCE',
      'SPEECH_EVIDENCE_INSUFFICIENT',
    );
    expectGraderError(
      () =>
        aggregateSpeechEvidence(
          [
            segment(sixWords.slice(0, MIN_RECOGNIZED_WORDS - 1), {
              acc: 90,
              flu: 90,
              pron: 90,
            }),
          ],
          45_000,
        ),
      'INSUFFICIENT_EVIDENCE',
      'SPEECH_EVIDENCE_INSUFFICIENT',
    );
  });

  it('refuses a segment with a missing or non-finite score', () => {
    const missing = JSON.parse(
      segment(sixWords, { acc: 90, flu: 90, pron: 90 }),
    );
    delete missing.NBest[0].PronunciationAssessment.FluencyScore;
    expectGraderError(
      () => aggregateSpeechEvidence([JSON.stringify(missing)], 10_000),
      'TRANSIENT',
      'AZURE_RESPONSE_MISSING_SCORES',
    );
    const nan = JSON.parse(segment(sixWords, { acc: 90, flu: 90, pron: 90 }));
    nan.NBest[0].PronunciationAssessment.AccuracyScore = 'NaN';
    expectGraderError(
      () => aggregateSpeechEvidence([JSON.stringify(nan)], 10_000),
      'TRANSIENT',
      'AZURE_RESPONSE_MISSING_SCORES',
    );
  });

  it('refuses malformed JSON and words without timing', () => {
    expectGraderError(
      () => aggregateSpeechEvidence(['{not json'], 10_000),
      'TRANSIENT',
      'AZURE_RESPONSE_MALFORMED',
    );
    const untimed = JSON.parse(
      segment(sixWords, { acc: 90, flu: 90, pron: 90 }),
    );
    delete untimed.NBest[0].Words[2].Offset;
    expectGraderError(
      () => aggregateSpeechEvidence([JSON.stringify(untimed)], 10_000),
      'TRANSIENT',
      'AZURE_RESPONSE_MISSING_TIMING',
    );
  });
});

describe('classifyAzureCancellation', () => {
  it.each([
    ['AuthenticationFailure', 'PERMANENT'],
    ['Forbidden', 'PERMANENT'],
    ['BadRequestParameters', 'PERMANENT'],
    ['TooManyRequests', 'TRANSIENT'],
    ['ConnectionFailure', 'TRANSIENT'],
    ['ServiceTimeout', 'TRANSIENT'],
    ['ServiceError', 'TRANSIENT'],
    ['SomethingNew', 'TRANSIENT'],
  ])('%s is %s', (errorCode, kind) => {
    expect(classifyAzureCancellation({ errorCode, details: '' })).toMatchObject(
      {
        kind,
        code: `AZURE_${errorCode}`,
      },
    );
  });

  it('never carries a credential-like value into the failure message', () => {
    const secret = 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7';
    const error = classifyAzureCancellation({
      errorCode: 'AuthenticationFailure',
      details: `WebSocket upgrade failed: key=${secret} subscription: ${secret}`,
    });
    expect(error.message).not.toContain(secret);
    expect(
      redactProviderDetails(`Authorization: Bearer ${secret}`),
    ).not.toContain(secret);
  });
});

describe('createAzureRecognitionSession (SDK mocked)', () => {
  beforeEach(() => {
    mockSdk.configs = [];
    mockSdk.assessments = [];
    mockSdk.formats = [];
    mockSdk.written = [];
    mockSdk.closed = 0;
    mockSdk.startedContinuous = 0;
    mockSdk.script = [];
    mockSdk.cancel = null;
    mockSdk.neverEnds = false;
  });
  const assessor = (timeoutMs?: number) =>
    new AzureUnscriptedSpeechAssessor(
      createAzureRecognitionSession({ key: 'k', region: 'southeastasia' }),
      timeoutMs,
    );

  it('runs UNSCRIPTED continuous assessment: empty reference text, no miscue, prosody on, en-US, detailed output', async () => {
    mockSdk.script = [
      segment(sixWords, { acc: 80, flu: 70, pros: 60, pron: 75 }),
    ];
    const evidence = await assessor().assess(wav(), 45_000);
    expect(mockSdk.assessments).toHaveLength(1);
    expect(mockSdk.assessments[0]).toMatchObject({
      referenceText: '',
      gradingSystem: 2,
      granularity: 1,
      enableMiscue: false,
      enableProsodyAssessment: true,
    });
    expect(mockSdk.configs[0]).toMatchObject({
      speechRecognitionLanguage: 'en-US',
      outputFormat: 1,
    });
    expect(mockSdk.startedContinuous).toBe(1);
    expect(mockSdk.formats).toEqual([[16000, 16, 1]]);
    expect(mockSdk.written).toHaveLength(1);
    expect(mockSdk.written[0].byteLength).toBe(3200);
    expect(mockSdk.closed).toBe(1);
    expect(evidence.recognizedWordCount).toBe(6);
  });

  it('maps an authentication cancellation to a permanent failure', async () => {
    mockSdk.cancel = { errorCode: 1, errorDetails: 'bad key' };
    await expect(assessor().assess(wav(), 45_000)).rejects.toMatchObject({
      kind: 'PERMANENT',
      code: 'AZURE_AuthenticationFailure',
    });
    expect(mockSdk.closed).toBe(1);
  });

  it('maps throttling to a transient failure', async () => {
    mockSdk.cancel = { errorCode: 3, errorDetails: 'quota' };
    await expect(assessor().assess(wav(), 45_000)).rejects.toMatchObject({
      kind: 'TRANSIENT',
      code: 'AZURE_TooManyRequests',
    });
  });

  it('times out a session that never ends, as a transient failure, and closes it', async () => {
    mockSdk.neverEnds = true;
    await expect(assessor(20).assess(wav(), 45_000)).rejects.toMatchObject({
      kind: 'TRANSIENT',
      code: 'AZURE_TIMEOUT',
    });
    expect(mockSdk.closed).toBe(1);
  });

  it('fails as insufficient evidence when the service recognizes nothing', async () => {
    await expect(assessor().assess(wav(), 45_000)).rejects.toMatchObject({
      kind: 'INSUFFICIENT_EVIDENCE',
    });
  });

  it('refuses non-canonical audio before opening any session', async () => {
    await expect(
      assessor().assess(wav({ sampleRate: 44100 }), 45_000),
    ).rejects.toMatchObject({ kind: 'PERMANENT' });
    expect(mockSdk.configs).toHaveLength(0);
  });
});
