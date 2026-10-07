export type DailyPracticeSkill =
  'LISTENING' | 'SPEAKING' | 'READING' | 'WRITING';

export type DailyPracticeReasonCode =
  | 'BALANCED_START'
  | 'WEAKEST_SKILL'
  | 'WEAKEST_DIMENSION'
  | 'NEEDS_MORE_DATA'
  | 'NOT_PRACTICED_RECENTLY'
  | 'DECLINING_TREND'
  | 'MAINTENANCE'
  | 'ACCESS_LOCKED';

export interface DailyPracticeItem {
  skill: DailyPracticeSkill;
  exerciseId: number;
  title: string;
  route: string;
  estimatedMinutes: number;
  reasonCode: DailyPracticeReasonCode;
  reasonLabel: string;
  isLocked: boolean;
  isCompleted: boolean;
  priority: number;
  dimension: string | null;
}

export interface DailyPracticeResponse {
  dateKey: string;
  generatedAt: string;
  estimatedMinutes: number;
  targetActivities: number;
  completedCount: number;
  reasonSummary: string;
  items: DailyPracticeItem[];
}
