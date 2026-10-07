export interface SkillProgressSummary {
  skill: 'LISTENING' | 'READING' | 'SPEAKING' | 'WRITING';
  title: string;
  categoryLabel: string;
  totalItems: number;
  completedItems: number;
  progressPercent: number;
  levelRange: string;
  badge: string;
  unitLabel: string;
}

export interface OverallSkillsProgress {
  completedItems: number;
  totalItems: number;
  progressPercent: number;
}

export interface UserSkillsSummaryResponse {
  skills: SkillProgressSummary[];
  overall: OverallSkillsProgress;
}

export type SkillTrend =
  'IMPROVING' | 'DECLINING' | 'STABLE' | 'INSUFFICIENT_DATA';

export type SkillStatus =
  'INSUFFICIENT_DATA' | 'NEEDS_IMPROVEMENT' | 'PROGRESSING' | 'GOOD';

export interface SkillDimensionSummary {
  key: string;
  sampleCount: number;
  averageScore: number | null;
  status: SkillStatus;
  statusLabel: string;
}

export interface CrossSkillSummaryItem extends SkillProgressSummary {
  completedAttempts: number;
  normalizedScore: number | null;
  recentAverage: number | null;
  trend: SkillTrend;
  strongestDimension: string | null;
  weakestDimension: string | null;
  lastPracticedAt: string | null;
  status: SkillStatus;
  statusLabel: string;
  hasEnoughData: boolean;
  dimensions: SkillDimensionSummary[];
}

export interface CrossSkillSummaryResponse {
  skills: CrossSkillSummaryItem[];
  overall: OverallSkillsProgress & {
    normalizedScore: number | null;
    recentAverage: number | null;
    trend: SkillTrend;
    currentStreak: number;
  };
}
