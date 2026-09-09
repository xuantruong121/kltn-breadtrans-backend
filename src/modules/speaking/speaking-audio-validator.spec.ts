import { BadRequestException } from '@nestjs/common';
import {
  validateSpeakingAudio,
  createWavBuffer,
} from './speaking-audio-validator';

describe('SpeakingAudioValidator - Byte-Level WAV Validation', () => {
  it('rejects empty file', () => {
    expect(() => validateSpeakingAudio(Buffer.alloc(0))).toThrow(
      BadRequestException,
    );
    expect(() => validateSpeakingAudio(Buffer.alloc(0))).toThrow(
      'Audio file is empty',
    );
  });

  it('rejects oversized file (> 10MB)', () => {
    const hugeBuffer = Buffer.alloc(10 * 1024 * 1024 + 1);
    expect(() => validateSpeakingAudio(hugeBuffer)).toThrow(
      'Audio file exceeds maximum size limit',
    );
  });

  it('rejects file smaller than minimum WAV header (< 44 bytes)', () => {
    const tinyBuffer = Buffer.from('RIFF1234WAVEfmt ');
    expect(() => validateSpeakingAudio(tinyBuffer)).toThrow(
      'incomplete WAV header',
    );
  });

  it('rejects invalid declared MIME type', () => {
    const validWav = createWavBuffer({ durationSeconds: 1 });
    expect(() => validateSpeakingAudio(validWav, 'audio/mp3')).toThrow(
      'Unsupported audio MIME type',
    );
  });

  it('rejects invalid magic bytes (not RIFF/WAVE)', () => {
    const fakeBuffer = Buffer.alloc(100);
    fakeBuffer.write('FAKE', 0);
    fakeBuffer.write('WAVE', 8);
    expect(() => validateSpeakingAudio(fakeBuffer)).toThrow(
      'magic bytes must be RIFF/WAVE',
    );
  });

  it('rejects non-PCM format (e.g. IEEE Float format = 3)', () => {
    const wav = createWavBuffer({ durationSeconds: 1 });
    wav.writeUInt16LE(3, 20); // Format tag 3
    expect(() => validateSpeakingAudio(wav)).toThrow(
      'Audio must be linear PCM',
    );
  });

  it('rejects non-mono audio (stereo 2 channels)', () => {
    const stereoWav = createWavBuffer({ channels: 2, durationSeconds: 1 });
    expect(() => validateSpeakingAudio(stereoWav)).toThrow(
      'Audio must be mono (1 channel)',
    );
  });

  it('rejects non-16 kHz audio (e.g. 44100 Hz)', () => {
    const highRateWav = createWavBuffer({
      sampleRate: 44100,
      durationSeconds: 1,
    });
    expect(() => validateSpeakingAudio(highRateWav)).toThrow(
      'Audio sample rate must be exactly 16000 Hz',
    );
  });

  it('rejects non-16-bit depth (e.g. 8-bit)', () => {
    const eightBitWav = createWavBuffer({
      bitsPerSample: 8,
      durationSeconds: 1,
    });
    expect(() => validateSpeakingAudio(eightBitWav)).toThrow(
      'Audio bit depth must be 16-bit PCM',
    );
  });

  it('rejects audio longer than 45 seconds', () => {
    const longWav = createWavBuffer({ durationSeconds: 46 });
    expect(() => validateSpeakingAudio(longWav)).toThrow(
      'exceeds maximum allowed duration of 45 seconds',
    );
  });

  it('rejects audio shorter than 300ms', () => {
    const shortWav = createWavBuffer({ durationSeconds: 0.1 });
    expect(() => validateSpeakingAudio(shortWav)).toThrow(
      'Audio duration is too short',
    );
  });

  it('accepts valid silent audio so it can be recorded as a NO_SPEECH attempt', () => {
    const silentWav = createWavBuffer({ durationSeconds: 1, silent: true });
    const result = validateSpeakingAudio(silentWav);
    expect(result.isValid).toBe(true);
    expect(result.quality.isSilent).toBe(true);
  });

  it('accepts valid 16kHz mono 16-bit PCM WAV and extracts quality metrics', () => {
    const validWav = createWavBuffer({
      sampleRate: 16000,
      channels: 1,
      bitsPerSample: 16,
      durationSeconds: 2,
      amplitude: 0.6,
    });

    const result = validateSpeakingAudio(validWav, 'audio/wav');
    expect(result.isValid).toBe(true);
    expect(result.durationMs).toBe(2000);
    expect(result.audioMimeType).toBe('audio/wav');
    expect(result.quality.sampleRate).toBe(16000);
    expect(result.quality.channels).toBe(1);
    expect(result.quality.bitsPerSample).toBe(16);
    expect(result.quality.isSilent).toBe(false);
    expect(result.quality.rmsDb).toBeGreaterThan(-60);
  });
});
