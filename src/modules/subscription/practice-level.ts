/**
 * Owner access policy for STANDALONE skill practice (Listening, Reading,
 * Speaking, Writing), decided from the content's practice level:
 *   Reading → free;
 *   Listening → free, except dictation at Trung cấp and above (PLUS);
 *   Speaking, Writing → Mất gốc and Cơ bản free, Trung cấp PLUS, Nâng cao PRO.
 * PRO includes PLUS.
 *
 * Since 2026-11-27 (owner) every content table stores one of the four
 * practice levels: `Quiz.practiceLevel`, `SpeakingPracticeSet.level`,
 * `SpeakingExercise.difficulty`, `VocabTopic.level`, `GrammarTopic.level`.
 * They are BreadTrans practice levels, not CEFR levels. A practice with no
 * level is "unknown", which callers must never treat as free.
 *
 * The CEFR tags that titles still carry ("Listening B1 — …") are no longer
 * read at run time; `legacyPracticeLevel` converts them for seed data and
 * scripts, with the same table as the migration.
 */
import type { PracticeLevel } from '@prisma/client';

/** The four practice levels, in order. */
export const PRACTICE_LEVELS = [
  'STARTER',
  'BASIC',
  'INTERMEDIATE',
  'ADVANCED',
] as const satisfies readonly PracticeLevel[];

export const PRACTICE_LEVEL_LABEL: Record<PracticeLevel, string> = {
  STARTER: 'Mất gốc',
  BASIC: 'Cơ bản',
  INTERMEDIATE: 'Trung cấp',
  ADVANCED: 'Nâng cao',
};

export function isPracticeLevel(value: unknown): value is PracticeLevel {
  return (PRACTICE_LEVELS as readonly unknown[]).includes(value);
}

/** 0 for STARTER up to 3 for ADVANCED. */
export function practiceLevelRank(level: PracticeLevel): number {
  return PRACTICE_LEVELS.indexOf(level);
}

/** "Trung cấp"; null for an item with no level. */
export function practiceLevelLabel(
  level: PracticeLevel | null | undefined,
): string | null {
  return level ? PRACTICE_LEVEL_LABEL[level] : null;
}

// ---------------------------------------------------------------------------
// Legacy CEFR tags: seed data, scripts and the migration only.
// ---------------------------------------------------------------------------

export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export type Cefr = (typeof CEFR_LEVELS)[number];
export type CefrRange = { min: Cefr; max: Cefr };

const rank = (level: Cefr) => CEFR_LEVELS.indexOf(level);
const TAG = /\b([ABC][12])(?:\s*[–-]\s*([ABC][12]))?\b/;

/** "B1", "A1–A2", "B1-C1", "Listening B1 — Work" → range; null when no tag. */
export function parseCefrRange(
  value: string | null | undefined,
): CefrRange | null {
  if (!value) return null;
  // A title carries its tag in the head ("Listening B1 — Work"); a level
  // field ("A1-A2") has no separator, so the whole value is the head.
  const head = value.split(' — ')[0];
  const match = TAG.exec(head.toUpperCase());
  if (!match) return null;
  const a = match[1] as Cefr;
  const b = (match[2] ?? match[1]) as Cefr;
  return rank(a) <= rank(b) ? { min: a, max: b } : { min: b, max: a };
}

/**
 * A level written the old way, as a CEFR tag, a CEFR range, a title head
 * ("Listening B1 — Work") or BEGINNER, read as a practice level. Same table as
 * migration 20261127120000_unify_practice_levels, agreed with the owner:
 *   A1, A1-A2 → STARTER; A2 → BASIC; B1, B2 and ranges up to B2 →
 *   INTERMEDIATE; any range reaching C1 → ADVANCED; BEGINNER → BASIC.
 * A practice level passes through. Null when nothing can be read.
 */
export function legacyPracticeLevel(
  value: string | null | undefined,
): PracticeLevel | null {
  const raw = value?.trim().toUpperCase() ?? '';
  if (!raw) return null;
  if (isPracticeLevel(raw)) return raw;
  if (raw === 'BEGINNER') return 'BASIC';
  const range = parseCefrRange(raw);
  if (!range) return null;
  if (rank(range.max) >= rank('C1')) return 'ADVANCED';
  if (range.min === 'A1' && rank(range.max) <= rank('A2')) return 'STARTER';
  if (range.min === 'A2' && range.max === 'A2') return 'BASIC';
  return 'INTERMEDIATE';
}

// ---------------------------------------------------------------------------
// Titles
// ---------------------------------------------------------------------------

/**
 * The head word of a Listening lesson's stored title, by its form (owner
 * 2026-11-24: "lưu theo dạng đã chọn"), as the published dialogues already
 * read ("Hội thoại A2 — …"). Learners never see the head (withoutLevelTag).
 */
export function listeningTitleLabel(mode: unknown): string {
  if (mode === 'DIALOGUE') return 'Hội thoại';
  if (mode === 'DICTATION') return 'Nghe chép';
  if (mode === 'COMPREHENSION') return 'Nghe hiểu';
  return 'Listening';
}

/**
 * "Listening A2 — Work" with label "Nghe hiểu" → "Nghe hiểu A2 — Work". The
 * old level head of a published title is kept as written (titles are looked
 * up by their text); a title with no level head is left alone.
 */
export function relabelTitleHead(title: string, label: string): string {
  const at = title.indexOf(' — ');
  if (at < 0) return title;
  const level = title
    .slice(0, at)
    .match(/\b[ABC][12](?:\s*[–-]\s*[ABC][12])?\b/i)?.[0];
  if (!level) return title;
  return `${label} ${level.toUpperCase()} — ${title.slice(at + 3)}`;
}

/**
 * The title an edit saves. An old published title keeps its level head
 * ("Listening B1 — Work" edited to "Work Day" stays "Listening B1 — Work
 * Day"): learner titles and the starter roadmap look titles up by their text.
 * A title the admin wrote with its own head is saved as written.
 */
export function keepTitleHead(previous: string, next: string): string {
  if (next.includes(' — ')) return next;
  const at = previous.indexOf(' — ');
  if (at < 0) return next;
  const head = previous.slice(0, at);
  if (!/\b[ABC][12]\b/i.test(head)) return next;
  return `${head} — ${next}`;
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export type PracticeSkill = 'LISTENING' | 'READING' | 'SPEAKING' | 'WRITING';
export type PracticePlan = 'FREE' | 'PLUS' | 'PRO';

const PLAN_RANK: Record<PracticePlan, number> = { FREE: 0, PLUS: 1, PRO: 2 };

/**
 * Owner policy (2026-10-30, in practice levels since 2026-11-27) for
 * standalone skill practice. PRO includes PLUS.
 *   Reading                        every level FREE
 *   Listening                      every level FREE, except dictation
 *                                  ("Nghe chép") at INTERMEDIATE or ADVANCED: PLUS
 *   Speaking / Writing STARTER, BASIC  FREE
 *   Speaking / Writing INTERMEDIATE    PLUS
 *   Speaking / Writing ADVANCED        PRO
 * The plans are those of the CEFR era: B1 and above was INTERMEDIATE or
 * ADVANCED, and every range reaching C1 is ADVANCED.
 * TOEIC and the Entry Diagnostic have their own rules.
 */
export function requiredPracticePlan(
  skill: PracticeSkill,
  level: PracticeLevel,
  options: { dictation?: boolean } = {},
): PracticePlan {
  const upper = practiceLevelRank(level) >= practiceLevelRank('INTERMEDIATE');
  if (skill === 'READING') return 'FREE';
  if (skill === 'LISTENING')
    return options.dictation && upper ? 'PLUS' : 'FREE';
  if (level === 'ADVANCED') return 'PRO';
  return upper ? 'PLUS' : 'FREE';
}

/**
 * Plan for a premium item with no level: the highest plan its skill can
 * need, so a missing level never opens anything.
 */
export function advancedPracticePlan(skill: PracticeSkill): PracticePlan {
  if (skill === 'READING') return 'FREE';
  return skill === 'LISTENING' ? 'PLUS' : 'PRO';
}

/** A Listening quiz authored as dictation (stored in bilingualContent.mode). */
export function isDictationContent(bilingualContent: unknown): boolean {
  return (
    !!bilingualContent &&
    typeof bilingualContent === 'object' &&
    (bilingualContent as { mode?: unknown }).mode === 'DICTATION'
  );
}

/** Rank of a plan code; an unknown code ranks as FREE (fail closed). */
export function planRank(code: string | null | undefined): number {
  return PLAN_RANK[code as PracticePlan] ?? 0;
}

export function planSatisfies(
  userPlanCode: string | null | undefined,
  required: PracticePlan,
): boolean {
  return planRank(userPlanCode) >= PLAN_RANK[required];
}
