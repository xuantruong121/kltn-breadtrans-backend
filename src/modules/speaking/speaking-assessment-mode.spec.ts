import type { SpeechEvidence } from '../diagnostic/diagnostic-azure-speech';
import {
  assessPracticeSpeech,
  isScriptedSpeakingTask,
  unscriptedPracticeFeedback,
} from './speaking-assessment-mode';

const evidence: SpeechEvidence = {
  locale: 'en-US',
  mode: 'UNSCRIPTED_CONTINUOUS',
  segmentCount: 1,
  recordingDurationMs: 9000,
  speakingSpanMs: 8500,
  transcript: 'I usually walk to work because it is close to my home.',
  recognizedWordCount: 12,
  speechRateWpm: 84,
  longPauseCount: 2,
  longestPauseMs: 1600,
  azure: { accuracy: 88, fluency: 64, prosody: 72, pronunciation: 76.4 },
};

describe('speaking practice assessment mode', () => {
  it('only read-aloud style tasks are scripted', () => {
    expect(isScriptedSpeakingTask('READ_ALOUD')).toBe(true);
    expect(isScriptedSpeakingTask('PRONUNCIATION_DRILL')).toBe(true);
    expect(isScriptedSpeakingTask(null)).toBe(true);
    for (const t of [
      'RESPOND_TO_QUESTION',
      'EXPRESS_OPINION',
      'DESCRIBE_PICTURE',
      'RESPOND_USING_INFORMATION',
    ])
      expect(isScriptedSpeakingTask(t)).toBe(false);
  });

  it('free-answer feedback comes from the evidence, with no word-error list', () => {
    const fb = unscriptedPracticeFeedback(evidence);
    expect(fb.overallScore).toBe(7.6);
    expect(fb.clarity).toBe('Good');
    expect(fb.problematicWords).toEqual([]);
    expect(fb.completenessScore).toBeUndefined();
    expect(fb.transcript).toBe(evidence.transcript);
    expect(fb.feedback).toMatch(/không so với câu hỏi/);
    expect(fb.suggestions.join(' ')).toMatch(/2 lần ngừng/);
    expect(fb.suggestions.join(' ')).toMatch(/84 từ\/phút/);
  });

  it('a read-aloud task keeps the scripted assessment against its text', async () => {
    const ai = {
      assessPronunciation: jest.fn().mockResolvedValue({ overallScore: 8 }),
    };
    await assessPracticeSpeech(
      ai,
      { taskType: 'READ_ALOUD', targetText: 'Please close the door.' },
      Buffer.alloc(0),
    );
    expect(ai.assessPronunciation).toHaveBeenCalledWith(
      'Please close the door.',
      expect.any(Buffer),
      undefined,
    );
  });

  it('a free answer never sends the question as reference text', async () => {
    const ai = { assessPronunciation: jest.fn() };
    const saved = { ...process.env };
    delete process.env.AZURE_SPEECH_KEY;
    try {
      await expect(
        assessPracticeSpeech(
          ai as never,
          {
            taskType: 'EXPRESS_OPINION',
            targetText: 'Do you prefer working from home?',
          },
          Buffer.alloc(0),
        ),
      ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
      expect(ai.assessPronunciation).not.toHaveBeenCalled();
    } finally {
      process.env = saved;
    }
  });

  it('a non-WAV upload for a free answer is a permanent provider error, not a score', async () => {
    const saved = { ...process.env };
    process.env.AZURE_SPEECH_KEY = 'k';
    process.env.AZURE_SPEECH_REGION = 'r';
    try {
      await expect(
        assessPracticeSpeech(
          { assessPronunciation: jest.fn() },
          { taskType: 'EXPRESS_OPINION', targetText: 'q' },
          Buffer.from('not a wav'),
        ),
      ).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    } finally {
      process.env = saved;
    }
  });
});
