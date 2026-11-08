/**
 * The eight badges and what earns each (owner decision 2026-11-08: the first
 * rules were too easy; each badge now takes from a few days to about a month
 * of steady study). A learner doing about three practices a day earns
 * roughly 250-300 XP a day; the pet gains at most 50 EXP a day and needs
 * 1,000 EXP per level. Pure: the facts are loaded elsewhere.
 */
export const BADGE_RULES = {
  /** Tân Binh: total XP. */
  rookieXp: 500,
  /** Thợ Săn: total XP. */
  hunterXp: 5000,
  /** Chăm Chỉ: days in the current streak. */
  streakDays: 7,
  /** Siêu Sao: first on the weekly ranking with at least this much weekly XP. */
  starWeeklyXp: 1000,
  /** Học Bá: different Listening or Reading practices finished at 100 %. */
  perfectPractices: 10,
  /** Giọng Đọc Vàng: different speaking practices scored 8/10 (80 %) or more. */
  highSpeaking: 10,
  /** Đấu Sĩ Bất Bại: arena wins in a row. */
  arenaWinStreak: 5,
  /** Chuyên Gia Nuôi Thú: pet level. */
  petLevel: 3,
} as const;

export type BadgeFacts = {
  totalXp: number;
  weeklyXp: number;
  /** First on the weekly ranking across every tier. */
  isWeeklyTop: boolean;
  streak: number;
  perfectPractices: number;
  highSpeaking: number;
  longestArenaWinStreak: number;
  petLevel: number;
};

/** 5000 -> "5.000", the Vietnamese thousands mark, without relying on ICU. */
function vn(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export const BADGE_DESCRIPTIONS: Record<
  string,
  { description: string; criteria: Record<string, unknown> }
> = {
  'Tân Binh': {
    description: `Tích lũy ${vn(BADGE_RULES.rookieXp)} XP`,
    criteria: { type: 'EXP', threshold: BADGE_RULES.rookieXp },
  },
  'Thợ Săn': {
    description: `Tích lũy ${vn(BADGE_RULES.hunterXp)} XP`,
    criteria: { type: 'EXP', threshold: BADGE_RULES.hunterXp },
  },
  'Chăm Chỉ': {
    description: `Giữ chuỗi ${BADGE_RULES.streakDays} ngày học`,
    criteria: { type: 'STREAK', threshold: BADGE_RULES.streakDays },
  },
  'Siêu Sao': {
    description: `Đứng đầu bảng xếp hạng tuần với ít nhất ${vn(BADGE_RULES.starWeeklyXp)} XP trong tuần`,
    criteria: {
      type: 'LEADERBOARD_TOP1',
      minWeeklyXp: BADGE_RULES.starWeeklyXp,
    },
  },
  'Học Bá': {
    description: `Đạt 100% ở ${BADGE_RULES.perfectPractices} bài luyện Nghe hoặc Đọc khác nhau`,
    criteria: { type: 'QUIZ', threshold: BADGE_RULES.perfectPractices },
  },
  'Giọng Đọc Vàng': {
    description: `Đạt từ 80 điểm ở ${BADGE_RULES.highSpeaking} bài luyện nói khác nhau`,
    criteria: { type: 'SPEAKING', threshold: BADGE_RULES.highSpeaking },
  },
  'Đấu Sĩ Bất Bại': {
    description: `Thắng ${BADGE_RULES.arenaWinStreak} trận Đấu trường liên tiếp`,
    criteria: { type: 'ARENA', threshold: BADGE_RULES.arenaWinStreak },
  },
  'Chuyên Gia Nuôi Thú': {
    description: `Nuôi thú ảo lên cấp ${BADGE_RULES.petLevel}`,
    criteria: { type: 'PET_LEVEL', threshold: BADGE_RULES.petLevel },
  },
};

/** The badges whose rule the facts meet. */
export function qualifyingBadges(f: BadgeFacts): string[] {
  const out: string[] = [];
  if (f.totalXp >= BADGE_RULES.rookieXp) out.push('Tân Binh');
  if (f.totalXp >= BADGE_RULES.hunterXp) out.push('Thợ Săn');
  if (f.streak >= BADGE_RULES.streakDays) out.push('Chăm Chỉ');
  if (f.isWeeklyTop && f.weeklyXp >= BADGE_RULES.starWeeklyXp)
    out.push('Siêu Sao');
  if (f.perfectPractices >= BADGE_RULES.perfectPractices) out.push('Học Bá');
  if (f.highSpeaking >= BADGE_RULES.highSpeaking) out.push('Giọng Đọc Vàng');
  if (f.longestArenaWinStreak >= BADGE_RULES.arenaWinStreak)
    out.push('Đấu Sĩ Bất Bại');
  if (f.petLevel >= BADGE_RULES.petLevel) out.push('Chuyên Gia Nuôi Thú');
  return out;
}

/** A speaking score of 8/10 or more; legacy rows on a 0-100 scale need 80. */
export function isHighSpeakingScore(score: number | null | undefined): boolean {
  if (typeof score !== 'number' || !Number.isFinite(score)) return false;
  return score <= 10 ? score >= 8 : score >= 80;
}

/**
 * Different practices with at least one attempt where every answer was
 * correct. An attempt with no graded answer does not count.
 */
export function countPerfectPractices(
  attempts: { quizId: number; results: { isCorrect: boolean | null }[] }[],
): number {
  const perfect = new Set<number>();
  for (const a of attempts) {
    if (a.results.length > 0 && a.results.every((r) => r.isCorrect === true))
      perfect.add(a.quizId);
  }
  return perfect.size;
}

/** Different speaking exercises with at least one high score. */
export function countHighSpeaking(
  attempts: { exerciseId: number; overallScore: number | null }[],
): number {
  const high = new Set<number>();
  for (const a of attempts) {
    if (isHighSpeakingScore(a.overallScore)) high.add(a.exerciseId);
  }
  return high.size;
}
