/**
 * Content of a free Speaking answer (owner 2026-11-13: an answer about
 * something else still scored 6.9, because only pronunciation was assessed).
 *
 * For a free answer (respond to a question, express an opinion, describe a
 * picture, respond using information) Gemini reads what Azure heard and the
 * task, and returns whether the answer does the task, a 0-10 content score and
 * one Vietnamese sentence. The total is the mean of pronunciation and content;
 * an answer whose content is under 3 (always so when it is off topic) totals
 * at most 3, so clear pronunciation of something else cannot score well.
 *
 * Pure: the model call is injected, everything else is plain data. When the
 * call fails the result says so and the total is pronunciation alone; a
 * missing content grade is never shown as a number.
 */
import type { PronunciationFeedback } from '../ai/strategies/ai-evaluator.interface';

export const CONTENT_RELEVANCE = ['ON_TASK', 'PARTIAL', 'OFF_TOPIC'] as const;
export type ContentRelevance = (typeof CONTENT_RELEVANCE)[number];

/** Below this content score the total is capped (owner choice 2026-11-13). */
export const CONTENT_FLOOR = 3;
/** The highest content score an OFF_TOPIC answer can keep. */
export const OFF_TOPIC_CONTENT_MAX = 2;

export type SpeakingContentTask = {
  taskType: string | null;
  /** The question, the opinion prompt or the picture instruction. */
  targetText: string;
  /** The schedule, notice or table of a respond-using-information task. */
  stimulus?: { title: string | null; content: string | null } | null;
};

export type SpeakingContentGrade =
  | {
      status: 'GRADED';
      relevance: ContentRelevance;
      score: number;
      comment: string;
    }
  | { status: 'UNAVAILABLE'; reason: string };

export const SPEAKING_CONTENT_SCHEMA = {
  type: 'object',
  properties: {
    taskRelevance: { type: 'string', enum: [...CONTENT_RELEVANCE] },
    contentScore: { type: 'integer' },
    comment: { type: 'string' },
  },
  required: ['taskRelevance', 'contentScore', 'comment'],
};

const TASK_GUIDE: Record<string, string> = {
  RESPOND_TO_QUESTION:
    'The learner answers a spoken question. ON_TASK: the answer gives the information the question asks for (any plausible answer counts; there is no fixed right answer).',
  EXPRESS_OPINION:
    'The learner gives an opinion on the prompt. ON_TASK: a clear position on this prompt with at least one reason.',
  DESCRIBE_PICTURE:
    'The learner describes a picture. You cannot see the picture: judge only whether the answer describes a scene that fits the instruction (people, place, actions), not whether every detail is right.',
  RESPOND_USING_INFORMATION:
    'The learner answers a question using the information given. ON_TASK: the answer uses that information correctly.',
};

/** The request to send to the model for one answer. */
export function buildSpeakingContentRequest(
  task: SpeakingContentTask,
  transcript: string,
) {
  const stimulus = task.stimulus?.content?.trim()
    ? {
        title: task.stimulus.title ?? null,
        content: task.stimulus.content.trim(),
      }
    : null;
  return {
    systemInstruction: [
      'You grade the CONTENT of a short spoken English answer by a Vietnamese learner (beginner to intermediate) in a practice app.',
      'Pronunciation is graded elsewhere: ignore accent and ignore small transcription slips.',
      'The transcript is what speech recognition heard, without punctuation guarantees.',
      'Return taskRelevance: ON_TASK (does what the task asks), PARTIAL (on the topic but misses part of it, or too short to answer it), OFF_TOPIC (about something else, or does not answer at all).',
      'Return contentScore, an integer 0-10: how well the answer does the task, with simple correct grammar and enough detail for a short practice answer. A one-line correct answer to a simple question can score 7-8. OFF_TOPIC scores 0-2.',
      'Return comment: ONE sentence in Vietnamese with diacritics, saying what the answer did and the most useful fix. Quote at most a few English words.',
    ].join(' '),
    prompt: JSON.stringify({
      taskType: task.taskType,
      guide: TASK_GUIDE[task.taskType ?? ''] ?? TASK_GUIDE.RESPOND_TO_QUESTION,
      task: task.targetText,
      information: stimulus,
      learnerTranscript: transcript,
    }),
    responseSchema: SPEAKING_CONTENT_SCHEMA,
    temperature: 0.1,
    timeoutMs: 20_000,
    failoverOnTimeout: true,
  };
}

const hasVietnameseDiacritics = (text: string) =>
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(
    text,
  );

/** The model's reply, checked; anything malformed is UNAVAILABLE, never a guess. */
export function parseSpeakingContentGrade(text: string): SpeakingContentGrade {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { status: 'UNAVAILABLE', reason: 'NOT_JSON' };
  }
  const relevance = data.taskRelevance as ContentRelevance;
  if (!CONTENT_RELEVANCE.includes(relevance))
    return { status: 'UNAVAILABLE', reason: 'RELEVANCE_MISSING' };
  const raw = Number(data.contentScore);
  if (!Number.isFinite(raw) || raw < 0 || raw > 10)
    return { status: 'UNAVAILABLE', reason: 'SCORE_OUT_OF_RANGE' };
  const comment = typeof data.comment === 'string' ? data.comment.trim() : '';
  if (comment.length < 10 || !hasVietnameseDiacritics(comment))
    return { status: 'UNAVAILABLE', reason: 'COMMENT_MISSING' };
  const score = Math.round(
    relevance === 'OFF_TOPIC' ? Math.min(raw, OFF_TOPIC_CONTENT_MAX) : raw,
  );
  return { status: 'GRADED', relevance, score, comment };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Total of a free answer: mean of the two, at most 3 when content is under 3. */
export function combineSpeakingScores(
  pronunciation: number,
  content: number,
): number {
  const mean = round1((pronunciation + content) / 2);
  return content < CONTENT_FLOOR ? Math.min(mean, CONTENT_FLOOR) : mean;
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

/** Extra fields a free answer carries in aiFeedback. */
export type SpeakingContentFields = {
  pronunciationScore?: number;
  contentStatus?: 'GRADED' | 'UNAVAILABLE';
  contentScore?: number;
  contentRelevance?: ContentRelevance;
  contentComment?: string;
  scoreVersion?: string;
};

/** The pronunciation-only feedback of a free answer with its content grade folded in. */
export function withContentGrade(
  feedback: PronunciationFeedback,
  grade: SpeakingContentGrade,
): PronunciationFeedback & SpeakingContentFields {
  const pronunciation = feedback.overallScore;
  if (grade.status === 'UNAVAILABLE')
    return {
      ...feedback,
      pronunciationScore: pronunciation,
      contentStatus: 'UNAVAILABLE',
      scoreVersion: 'v2-content',
      feedback: `${feedback.feedback} Lần này chưa chấm được nội dung câu trả lời, nên điểm chỉ tính phát âm.`,
    };
  const total = combineSpeakingScores(pronunciation, grade.score);
  const offTopic = grade.relevance === 'OFF_TOPIC';
  return {
    ...feedback,
    overallScore: total,
    clarity: clarityOf(total),
    pronunciationScore: pronunciation,
    contentStatus: 'GRADED',
    contentScore: grade.score,
    contentRelevance: grade.relevance,
    contentComment: grade.comment,
    scoreVersion: 'v2-content',
    feedback:
      `Điểm tổng ${total.toFixed(1)}/10 = trung bình Phát âm ${pronunciation.toFixed(1)} và Nội dung ${grade.score}/10` +
      (grade.score < CONTENT_FLOOR
        ? `, tối đa ${CONTENT_FLOOR} vì nội dung chưa trả lời đúng đề`
        : '') +
      `. ${grade.comment}`,
    suggestions: offTopic
      ? [
          'Nghe lại câu hỏi và trả lời đúng điều được hỏi trước, rồi mới thêm ý.',
          ...feedback.suggestions,
        ]
      : feedback.suggestions,
  };
}

/** Grades the content of a free answer with an injected model call; never throws. */
export async function gradeFreeAnswerContent(
  generate: (
    request: ReturnType<typeof buildSpeakingContentRequest>,
  ) => Promise<{ text: string }>,
  task: SpeakingContentTask,
  feedback: PronunciationFeedback,
): Promise<PronunciationFeedback & SpeakingContentFields> {
  const transcript = (feedback.transcript ?? '').trim();
  if (feedback.isSilentOrNoSpeech || !transcript) return feedback;
  try {
    const { text } = await generate(
      buildSpeakingContentRequest(task, transcript),
    );
    return withContentGrade(feedback, parseSpeakingContentGrade(text));
  } catch (error) {
    return withContentGrade(feedback, {
      status: 'UNAVAILABLE',
      reason: (error as { code?: string })?.code ?? 'PROVIDER_ERROR',
    });
  }
}
