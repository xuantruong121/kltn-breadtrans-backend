import { extractPcmFromWav } from '../diagnostic/diagnostic-azure-speech';
import { SCRIPTED_MAX_AUDIO_MS, trimWavToMs } from './speaking-assessment-mode';
import {
  createWavBuffer,
  validateSpeakingAudio,
} from './speaking-audio-validator';
import { maxRecordingMs, speakingTaskTiming } from './speaking-task-timing';

const limitOf = (taskType: string | null) =>
  maxRecordingMs(speakingTaskTiming({ taskType, examTask: false }));

const seconds = (wav: Buffer) => {
  const pcm = extractPcmFromWav(wav);
  return (
    pcm.data.length / (pcm.sampleRate * pcm.channels * (pcm.bitsPerSample / 8))
  );
};

/**
 * Every length either reaches grading or is rejected before grading. No
 * recording is stored as a 0: the validator throws, the row is never scored.
 */
describe('Speaking recording length', () => {
  it.each([
    ['READ_ALOUD', 29, true],
    ['READ_ALOUD', 31, true],
    ['READ_ALOUD', 32, false],
    ['READ_ALOUD', 45, false],
    ['PRONUNCIATION_DRILL', 29, true],
    ['PRONUNCIATION_DRILL', 31, true],
    ['PRONUNCIATION_DRILL', 32, false],
    ['DESCRIBE_PICTURE', 45, true],
    ['DESCRIBE_PICTURE', 46, true],
    ['DESCRIBE_PICTURE', 47, false],
    ['EXPRESS_OPINION', 61, true],
    ['EXPRESS_OPINION', 62, false],
    [null, 31, true],
    [null, 32, false],
  ])('%s, %i s: accepted %s', (taskType, durationSeconds, accepted) => {
    const wav = createWavBuffer({ durationSeconds });
    const check = () =>
      validateSpeakingAudio(wav, 'audio/wav', limitOf(taskType));
    if (accepted) expect(check().isValid).toBe(true);
    else expect(check).toThrow('vượt mức tối đa');
  });

  it.each([
    [29, 29],
    [31, 30],
    [45, 30],
  ])('a scripted %i s recording reaches Azure as %i s', (input, sent) => {
    const wav = createWavBuffer({ durationSeconds: input });
    expect(seconds(trimWavToMs(wav, SCRIPTED_MAX_AUDIO_MS))).toBe(sent);
  });
});
