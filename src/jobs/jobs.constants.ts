export const SYSTEM_QUEUE_NAME = 'breadtrans-system-jobs';

export const JOB_NAMES = {
  DAILY_ROLLOVER: 'daily-rollover',
  WEEKLY_LEAGUE: 'weekly-league',
  STREAK_REMINDER: 'streak-reminder',
  VOCABULARY_REVIEW: 'vocabulary-review',
  R2_AUDIO_CLEANUP: 'r2-audio-cleanup',
  DATABASE_BACKUP_R2_SYNC: 'database-backup-r2-sync',
} as const;

export type SystemJobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];

export interface SystemJobPayload {
  version: 1;
  dayKey?: string;
  weekKey?: string;
}
