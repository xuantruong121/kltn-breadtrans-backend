import { extractPcmFromWav } from '../diagnostic/diagnostic-azure-speech';
import {
  assessPracticeSpeech,
  SCRIPTED_MAX_AUDIO_MS,
  trimWavToMs,
} from './speaking-assessment-mode';
import { createWavBuffer } from './speaking-audio-validator';

/**
 * Scripted Speaking (read-aloud, drills) is scored by Azure's REST
 * short-audio pronunciation assessment, which takes at most 30 s of audio.
 */
const durationMs = (wav: Buffer) => {
  const pcm = extractPcmFromWav(wav);
  return (
    (pcm.data.length /
      (pcm.sampleRate * pcm.channels * (pcm.bitsPerSample / 8))) *
    1000
  );
};

describe('scripted Speaking audio limit', () => {
  it('cuts a 31.5 s recording to exactly 30 s, still a valid WAV', () => {
    const wav = createWavBuffer({ durationSeconds: 31.5 });
    const trimmed = trimWavToMs(wav, SCRIPTED_MAX_AUDIO_MS);
    expect(durationMs(trimmed)).toBe(30_000);
    expect(trimmed.readUInt32LE(4)).toBe(trimmed.length - 8);
    expect(trimmed.subarray(44, 1044).equals(wav.subarray(44, 1044))).toBe(
      true,
    );
  });

  it('leaves a recording within 30 s untouched', () => {
    const wav = createWavBuffer({ durationSeconds: 12 });
    expect(trimWavToMs(wav, SCRIPTED_MAX_AUDIO_MS)).toBe(wav);
  });

  it('leaves non-WAV bytes to the validator', () => {
    const junk = Buffer.from('not a wav file at all, definitely not RIFF');
    expect(trimWavToMs(junk, SCRIPTED_MAX_AUDIO_MS)).toBe(junk);
  });

  it('a read-aloud answer reaches Azure as at most 30 s', async () => {
    const ai = { assessPronunciation: jest.fn().mockResolvedValue({}) };
    await assessPracticeSpeech(
      ai,
      { taskType: 'READ_ALOUD', targetText: 'Read this.' },
      createWavBuffer({ durationSeconds: 31.4 }),
    );
    const sent = ai.assessPronunciation.mock.calls[0][1] as Buffer;
    expect(durationMs(sent)).toBeLessThanOrEqual(30_000);
  });
});
