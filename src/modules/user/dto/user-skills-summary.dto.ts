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
