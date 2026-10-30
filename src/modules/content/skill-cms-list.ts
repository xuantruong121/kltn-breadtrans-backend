/**
 * Filters, sorts and header counts for the skill CMS list screens (listening,
 * reading, writing quizzes and speaking sets), run on the server so a list
 * page loads one page, not every item. The rules match the admin screens'
 * former browser-side ones (FE `skillCmsStatus.ts`). No I/O.
 */
import { isAll, ListQuery, matchesSearch } from '../../common/paging/list-page';

export type AudioTone = 'ok' | 'pending' | 'error' | 'none';
export type ListeningMode = 'COMPREHENSION' | 'DICTATION' | 'DIALOGUE';

export const LISTENING_MODES: ListeningMode[] = [
  'COMPREHENSION',
  'DICTATION',
  'DIALOGUE',
];

const CMS_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

const AUDIO_TONE: Record<string, AudioTone> = {
  PUBLISHED: 'ok',
  APPROVED: 'pending',
  PREVIEW_READY: 'pending',
  GENERATING: 'pending',
  STALE: 'pending',
  FAILED: 'error',
};

const PER_QUESTION_MODES: ListeningMode[] = ['COMPREHENSION', 'DICTATION'];

export type QuizListRow = {
  id: number;
  title?: string | null;
  description?: string | null;
  level?: string | null;
  type?: string | null;
  publicationStatus?: string | null;
  bilingualContent?: unknown;
  questionsWithAudio?: number;
  _count?: { questions?: number };
  listeningAudioArtifacts?: Array<{ version: number; status: string }>;
};

/** A listening quiz's form; anything unknown is a comprehension quiz. */
export function listeningModeOf(row: { bilingualContent?: unknown }) {
  const mode = (row.bilingualContent as { mode?: unknown } | null)?.mode;
  return mode === 'DICTATION' || mode === 'DIALOGUE'
    ? mode
    : ('COMPREHENSION' as ListeningMode);
}

/**
 * The audio state a card shows: per-question clips for comprehension and
 * dictation, the newest shared recording otherwise.
 */
export function audioToneOf(row: QuizListRow): AudioTone {
  const mode = (row.bilingualContent as { mode?: unknown } | null)?.mode;
  if (PER_QUESTION_MODES.includes(mode as ListeningMode)) {
    const total = row._count?.questions ?? 0;
    const withAudio = row.questionsWithAudio ?? 0;
    if (!total || !withAudio) return 'none';
    return withAudio === total ? 'ok' : 'pending';
  }
  const latest = row.listeningAudioArtifacts?.[0];
  if (!latest) return 'none';
  return AUDIO_TONE[latest.status] ?? 'pending';
}

/** The level tag authored at the head of a title ("Hội thoại C1 — ..."). */
export function levelFromTitle(title?: string | null) {
  const head = (title ?? '').split(' — ')[0].toUpperCase();
  return /\b([ABC][12])\b/.exec(head)?.[1] ?? null;
}

export const contentLevel = (row: {
  title?: string | null;
  level?: string | null;
}) => levelFromTitle(row.title) ?? row.level ?? null;

/** The title as a card shows it, without the "Hội thoại C1 — " head. */
export function displayTitle(row: { title?: string | null }) {
  const title = String(row.title ?? '');
  return levelFromTitle(title) && title.includes(' — ')
    ? title.split(' — ').slice(1).join(' — ')
    : title;
}

const levelRank = (level: string | null) => {
  const index = CMS_LEVELS.indexOf(level ?? '');
  return index < 0 ? CMS_LEVELS.length : index;
};

/**
 * Quizzes after search, status, level, audio, listening mode and writing
 * type filters, in the chosen order (NEWEST by default).
 */
export function filterQuizList<T extends QuizListRow>(
  rows: T[],
  query: ListQuery,
): T[] {
  const visible = rows.filter(
    (row) =>
      matchesSearch(query.q, row.title, row.description, row.level, row.type) &&
      (isAll(query.status) ||
        (row.publicationStatus || 'DRAFT') === query.status) &&
      (isAll(query.level) || contentLevel(row) === query.level) &&
      (isAll(query.audio) || audioToneOf(row) === query.audio) &&
      (isAll(query.mode) || listeningModeOf(row) === query.mode) &&
      (isAll(query.type) || row.type === query.type),
  );
  const questions = (row: T) => row._count?.questions ?? 0;
  const order: Record<string, (a: T, b: T) => number> = {
    NEWEST: (a, b) => b.id - a.id,
    OLDEST: (a, b) => a.id - b.id,
    TITLE: (a, b) => displayTitle(a).localeCompare(displayTitle(b), 'vi'),
    LEVEL: (a, b) =>
      levelRank(contentLevel(a)) - levelRank(contentLevel(b)) || b.id - a.id,
    FEWEST: (a, b) => questions(a) - questions(b) || b.id - a.id,
  };
  return visible.sort(order[query.sort ?? ''] ?? order.NEWEST);
}

/** Header and tab counts over the whole domain, not the filtered rows. */
export function quizListFacets(rows: QuizListRow[]) {
  return {
    total: rows.length,
    published: rows.filter((row) => row.publicationStatus === 'PUBLISHED')
      .length,
    modes: Object.fromEntries(
      LISTENING_MODES.map((mode) => [
        mode,
        rows.filter((row) => listeningModeOf(row) === mode).length,
      ]),
    ) as Record<ListeningMode, number>,
    levels: CMS_LEVELS.filter((level) =>
      rows.some((row) => contentLevel(row) === level),
    ),
  };
}

export type SpeakingSetRow = {
  id: string;
  title: string;
  description?: string | null;
  category?: string | null;
  level?: string | null;
  publicationStatus?: string | null;
  updatedAt?: Date | string | null;
  exerciseCount: number;
};

/** Speaking levels are CEFR or the course scale; unknown ones sort last. */
function speakingLevelRank(level?: string | null) {
  const cefr = /([ABC][12])/.exec(String(level ?? '').toUpperCase())?.[1];
  if (cefr) return CMS_LEVELS.indexOf(cefr);
  return (
    ({ BEGINNER: 0, INTERMEDIATE: 2, ADVANCED: 4 } as Record<string, number>)[
      String(level)
    ] ?? 9
  );
}

/** Speaking sets after search, level, category and status, newest first. */
export function filterSpeakingSets<T extends SpeakingSetRow>(
  rows: T[],
  query: ListQuery,
): T[] {
  const visible = rows.filter(
    (row) =>
      matchesSearch(query.q, row.title, row.description, row.category) &&
      (isAll(query.level) || row.level === query.level) &&
      (isAll(query.category) || row.category === query.category) &&
      (isAll(query.status) || row.publicationStatus === query.status),
  );
  const updated = (row: T) => new Date(row.updatedAt ?? 0).getTime();
  const order: Record<string, (a: T, b: T) => number> = {
    NEWEST: (a, b) => updated(b) - updated(a),
    TITLE: (a, b) => a.title.localeCompare(b.title, 'vi'),
    LEVEL: (a, b) =>
      speakingLevelRank(a.level) - speakingLevelRank(b.level) ||
      updated(b) - updated(a),
    FEWEST: (a, b) =>
      a.exerciseCount - b.exerciseCount || updated(b) - updated(a),
  };
  return visible.sort(order[query.sort ?? ''] ?? order.NEWEST);
}

export function speakingSetFacets(rows: SpeakingSetRow[]) {
  return {
    total: rows.length,
    published: rows.filter((row) => row.publicationStatus === 'PUBLISHED')
      .length,
    levels: [
      ...new Set(rows.map((row) => row.level).filter(Boolean) as string[]),
    ].sort(),
  };
}
