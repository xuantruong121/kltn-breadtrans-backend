import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import ffmpegPath from 'ffmpeg-static';

const execFileAsync = promisify(execFile);

const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;
const NORMALIZATION_TIMEOUT_MS = 15_000;
const SUPPORTED_MIME = new Set([
  'audio/wav',
  'audio/x-wav',
  'audio/webm',
  'audio/webm;codecs=opus',
  'audio/ogg',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/mpeg',
]);

export type NormalizedDiagnosticAudio = {
  buffer: Buffer;
  inputMime: string;
  inputBytes: number;
  decodedInputCodec: string | null;
  decodedInputSampleRate: number | null;
  decodedInputChannels: number | null;
  normalizedMime: 'audio/wav';
  normalizedCodec: 'pcm_s16le';
  normalizedSampleRate: 16000;
  normalizedChannels: 1;
  normalizedPcmBits: 16;
  normalizedBytes: number;
  durationMs: number;
  normalizationDurationMs: number;
};

type WavMetadata = {
  codec: 'pcm_s16le';
  sampleRate: 16000;
  channels: 1;
  pcmBits: 16;
  dataBytes: number;
  durationMs: number;
};

@Injectable()
export class DiagnosticSpeakingAudioNormalizer {
  private readonly logger = new Logger(DiagnosticSpeakingAudioNormalizer.name);

  async normalize(
    input: Buffer,
    declaredMime: string,
  ): Promise<NormalizedDiagnosticAudio> {
    const startedAt = Date.now();
    const inputMime = (declaredMime || '').split(';')[0].trim().toLowerCase();
    if (!input.length || input.length > MAX_INPUT_BYTES) {
      throw new Error('Bản ghi âm vượt giới hạn kích thước');
    }
    if (
      ![...SUPPORTED_MIME].some(
        (mime) =>
          inputMime === mime ||
          declaredMime.toLowerCase().startsWith(`${mime};`),
      )
    ) {
      throw new Error('Định dạng bản ghi âm không được hỗ trợ');
    }
    if (!ffmpegPath || !existsSync(ffmpegPath))
      throw new Error('Bộ chuẩn hóa âm thanh chưa được cấu hình');

    const workDir = await mkdtemp(
      join(tmpdir(), 'breadtrans-diagnostic-audio-'),
    );
    const inputPath = join(
      workDir,
      `${randomUUID()}${this.extensionForMime(inputMime)}`,
    );
    const outputPath = join(workDir, `${randomUUID()}.wav`);
    try {
      await writeFile(inputPath, input, { flag: 'wx' });
      const { stderr } = await execFileAsync(
        ffmpegPath,
        [
          '-hide_banner',
          '-loglevel',
          'info',
          '-nostdin',
          '-y',
          '-i',
          inputPath,
          '-vn',
          '-ac',
          '1',
          '-ar',
          '16000',
          '-sample_fmt',
          's16',
          '-c:a',
          'pcm_s16le',
          '-f',
          'wav',
          outputPath,
        ],
        {
          timeout: NORMALIZATION_TIMEOUT_MS,
          maxBuffer: 1024 * 1024,
          windowsHide: true,
        },
      );
      const normalized = await readFile(outputPath);
      if (normalized.length > MAX_OUTPUT_BYTES) {
        throw new Error('Âm thanh sau chuẩn hóa vượt giới hạn kích thước');
      }
      const wav = this.readCanonicalWav(normalized);
      const inputMetadata = this.parseInputMetadata(stderr);
      const result: NormalizedDiagnosticAudio = {
        buffer: normalized,
        inputMime: declaredMime || inputMime,
        inputBytes: input.length,
        decodedInputCodec: inputMetadata.codec,
        decodedInputSampleRate: inputMetadata.sampleRate,
        decodedInputChannels: inputMetadata.channels,
        normalizedMime: 'audio/wav',
        normalizedCodec: wav.codec,
        normalizedSampleRate: wav.sampleRate,
        normalizedChannels: wav.channels,
        normalizedPcmBits: wav.pcmBits,
        normalizedBytes: normalized.length,
        durationMs: wav.durationMs,
        normalizationDurationMs: Date.now() - startedAt,
      };
      this.logger.log(
        JSON.stringify({
          event: 'diagnostic_speaking_audio_normalized',
          inputMime: result.inputMime,
          inputBytes: result.inputBytes,
          decodedInputCodec: result.decodedInputCodec,
          decodedInputSampleRate: result.decodedInputSampleRate,
          decodedInputChannels: result.decodedInputChannels,
          normalizedMime: result.normalizedMime,
          normalizedCodec: result.normalizedCodec,
          normalizedBytes: result.normalizedBytes,
          normalizedSampleRate: result.normalizedSampleRate,
          normalizedChannels: result.normalizedChannels,
          normalizedPcmBits: result.normalizedPcmBits,
          durationMs: result.durationMs,
          normalizationDurationMs: result.normalizationDurationMs,
        }),
      );
      return result;
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }

  private extensionForMime(mime: string): string {
    if (mime.includes('wav')) return '.wav';
    if (mime.includes('ogg')) return '.ogg';
    if (mime.includes('mp4')) return '.m4a';
    if (mime.includes('mpeg')) return '.mp3';
    return '.webm';
  }

  private parseInputMetadata(stderr: string): {
    codec: string | null;
    sampleRate: number | null;
    channels: number | null;
  } {
    const match = stderr.match(
      /Audio:\s*([^,\s]+),.*?(\d+)\s*Hz,\s*([^\r\n]+)/i,
    );
    if (!match) return { codec: null, sampleRate: null, channels: null };
    const channelText = match[3].toLowerCase();
    const channels = channelText.includes('mono')
      ? 1
      : channelText.includes('stereo')
        ? 2
        : null;
    return {
      codec: match[1] || null,
      sampleRate: Number(match[2]) || null,
      channels,
    };
  }

  private readCanonicalWav(buffer: Buffer): WavMetadata {
    if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF') {
      throw new Error('Đầu ra chuẩn hóa không phải WAV RIFF hợp lệ');
    }
    let offset = 12;
    let format: number | null = null;
    let channels: number | null = null;
    let sampleRate: number | null = null;
    let pcmBits: number | null = null;
    let dataBytes: number | null = null;
    while (offset + 8 <= buffer.length) {
      const chunkId = buffer.toString('ascii', offset, offset + 4);
      const chunkSize = buffer.readUInt32LE(offset + 4);
      const chunkStart = offset + 8;
      if (chunkStart + chunkSize > buffer.length) {
        throw new Error('WAV chunk bị hỏng');
      }
      if (chunkId === 'fmt ' && chunkSize >= 16) {
        format = buffer.readUInt16LE(chunkStart);
        channels = buffer.readUInt16LE(chunkStart + 2);
        sampleRate = buffer.readUInt32LE(chunkStart + 4);
        pcmBits = buffer.readUInt16LE(chunkStart + 14);
      } else if (chunkId === 'data') {
        dataBytes = chunkSize;
      }
      offset = chunkStart + chunkSize + (chunkSize % 2);
    }
    if (
      format !== 1 ||
      channels !== 1 ||
      sampleRate !== 16000 ||
      pcmBits !== 16 ||
      !dataBytes
    ) {
      throw new Error('WAV chuẩn hóa không đạt PCM 16-bit mono 16 kHz');
    }
    return {
      codec: 'pcm_s16le',
      sampleRate: 16000,
      channels: 1,
      pcmBits: 16,
      dataBytes,
      durationMs: Math.round((dataBytes / (16000 * 2)) * 1000),
    };
  }
}
