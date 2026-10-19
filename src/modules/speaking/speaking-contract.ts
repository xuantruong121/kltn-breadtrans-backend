/** Values already used by the Speaking CMS data; keep them migration-free. */
export const SPEAKING_SET_LEVELS = [
  'A1-B1',
  'A2-B1',
  'A2-B2',
  'B1-B2',
  'B1-C1',
] as const;

export const SPEAKING_EXERCISE_DIFFICULTIES = [
  'BEGINNER',
  'INTERMEDIATE',
  'ADVANCED',
] as const;

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
