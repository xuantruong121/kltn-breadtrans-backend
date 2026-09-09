import { BadRequestException } from '@nestjs/common';

export interface AudioQualityMetrics {
  durationMs: number;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  rmsDb: number;
  peakDb: number;
  clippingRatio: number;
  isSilent: boolean;
}

export interface AudioValidationResult {
  isValid: boolean;
  durationMs: number;
  audioMimeType: string;
  quality: AudioQualityMetrics;
}

const MAX_AUDIO_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_DURATION_MS = 45 * 1000; // 45 seconds
const MIN_DURATION_MS = 300; // 300ms minimum to prevent empty taps

/**
 * Validates audio bytes strictly according to Phase 3.3 rules:
 * - Non-empty payload, max 10MB
 * - RIFF/WAVE header
 * - PCM format (tag 1)
 * - Mono channel (1)
 * - 16,000 Hz sample rate
 * - 16-bit depth
 * - Valid data chunk with duration <= 45 seconds
 * - Non-silent audio content
 */
export function validateSpeakingAudio(
  buffer: Buffer,
  declaredMimeType?: string,
): AudioValidationResult {
  if (!buffer || buffer.length === 0) {
    throw new BadRequestException('Audio file is empty');
  }

  if (buffer.length > MAX_AUDIO_BYTES) {
    throw new BadRequestException(
      `Audio file exceeds maximum size limit of ${MAX_AUDIO_BYTES / (1024 * 1024)}MB`,
    );
  }

  if (buffer.length < 44) {
    throw new BadRequestException('Invalid audio file: incomplete WAV header');
  }

  // Validate declared MIME if provided
  if (declaredMimeType) {
    const validMimes = [
      'audio/wav',
      'audio/x-wav',
      'audio/wave',
      'audio/vnd.wave',
      'application/octet-stream',
    ];
    if (!validMimes.includes(declaredMimeType.toLowerCase())) {
      throw new BadRequestException(
        `Unsupported audio MIME type: ${declaredMimeType}. Only 16kHz mono PCM WAV is supported.`,
      );
    }
  }

  // Byte-level RIFF / WAVE verification
  const riff = buffer.toString('ascii', 0, 4);
  const wave = buffer.toString('ascii', 8, 12);
  if (riff !== 'RIFF' || wave !== 'WAVE') {
    throw new BadRequestException(
      'Invalid audio file format: magic bytes must be RIFF/WAVE',
    );
  }

  // Parse RIFF chunks
  let offset = 12;
  let hasFmt = false;
  let hasData = false;

  let audioFormat = 0;
  let numChannels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataChunkOffset = 0;
  let dataChunkSize = 0;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    offset += 8;

    if (chunkId === 'fmt ') {
      hasFmt = true;
      if (chunkSize < 16 || offset + 16 > buffer.length) {
        throw new BadRequestException('Invalid WAV: malformed fmt chunk');
      }
      audioFormat = buffer.readUInt16LE(offset);
      numChannels = buffer.readUInt16LE(offset + 2);
      sampleRate = buffer.readUInt32LE(offset + 4);
      bitsPerSample = buffer.readUInt16LE(offset + 14);
    } else if (chunkId === 'data') {
      hasData = true;
      dataChunkOffset = offset;
      dataChunkSize = chunkSize;
    }

    // Skip chunk payload (padded to even byte boundary per RIFF spec)
    offset += chunkSize;
    if (chunkSize % 2 === 1) {
      offset += 1;
    }
  }

  if (!hasFmt) {
    throw new BadRequestException('Invalid WAV: missing fmt chunk');
  }

  if (audioFormat !== 1) {
    throw new BadRequestException(
      `Audio must be linear PCM (expected format tag 1, received ${audioFormat})`,
    );
  }

  if (numChannels !== 1) {
    throw new BadRequestException(
      `Audio must be mono (1 channel). Received ${numChannels} channels.`,
    );
  }

  if (sampleRate !== 16000) {
    throw new BadRequestException(
      `Audio sample rate must be exactly 16000 Hz. Received ${sampleRate} Hz.`,
    );
  }

  if (bitsPerSample !== 16) {
    throw new BadRequestException(
      `Audio bit depth must be 16-bit PCM. Received ${bitsPerSample}-bit.`,
    );
  }

  if (!hasData || dataChunkSize <= 0) {
    throw new BadRequestException(
      'Invalid WAV: missing or empty audio data chunk',
    );
  }

  // Calculate actual duration
  const bytesPerSecond = sampleRate * numChannels * (bitsPerSample / 8); // 32,000 bytes/sec
  const availableData = Math.min(
    dataChunkSize,
    buffer.length - dataChunkOffset,
  );
  const durationMs = Math.round((availableData / bytesPerSecond) * 1000);

  if (durationMs > MAX_DURATION_MS) {
    throw new BadRequestException(
      `Audio duration (${(durationMs / 1000).toFixed(1)}s) exceeds maximum allowed duration of ${MAX_DURATION_MS / 1000} seconds`,
    );
  }

  if (durationMs < MIN_DURATION_MS) {
    throw new BadRequestException(
      `Audio duration is too short (${durationMs}ms). Please speak the sentence clearly.`,
    );
  }

  // Quality metrics analysis: RMS, peak amplitude, clipping, silence
  const sampleCount = Math.floor(availableData / 2);
  let sumSquare = 0;
  let peak = 0;
  let clippingCount = 0;

  for (let i = 0; i < sampleCount; i++) {
    const sample = buffer.readInt16LE(dataChunkOffset + i * 2);
    const normalized = sample / 32768.0;
    const absSample = Math.abs(normalized);
    sumSquare += normalized * normalized;
    if (absSample > peak) {
      peak = absSample;
    }
    if (absSample >= 0.99) {
      clippingCount++;
    }
  }

  const rms = Math.sqrt(sumSquare / (sampleCount || 1));
  const clippingRatio = clippingCount / (sampleCount || 1);
  const rmsDb = rms > 1e-7 ? Number((20 * Math.log10(rms)).toFixed(2)) : -100;
  const peakDb =
    peak > 1e-7 ? Number((20 * Math.log10(peak)).toFixed(2)) : -100;

  // Detect silence: virtually flat line or zero amplitude
  const isSilent = peak < 0.001 || rms < 0.0003;

  return {
    isValid: true,
    durationMs,
    audioMimeType: 'audio/wav',
    quality: {
      durationMs,
      sampleRate,
      channels: numChannels,
      bitsPerSample,
      rmsDb,
      peakDb,
      clippingRatio: Number(clippingRatio.toFixed(4)),
      isSilent,
    },
  };
}

/**
 * Helper to construct PCM WAV buffers for testing and synthesis.
 */
export function createWavBuffer(options?: {
  sampleRate?: number;
  channels?: number;
  bitsPerSample?: number;
  durationSeconds?: number;
  silent?: boolean;
  amplitude?: number;
}): Buffer {
  const sampleRate = options?.sampleRate ?? 16000;
  const channels = options?.channels ?? 1;
  const bitsPerSample = options?.bitsPerSample ?? 16;
  const durationSeconds = options?.durationSeconds ?? 1;
  const silent = options?.silent ?? false;
  const amplitude = options?.amplitude ?? 0.5;

  const totalSamples = Math.floor(sampleRate * durationSeconds);
  const bytesPerSample = bitsPerSample / 8;
  const dataSize = totalSamples * channels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  if (!silent) {
    if (bitsPerSample === 16) {
      for (let i = 0; i < totalSamples * channels; i++) {
        const val = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * amplitude;
        const intVal = Math.floor(val * 32767);
        buffer.writeInt16LE(
          Math.max(-32768, Math.min(32767, intVal)),
          44 + i * 2,
        );
      }
    } else if (bitsPerSample === 8) {
      for (let i = 0; i < totalSamples * channels; i++) {
        const val = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * amplitude;
        const intVal = Math.floor((val + 1) * 127.5);
        buffer.writeUInt8(Math.max(0, Math.min(255, intVal)), 44 + i);
      }
    }
  }

  return buffer;
}
