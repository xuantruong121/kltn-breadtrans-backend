/**
 * Azure Speech evidence for Entry Diagnostic Speaking tasks.
 *
 * The tasks are free 45-60 second answers, so this uses UNSCRIPTED
 * pronunciation assessment: no reference text is set, and recognition runs in
 * continuous mode because the service documents single-shot recognition as
 * unsuitable beyond 30 seconds. The task prompt is never sent as a reference
 * text; doing so scored whether the learner read the prompt aloud.
 *
 * Azure output is EVIDENCE for the rubric grader, not a rubric score. No
 * formula turns an Azure number into a 0-4 criterion score.
 *
 * Known limitation, from the service documentation: unscripted assessment uses
 * a speech-to-text model that differs from standard Azure STT. The documented
 * route to a more accurate transcript is a two-pass flow (standard STT, then
 * scripted assessment against that transcript). This module implements the
 * single unscripted pass; the two-pass flow is the upgrade path if live
 * validation finds the transcript unreliable.
 *
 * Everything except `createAzureRecognitionSession` is pure, so parsing,
 * aggregation and error classification are tested without the network.
 */
import * as sdk from 'microsoft-cognitiveservices-speech-sdk';

import { DiagnosticGraderError } from './diagnostic-productive';

export const AZURE_SPEECH_LOCALE = 'en-US';
export const AZURE_EXPECTED_SAMPLE_RATE = 16000;
/** A pause between words at least this long is counted as a long pause. */
export const LONG_PAUSE_MS = 1000;
/**
 * Fewer recognized words than this is not enough to judge intelligibility,
 * fluency or language use, so the task fails instead of being scored.
 */
export const MIN_RECOGNIZED_WORDS = 5;
/** Recognition of a 60 s clip normally finishes well inside this. */
export const AZURE_RECOGNITION_TIMEOUT_MS = 90_000;

// ------------------------------------------------------------------ audio

export type PcmAudio = {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  data: Buffer;
};

/** Read the PCM payload of a canonical WAV, refusing any other format. */
export function extractPcmFromWav(wav: Buffer): PcmAudio {
  if (
    wav.length < 44 ||
    wav.toString('ascii', 0, 4) !== 'RIFF' ||
    wav.toString('ascii', 8, 12) !== 'WAVE'
  )
    throw new DiagnosticGraderError('PERMANENT', 'AUDIO_NOT_WAV');
  let offset = 12;
  let format: Omit<PcmAudio, 'data'> | null = null;
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      if (wav.readUInt16LE(body) !== 1)
        throw new DiagnosticGraderError('PERMANENT', 'AUDIO_NOT_PCM');
      format = {
        channels: wav.readUInt16LE(body + 2),
        sampleRate: wav.readUInt32LE(body + 4),
        bitsPerSample: wav.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      if (!format)
        throw new DiagnosticGraderError('PERMANENT', 'AUDIO_WAV_NO_FORMAT');
      if (
        format.sampleRate !== AZURE_EXPECTED_SAMPLE_RATE ||
        format.channels !== 1 ||
        format.bitsPerSample !== 16
      )
        throw new DiagnosticGraderError(
          'PERMANENT',
          'AUDIO_FORMAT_UNSUPPORTED',
          `${format.sampleRate} Hz, ${format.channels} ch, ${format.bitsPerSample} bit`,
        );
      const data = wav.subarray(body, Math.min(wav.length, body + size));
      if (data.length === 0)
        throw new DiagnosticGraderError('PERMANENT', 'AUDIO_EMPTY');
      return { ...format, data };
    }
    offset = body + size + (size % 2);
  }
  throw new DiagnosticGraderError('PERMANENT', 'AUDIO_WAV_NO_DATA');
}

// ------------------------------------------------------------- evidence

export type SpeechEvidence = {
  locale: string;
  mode: 'UNSCRIPTED_CONTINUOUS';
  transcript: string;
  recognizedWordCount: number;
  segmentCount: number;
  recordingDurationMs: number;
  /** First recognized word start to last recognized word end. */
  speakingSpanMs: number;
  speechRateWpm: number;
  longPauseCount: number;
  longestPauseMs: number;
  /** Azure 0-100 scores, aggregated over segments. Evidence only. */
  azure: {
    accuracy: number;
    fluency: number;
    prosody: number | null;
    pronunciation: number;
  };
};

type AzureWord = { Word?: unknown; Offset?: unknown; Duration?: unknown };

type ParsedSegment = {
  text: string;
  durationTicks: number;
  words: Array<{ startMs: number; endMs: number }>;
  accuracy: number;
  fluency: number;
  prosody: number | null;
  pronunciation: number;
};

const TICKS_PER_MS = 10_000;

function finiteScore(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Parse one recognized-segment JSON from the Detailed output format. */
export function parseRecognizedSegment(json: string): ParsedSegment | null {
  let value: any;
  try {
    value = JSON.parse(json);
  } catch {
    throw new DiagnosticGraderError(
      'TRANSIENT',
      'AZURE_RESPONSE_MALFORMED',
      'segment is not JSON',
    );
  }
  const best = Array.isArray(value?.NBest) ? value.NBest[0] : null;
  const text = String(best?.Display ?? value?.DisplayText ?? '').trim();
  const rawWords: AzureWord[] = Array.isArray(best?.Words) ? best.Words : [];
  // A silent stretch can produce an empty segment; it carries no evidence.
  if (!text && rawWords.length === 0) return null;
  const assessment = best?.PronunciationAssessment ?? {};
  const accuracy = finiteScore(assessment.AccuracyScore);
  const fluency = finiteScore(assessment.FluencyScore);
  const pronunciation = finiteScore(assessment.PronScore);
  if (accuracy === null || fluency === null || pronunciation === null)
    throw new DiagnosticGraderError(
      'TRANSIENT',
      'AZURE_RESPONSE_MISSING_SCORES',
    );
  const words = rawWords.map((word) => {
    const offset = Number(word.Offset);
    const duration = Number(word.Duration);
    if (!Number.isFinite(offset) || !Number.isFinite(duration))
      throw new DiagnosticGraderError(
        'TRANSIENT',
        'AZURE_RESPONSE_MISSING_TIMING',
      );
    return {
      startMs: offset / TICKS_PER_MS,
      endMs: (offset + duration) / TICKS_PER_MS,
    };
  });
  return {
    text,
    durationTicks: Number.isFinite(Number(value?.Duration))
      ? Number(value.Duration)
      : 0,
    words,
    accuracy,
    fluency,
    prosody: finiteScore(assessment.ProsodyScore),
    pronunciation,
  };
}

function weightedMean(pairs: Array<[number, number]>): number {
  const weight = pairs.reduce((sum, [, w]) => sum + w, 0);
  if (weight <= 0) return pairs.reduce((s, [v]) => s + v, 0) / pairs.length;
  return pairs.reduce((sum, [v, w]) => sum + v * w, 0) / weight;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * Combine segment results into one evidence record. Accuracy and overall
 * pronunciation are weighted by words, fluency and prosody by segment
 * duration, so a short trailing fragment cannot dominate either. Fails closed
 * when there is too little speech to judge.
 */
export function aggregateSpeechEvidence(
  segmentJson: string[],
  recordingDurationMs: number,
): SpeechEvidence {
  const segments = segmentJson
    .map(parseRecognizedSegment)
    .filter((s): s is ParsedSegment => s !== null);
  const words = segments.flatMap((s) => s.words);
  if (segments.length === 0 || words.length < MIN_RECOGNIZED_WORDS)
    throw new DiagnosticGraderError(
      'INSUFFICIENT_EVIDENCE',
      'SPEECH_EVIDENCE_INSUFFICIENT',
      `${words.length} word(s) recognized; at least ${MIN_RECOGNIZED_WORDS} required`,
    );

  const ordered = [...words].sort((a, b) => a.startMs - b.startMs);
  let longPauseCount = 0;
  let longestPauseMs = 0;
  for (let i = 1; i < ordered.length; i += 1) {
    const gap = ordered[i].startMs - ordered[i - 1].endMs;
    if (gap > longestPauseMs) longestPauseMs = gap;
    if (gap >= LONG_PAUSE_MS) longPauseCount += 1;
  }
  const speakingSpanMs = Math.max(
    0,
    ordered[ordered.length - 1].endMs - ordered[0].startMs,
  );
  const prosodySegments = segments.filter((s) => s.prosody !== null);

  return {
    locale: AZURE_SPEECH_LOCALE,
    mode: 'UNSCRIPTED_CONTINUOUS',
    transcript: segments
      .map((s) => s.text)
      .join(' ')
      .trim(),
    recognizedWordCount: words.length,
    segmentCount: segments.length,
    recordingDurationMs,
    speakingSpanMs: Math.round(speakingSpanMs),
    speechRateWpm:
      speakingSpanMs > 0 ? round1(words.length / (speakingSpanMs / 60000)) : 0,
    longPauseCount,
    longestPauseMs: Math.round(longestPauseMs),
    azure: {
      accuracy: round1(
        weightedMean(segments.map((s) => [s.accuracy, s.words.length])),
      ),
      fluency: round1(
        weightedMean(segments.map((s) => [s.fluency, s.durationTicks])),
      ),
      // Prosody is reported only when every segment carried it; a partial
      // figure would describe part of the answer as if it were all of it.
      prosody:
        prosodySegments.length === segments.length
          ? round1(
              weightedMean(
                segments.map((s) => [s.prosody as number, s.durationTicks]),
              ),
            )
          : null,
      pronunciation: round1(
        weightedMean(segments.map((s) => [s.pronunciation, s.words.length])),
      ),
    },
  };
}

// --------------------------------------------------------- failure mapping

export type AzureCancellation = {
  errorCode: string;
  details: string;
};

const PERMANENT_AZURE_CODES = new Set([
  'AuthenticationFailure',
  'Forbidden',
  'BadRequestParameters',
]);

/** Remove anything that looks like a credential before it reaches a log. */
export function redactProviderDetails(details: string): string {
  return details
    .replace(
      /(key|token|authorization|subscription)[^\s,;]*[=:]\s*\S+/gi,
      '$1=[redacted]',
    )
    .replace(/[A-Za-z0-9]{32,}/g, '[redacted]')
    .slice(0, 200);
}

/**
 * Credentials and request shape do not fix themselves, so they fail the task
 * at once. Throttling, connectivity and service faults may, so they are
 * retried once: TooManyRequests, ConnectionFailure, ServiceTimeout,
 * ServiceError, RuntimeError, and any code not listed as permanent.
 */
export function classifyAzureCancellation(
  cancellation: AzureCancellation,
): DiagnosticGraderError {
  return new DiagnosticGraderError(
    PERMANENT_AZURE_CODES.has(cancellation.errorCode)
      ? 'PERMANENT'
      : 'TRANSIENT',
    `AZURE_${cancellation.errorCode || 'UNKNOWN'}`,
    redactProviderDetails(cancellation.details),
  );
}

// ------------------------------------------------------------- transport

export type RecognitionOutcome = {
  /** SpeechServiceResponse_JsonResult of every RecognizedSpeech event. */
  segments: string[];
  /** Set when the session ended on an error rather than end of stream. */
  cancellation?: AzureCancellation;
};

/** The network seam. Tests replace it; production uses the Azure SDK. */
export type RecognitionSession = (
  pcm: PcmAudio,
  options: { timeoutMs: number },
) => Promise<RecognitionOutcome>;

export type AzureSpeechCredentials = { key: string; region: string };

/**
 * One continuous unscripted pronunciation-assessment session over a push
 * stream. NOT exercised against the live service in C3.
 */
export function createAzureRecognitionSession(
  credentials: AzureSpeechCredentials,
): RecognitionSession {
  return (pcm, { timeoutMs }) =>
    new Promise<RecognitionOutcome>((resolve, reject) => {
      const speechConfig = sdk.SpeechConfig.fromSubscription(
        credentials.key,
        credentials.region,
      );
      speechConfig.speechRecognitionLanguage = AZURE_SPEECH_LOCALE;
      speechConfig.outputFormat = sdk.OutputFormat.Detailed;
      const stream = sdk.AudioInputStream.createPushStream(
        sdk.AudioStreamFormat.getWaveFormatPCM(
          pcm.sampleRate,
          pcm.bitsPerSample,
          pcm.channels,
        ),
      );
      const recognizer = new sdk.SpeechRecognizer(
        speechConfig,
        sdk.AudioConfig.fromStreamInput(stream),
      );
      // Empty reference text = unscripted. Miscue needs a reference text.
      const assessment = new sdk.PronunciationAssessmentConfig(
        '',
        sdk.PronunciationAssessmentGradingSystem.HundredMark,
        sdk.PronunciationAssessmentGranularity.Word,
        false,
      );
      assessment.enableProsodyAssessment = true;
      assessment.applyTo(recognizer);

      const segments: string[] = [];
      let settled = false;
      const finish = (outcome: RecognitionOutcome | Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        recognizer.stopContinuousRecognitionAsync(
          () => recognizer.close(),
          () => recognizer.close(),
        );
        if (outcome instanceof Error) reject(outcome);
        else resolve(outcome);
      };
      const timer = setTimeout(
        () =>
          finish(
            new DiagnosticGraderError(
              'TRANSIENT',
              'AZURE_TIMEOUT',
              `no end of stream within ${timeoutMs} ms`,
            ),
          ),
        timeoutMs,
      );

      recognizer.recognized = (_sender, event) => {
        if (event.result.reason === sdk.ResultReason.RecognizedSpeech)
          segments.push(
            event.result.properties.getProperty(
              sdk.PropertyId.SpeechServiceResponse_JsonResult,
            ),
          );
      };
      recognizer.canceled = (_sender, event) => {
        if (event.reason === sdk.CancellationReason.Error)
          finish({
            segments,
            cancellation: {
              errorCode: sdk.CancellationErrorCode[event.errorCode],
              details: event.errorDetails ?? '',
            },
          });
        else finish({ segments });
      };
      recognizer.sessionStopped = () => finish({ segments });

      recognizer.startContinuousRecognitionAsync(
        () => {
          // Copy into a plain ArrayBuffer; the SDK does not take a view.
          stream.write(new Uint8Array(pcm.data).buffer);
          stream.close();
        },
        (error) =>
          finish(
            new DiagnosticGraderError(
              'TRANSIENT',
              'AZURE_START_FAILED',
              redactProviderDetails(String(error)),
            ),
          ),
      );
    });
}

/** Turn a normalized WAV into speech evidence, failing closed throughout. */
export class AzureUnscriptedSpeechAssessor {
  constructor(
    private readonly session: RecognitionSession,
    private readonly timeoutMs = AZURE_RECOGNITION_TIMEOUT_MS,
  ) {}

  async assess(wav: Buffer, recordingDurationMs: number) {
    const pcm = extractPcmFromWav(wav);
    const outcome = await this.session(pcm, { timeoutMs: this.timeoutMs });
    if (outcome.cancellation)
      throw classifyAzureCancellation(outcome.cancellation);
    return aggregateSpeechEvidence(outcome.segments, recordingDurationMs);
  }
}
