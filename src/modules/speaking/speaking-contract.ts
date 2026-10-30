/** Values already used by the Speaking CMS data; keep them migration-free. */
/**
 * Practice set levels. The first nine stay inside one learner-facing group
 * (Cơ bản A1-A2, Trung cấp B1-B2, Nâng cao C1-C2), which the catalog, the
 * plan matrix and the recommender read; published sets already use them.
 * The last five span two groups and are kept only for older drafts.
 */
export const SPEAKING_SET_LEVELS = [
  'A1-A2',
  'A1',
  'A2',
  'B1-B2',
  'B1',
  'B2',
  'C1-C2',
  'C1',
  'C2',
  'A1-B1',
  'A2-B1',
  'A2-B2',
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
