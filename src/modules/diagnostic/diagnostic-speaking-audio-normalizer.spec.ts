import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import ffmpegPath from 'ffmpeg-static';
import { DiagnosticSpeakingAudioNormalizer } from './diagnostic-speaking-audio-normalizer';

describe('DiagnosticSpeakingAudioNormalizer', () => {
  it('rejects unsupported media before invoking a decoder', async () => {
    const normalizer = new DiagnosticSpeakingAudioNormalizer();
    await expect(
      normalizer.normalize(
        Buffer.from('not-audio'),
        'application/octet-stream',
      ),
    ).rejects.toThrow('không được hỗ trợ');
  });

  const fixture = resolve(
    process.cwd(),
    '..',
    '..',
    'artifacts',
    'entry-diagnostic-2',
    'qa-confirm.webm',
  );

  (existsSync(fixture) && ffmpegPath && existsSync(ffmpegPath) ? it : it.skip)(
    'converts browser WebM to canonical WAV PCM',
    async () => {
      const normalizer = new DiagnosticSpeakingAudioNormalizer();
      const result = await normalizer.normalize(
        readFileSync(fixture),
        'audio/webm;codecs=opus',
      );
      expect(result.normalizedMime).toBe('audio/wav');
      expect(result.normalizedCodec).toBe('pcm_s16le');
      expect(result.normalizedSampleRate).toBe(16000);
      expect(result.normalizedChannels).toBe(1);
      expect(result.normalizedPcmBits).toBe(16);
      expect(result.buffer.subarray(0, 4).toString()).toBe('RIFF');
      expect(result.durationMs).toBeGreaterThan(0);
    },
    30000,
  );
});
