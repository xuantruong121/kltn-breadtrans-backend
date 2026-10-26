/**
 * Which pronunciation assessment a Speaking practice exercise gets.
 *
 * READ_ALOUD and PRONUNCIATION_DRILL ask the learner to read the displayed
 * text, so it is the reference for a scripted assessment (accuracy,
 * completeness, word-level errors). Every other task type (respond to a
 * question, express an opinion, describe a picture, respond using
 * information) is a free answer. The former code sent the QUESTION as the
 * reference text for those too, so Azure judged the answer against words the
 * learner was never asked to say: "omitted" words and a meaningless
 * completeness score. Free answers are now assessed unscripted, on what the
 * learner actually said, and no word-level error list is claimed for them.
 */
import type { AiService } from '../ai/ai.service';
import type { PronunciationFeedback } from '../ai/strategies/ai-evaluator.interface';
import {
  AzureUnscriptedSpeechAssessor,
  createAzureRecognitionSession,
  extractPcmFromWav,
  type SpeechEvidence,
} from '../diagnostic/diagnostic-azure-speech';
import { DiagnosticGraderError } from '../diagnostic/diagnostic-productive';
import { MockSpeakingEvaluator } from './mock-speaking-evaluator';

const SCRIPTED_TASKS = new Set(['READ_ALOUD', 'PRONUNCIATION_DRILL']);

/** Legacy exercises without a task type were read-aloud sentences. */
export function isScriptedSpeakingTask(
  taskType: string | null | undefined,
): boolean {
  return !taskType || SCRIPTED_TASKS.has(taskType);
}

function clarityOf(score: number): string {
  return score >= 8
    ? 'Excellent'
    : score >= 6
      ? 'Good'
      : score >= 4
        ? 'Fair'
        : 'Poor';
}

/** Practice feedback for a free answer, from Azure unscripted evidence only. */
export function unscriptedPracticeFeedback(
  evidence: SpeechEvidence,
): PronunciationFeedback {
  const overall = Math.max(
    0,
    Math.min(10, Number((evidence.azure.pronunciation / 10).toFixed(1))),
  );
  const accuracy = Math.round(evidence.azure.accuracy);
  const fluency = Math.round(evidence.azure.fluency);
  const wpm = Math.round(evidence.speechRateWpm);
  const prosody =
    evidence.azure.prosody === null ? null : Math.round(evidence.azure.prosody);
  const suggestions: string[] = [];
  if (accuracy < 70)
    suggestions.push(
      'Một số âm chưa rõ: nói chậm lại một chút và phát âm rõ âm cuối của từ.',
    );
  if (fluency < 70 || evidence.longPauseCount >= 2)
    suggestions.push(
      `Bài nói có ${evidence.longPauseCount} lần ngừng trên 1 giây: chuẩn bị trước ý chính và dùng cụm nối như "because", "for example" để nói liền mạch hơn.`,
    );
  if (wpm > 0 && wpm < 90)
    suggestions.push(
      `Tốc độ nói khoảng ${wpm} từ/phút, hơi chậm: luyện nói trọn câu không ngắt giữa chừng.`,
    );
  if (prosody !== null && prosody < 70)
    suggestions.push(
      'Ngữ điệu còn đều: nhấn vào từ khóa và hạ giọng ở cuối câu trần thuật.',
    );
  if (!suggestions.length)
    suggestions.push(
      evidence.recognizedWordCount < 40
        ? 'Phát âm và độ trôi chảy tốt. Thử trả lời dài hơn với một lý do và một ví dụ.'
        : 'Phát âm và độ trôi chảy tốt. Giữ tốc độ này và nhấn rõ từ khóa ở mỗi ý chính.',
    );
  return {
    overallScore: overall,
    clarity: clarityOf(overall),
    feedback:
      `Điểm phát âm: ${overall.toFixed(1)}/10, chấm trên chính câu trả lời bạn nói (bài trả lời tự do, không so với câu hỏi). ` +
      `Độ chính xác: ${accuracy}%, Trôi chảy: ${fluency}%${prosody === null ? '' : `, Ngữ điệu: ${prosody}%`}. ` +
      `Tốc độ nói khoảng ${wpm} từ/phút.`,
    problematicWords: [],
    suggestions,
    accuracyScore: accuracy,
    fluencyScore: fluency,
    transcript: evidence.transcript,
  };
}

const NO_SPEECH: PronunciationFeedback = {
  overallScore: 0,
  clarity: 'Poor',
  feedback:
    'Hệ thống nhận ra quá ít lời nói trong bản ghi nên chưa thể chấm. Hãy nói rõ, ít nhất vài câu, rồi ghi âm lại.',
  problematicWords: [],
  suggestions: [
    'Kiểm tra micro và nói gần micro hơn.',
    'Trả lời bằng ít nhất hai câu đầy đủ.',
  ],
  isSilentOrNoSpeech: true,
};

/** Assess one practice recording with the mode its task type calls for. */
export async function assessPracticeSpeech(
  aiService: Pick<AiService, 'assessPronunciation'>,
  exercise: { taskType: string | null; targetText: string },
  audio: Buffer,
  options?: { signal?: AbortSignal },
): Promise<PronunciationFeedback> {
  if (isScriptedSpeakingTask(exercise.taskType))
    return aiService.assessPronunciation(exercise.targetText, audio, options);

  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!key || !region) {
    const err = new Error('AZURE_SPEECH_KEY or AZURE_SPEECH_REGION is missing');
    (err as Error & { code?: string }).code = 'PROVIDER_UNAVAILABLE';
    throw err;
  }
  try {
    const pcm = extractPcmFromWav(audio);
    const durationMs = Math.round(
      (pcm.data.length /
        (pcm.sampleRate * pcm.channels * (pcm.bitsPerSample / 8))) *
        1000,
    );
    const evidence = await new AzureUnscriptedSpeechAssessor(
      createAzureRecognitionSession({ key, region }),
    ).assess(audio, durationMs);
    return unscriptedPracticeFeedback(evidence);
  } catch (error) {
    if (error instanceof DiagnosticGraderError) {
      if (/INSUFFICIENT/i.test(error.code)) return NO_SPEECH;
      const err = new Error(error.message);
      (err as Error & { code?: string }).code =
        error.kind === 'TRANSIENT' ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_ERROR';
      throw err;
    }
    throw error;
  }
}

/**
 * Dev/test stand-in with the same mode split, so a mock run shows a free
 * answer the way a real one is shown. The transcript says it is mock output.
 */
export async function mockPracticeSpeech(
  exercise: { taskType: string | null; targetText: string },
  audio: Buffer,
  options?: { signal?: AbortSignal },
): Promise<PronunciationFeedback> {
  const scripted = await MockSpeakingEvaluator.evaluate(
    exercise.targetText,
    audio,
    options,
  );
  if (isScriptedSpeakingTask(exercise.taskType))
    return scripted as unknown as PronunciationFeedback;
  return unscriptedPracticeFeedback({
    locale: 'en-US',
    mode: 'UNSCRIPTED_CONTINUOUS',
    transcript: '[mock] I think it is a good idea because it saves time.',
    recognizedWordCount: 12,
    segmentCount: 1,
    recordingDurationMs: 8000,
    speakingSpanMs: 7600,
    speechRateWpm: 95,
    longPauseCount: 1,
    longestPauseMs: 1200,
    azure: { accuracy: 86, fluency: 78, prosody: 74, pronunciation: 81 },
  });
}
