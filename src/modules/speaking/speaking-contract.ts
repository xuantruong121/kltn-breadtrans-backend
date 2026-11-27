import { PRACTICE_LEVELS } from '../subscription/practice-level';

/**
 * A practice set's level and an exercise's difficulty are both one of the four
 * practice levels (owner 2026-11-27; the set level was a CEFR range and the
 * difficulty BEGINNER/INTERMEDIATE/ADVANCED before).
 */
export const SPEAKING_SET_LEVELS = PRACTICE_LEVELS;

export const SPEAKING_EXERCISE_DIFFICULTIES = PRACTICE_LEVELS;

export const SPEAKING_TASK_TYPES = [
  'READ_ALOUD',
  'DESCRIBE_PICTURE',
  'RESPOND_TO_QUESTION',
  'RESPOND_USING_INFORMATION',
  'EXPRESS_OPINION',
  'PRONUNCIATION_DRILL',
] as const;

export type SpeakingTaskType = (typeof SPEAKING_TASK_TYPES)[number];

export const SPEAKING_TASK_TYPE_LABELS: Record<SpeakingTaskType, string> = {
  READ_ALOUD: 'Đọc thành tiếng',
  DESCRIBE_PICTURE: 'Mô tả hình ảnh',
  RESPOND_TO_QUESTION: 'Trả lời câu hỏi',
  RESPOND_USING_INFORMATION: 'Trả lời dựa trên thông tin',
  EXPRESS_OPINION: 'Trình bày ý kiến',
  PRONUNCIATION_DRILL: 'Bài luyện phát âm',
};

export type SpeakingSetLevel = (typeof SPEAKING_SET_LEVELS)[number];
