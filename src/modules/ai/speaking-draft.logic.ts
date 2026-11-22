/**
 * Pure rules for the Speaking AI drafts (Gemini strategy): which task types a
 * draft may write, how its candidates are cleaned, and the copy rule for the
 * set title and description. No I/O, no model client.
 */
import {
  SPEAKING_EXERCISE_DIFFICULTIES,
  SPEAKING_TASK_TYPES,
  type SpeakingTaskType,
} from '../speaking/speaking-contract';

/**
 * Task types that cannot be saved from text alone: a picture task needs a
 * verified image and an information task an information table. An AI draft
 * brings neither, so it never writes them (QA 2026-11-22: a full draft with a
 * picture task left a half-created set).
 */
export const SPEAKING_STIMULUS_TASK_TYPES: readonly SpeakingTaskType[] = [
  'DESCRIBE_PICTURE',
  'RESPOND_USING_INFORMATION',
];

/** Task types an AI draft can write and the CMS can save as they come. */
export const SPEAKING_DRAFT_TASK_TYPES: readonly SpeakingTaskType[] =
  SPEAKING_TASK_TYPES.filter(
    (taskType) => !SPEAKING_STIMULUS_TASK_TYPES.includes(taskType),
  );

export function isSpeakingDraftTaskType(
  value: unknown,
): value is SpeakingTaskType {
  return (SPEAKING_DRAFT_TASK_TYPES as readonly unknown[]).includes(value);
}

/**
 * Task types a full draft may use. A requested type is kept only when the
 * draft can save it; otherwise the draft chooses among the text-only types.
 */
export function fullDraftTaskTypes(
  requested?: SpeakingTaskType,
): readonly SpeakingTaskType[] {
  return requested && isSpeakingDraftTaskType(requested)
    ? [requested]
    : SPEAKING_DRAFT_TASK_TYPES;
}

/**
 * Task types for the suggestions inside the exercise form. The admin who
 * picked a picture or information task attaches its media in that same form,
 * so the picked type is kept; with none picked, only text-only types.
 */
export function exerciseSuggestionTaskTypes(
  requested?: SpeakingTaskType,
): readonly SpeakingTaskType[] {
  return requested ? [requested] : SPEAKING_DRAFT_TASK_TYPES;
}

export type SpeakingDraftCandidate = {
  title: string;
  targetText: string;
  difficulty: string;
  taskType: SpeakingTaskType;
};

/** Well-formed candidates of an allowed task type, trimmed to the stored sizes. */
export function cleanSpeakingCandidates(
  raw: unknown,
  allowed: readonly SpeakingTaskType[],
): SpeakingDraftCandidate[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (candidate): candidate is Record<string, string> =>
        !!candidate &&
        typeof candidate === 'object' &&
        typeof candidate.title === 'string' &&
        !!candidate.title.trim() &&
        typeof candidate.targetText === 'string' &&
        !!candidate.targetText.trim() &&
        (allowed as readonly unknown[]).includes(candidate.taskType) &&
        (SPEAKING_EXERCISE_DIFFICULTIES as readonly unknown[]).includes(
          candidate.difficulty,
        ),
    )
    .map((candidate) => ({
      title: candidate.title.trim().slice(0, 200),
      targetText: candidate.targetText.trim().slice(0, 2000),
      difficulty: candidate.difficulty,
      taskType: candidate.taskType as SpeakingTaskType,
    }));
}

/** The prompt line naming the task types a draft may use. */
export function speakingTaskTypeRule(
  allowed: readonly SpeakingTaskType[],
): string {
  return allowed.length === 1
    ? `Every candidate uses taskType ${allowed[0]}.`
    : `Each taskType must be one of ${allowed.join(', ')}. Never use ${SPEAKING_STIMULUS_TASK_TYPES.join(' or ')}: they need a picture or an information table that a draft cannot bring.`;
}

/**
 * Published sets are titled "<kind of task or theme> — <context>" in
 * Vietnamese and described in one Vietnamese sentence (prisma/data/
 * speaking-practice-sets.ts). QA 2026-11-22 got an English description.
 */
export const SPEAKING_SET_COPY_RULE =
  'Write practiceSet title and description in Vietnamese, for Vietnamese learners; only exercise targetText is English. ' +
  'Title: short, in the form "<loại bài hoặc chủ đề> — <ngữ cảnh>", with no CEFR code, like "Đọc thành tiếng — Ngữ cảnh công việc" or "Phản hồi câu hỏi — Học tập & Công việc". ' +
  'Description: one Vietnamese sentence under 160 characters saying what the learner practises, like "Đọc thông báo công sở và dịch vụ có câu ghép, số liệu và từ chuyên ngành."';

const VIETNAMESE_MARK =
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

/** True when the text carries Vietnamese letters; an English sentence has none. */
export function isVietnameseText(text: string): boolean {
  return VIETNAMESE_MARK.test(text);
}
