/**
 * Filters, sorts and header counts for the skill CMS list screens (listening,
 * reading, writing quizzes and speaking sets), run on the server so a list
 * page loads one page, not every item. The rules match the admin screens'
 * former browser-side ones (FE `skillCmsStatus.ts`). No I/O.
 */
import { isAll, ListQuery, matchesSearch } from '../../common/paging/list-page';
import { PRACTICE_LEVELS } from '../subscription/practice-level';

export type AudioTone = 'ok' | 'pending' | 'error' | 'none';
export type ListeningMode = 'COMPREHENSION' | 'DICTATION' | 'DIALOGUE';

export const LISTENING_MODES: ListeningMode[] = [
  'COMPREHENSION',
  'DICTATION',
  'DIALOGUE',
];

const AUDIO_TONE: Record<string, AudioTone> = {
  PUBLISHED: 'ok',
  APPROVED: 'pending',
  PREVIEW_READY: 'pending',
  GENERATING: 'pending',
  STALE: 'pending',
  FAILED: 'error',
};

const PER_QUESTION_MODES: ListeningMode[] = ['COMPREHENSION', 'DICTATION'];

/** What a Writing exercise is, for the CMS filter and card label (owner 2026-11-19). */
export type WritingKind = 'TRANSLATION' | 'PICTURE' | 'SENTENCE' | 'EMAIL';
export const WRITING_KINDS: WritingKind[] = [
  'TRANSLATION',
  'PICTURE',
  'SENTENCE',
  'EMAIL',
];

const PICTURE_TASK_TYPES = ['PICTURE_SENTENCE', 'DESCRIBE_PICTURE'];

/** The kind the admin picked, as saved in bilingualContent.writingKind. */
export function storedWritingKind(bilingualContent: unknown) {
  const kind = (bilingualContent as { writingKind?: unknown } | null)
    ?.writingKind;
  return WRITING_KINDS.includes(kind as WritingKind)
    ? (kind as WritingKind)
    : undefined;
}

/**
 * "Dịch câu" is stored on WRITING_PICTURE under its own topic, so the quiz
 * type alone cannot tell it from a picture exercise: the filter "Viết theo
 * tranh" used to list 8 translation exercises among 11.
 *
 * The kind saved with the exercise comes first (QA 2026-11-22: an empty
 * "Viết câu" reopened as "Viết theo tranh"), when it fits the quiz type.
 * Without one, the kind is read from the tasks; an exercise with no task yet
 * is a picture one, as the form treats it.
 */
export function writingKindOf(row: {
  type?: string | null;
  stored?: WritingKind;
  isTranslation?: boolean;
  taskTypes?: string[];
  hasImage?: boolean;
  /** How many tasks the exercise has; 0 reads as a picture exercise. */
  questionCount?: number;
}): WritingKind {
  const email = row.type === 'WRITING_EMAIL';
  if (row.stored && (row.stored === 'EMAIL') === email) return row.stored;
  const taskTypes = (row.taskTypes ?? []).map((t) => t.toUpperCase());
  if (row.isTranslation || taskTypes.includes('SENTENCE_TRANSLATION'))
    return 'TRANSLATION';
  if (email) return 'EMAIL';
  if (
    row.hasImage ||
    row.questionCount === 0 ||
    taskTypes.some((t) => PICTURE_TASK_TYPES.includes(t))
  )
    return 'PICTURE';
  return 'SENTENCE';
}

/**
 * A hand-made "Hội thoại" quiz keeps its turns in one DIALOGUE question, a
 * transcript holder, not a question a learner answers. AI-made dialogue
 * quizzes have none; counts leave it out so both read the same.
 */
export const isTranscriptHolder = (question: { type?: string | null }) =>
  question.type === 'DIALOGUE';

/** Each quiz's task types, from its question rows. */
export function taskTypesByQuiz(
  rows: Array<{ quizId: number | null; content: unknown }>,
) {
  const types = new Map<number, string[]>();
  for (const { quizId, content } of rows) {
    const taskType = (content as { taskType?: unknown } | null)?.taskType;
    if (quizId == null || typeof taskType !== 'string' || !taskType.trim())
      continue;
    types.set(quizId, [...(types.get(quizId) ?? []), taskType.trim()]);
  }
  return types;
}

export type QuizListRow = {
  id: number;
  tracks?: string[];
  title?: string | null;
  description?: string | null;
  level?: string | null;
  /** The quiz's practice level (owner 2026-11-27). */
  practiceLevel?: string | null;
  type?: string | null;
  publicationStatus?: string | null;
  bilingualContent?: unknown;
  questionsWithAudio?: number;
  /** A hand-made dialogue's transcript holder has an active clip. */
  dialogueAudio?: boolean;
  _count?: { questions?: number };
  listeningAudioArtifacts?: Array<{ version: number; status: string }>;
  writingKind?: WritingKind;
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
 * dictation, the newest shared recording otherwise. A dialogue without one
 * can still play a clip on each question.
 */
export function audioToneOf(row: QuizListRow): AudioTone {
  const mode = (row.bilingualContent as { mode?: unknown } | null)?.mode;
  const withAudio = row.questionsWithAudio ?? 0;
  const latest = row.listeningAudioArtifacts?.[0];
  // A hand-made dialogue plays the clip on its transcript holder when it has
  // no shared recording (QA 2026-11-22: it read "none" with its audio there).
  if (mode === 'DIALOGUE' && !latest && row.dialogueAudio) return 'ok';
  if (
    PER_QUESTION_MODES.includes(mode as ListeningMode) ||
    (!latest && withAudio > 0)
  ) {
    const total = row._count?.questions ?? 0;
    if (!total || !withAudio) return 'none';
    return withAudio === total ? 'ok' : 'pending';
  }
  if (!latest) return 'none';
  return AUDIO_TONE[latest.status] ?? 'pending';
}

/** The level tag authored at the head of a title ("Hội thoại C1 — ..."). */
export function levelFromTitle(title?: string | null) {
  const head = (title ?? '').split(' — ')[0].toUpperCase();
  return /\b([ABC][12])\b/.exec(head)?.[1] ?? null;
}

/** The level a card shows and the filter reads: the stored practice level. */
export const contentLevel = (row: { practiceLevel?: string | null }) =>
  row.practiceLevel ?? null;

/** The title as a card shows it, without the "Hội thoại C1 — " head. */
export function displayTitle(row: { title?: string | null }) {
  const title = String(row.title ?? '');
  return levelFromTitle(title) && title.includes(' — ')
    ? title.split(' — ').slice(1).join(' — ')
    : title;
}

const levelRank = (level: string | null | undefined) => {
  const index = (PRACTICE_LEVELS as readonly string[]).indexOf(level ?? '');
  return index < 0 ? PRACTICE_LEVELS.length : index;
};

/**
 * Quizzes after search, status, level, audio, listening mode and writing
 * type filters, in the chosen order (NEWEST by default).
 */
/** One career track, or `UNTAGGED` for what still needs tagging. */
function matchesTrack(tracks: string[] | undefined, track?: string) {
  if (isAll(track)) return true;
  const tags = tracks ?? [];
  return track === 'UNTAGGED' ? tags.length === 0 : tags.includes(track!);
}

/** Vietnamese titles live in the frontend, which sends the ids they match. */
const hasTitleId = (query: ListQuery, id: string | number) =>
  String(query.titleIds ?? '')
    .split(',')
    .includes(String(id));

export function filterQuizList<T extends QuizListRow>(
  rows: T[],
  query: ListQuery,
): T[] {
  const visible = rows.filter(
    (row) =>
      (matchesSearch(
        query.q,
        row.title,
        row.description,
        row.level,
        row.type,
      ) ||
        hasTitleId(query, row.id)) &&
      (isAll(query.status) ||
        (row.publicationStatus || 'DRAFT') === query.status) &&
      (isAll(query.level) || contentLevel(row) === query.level) &&
      (isAll(query.audio) || audioToneOf(row) === query.audio) &&
      (isAll(query.mode) || listeningModeOf(row) === query.mode) &&
      (isAll(query.type) || row.type === query.type) &&
      (isAll(query.kind) || row.writingKind === query.kind) &&
      matchesTrack(row.tracks, query.track),
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

/**
 * Header and tab counts over the whole domain, not the filtered rows. Writing
 * also counts each kind (writingKindOf, set on the rows by the service) for
 * the "Dạng bài" select.
 */
export function quizListFacets(
  rows: QuizListRow[],
  options: { writing?: boolean } = {},
) {
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
    levels: PRACTICE_LEVELS.filter((level) =>
      rows.some((row) => contentLevel(row) === level),
    ),
    ...(options.writing
      ? {
          kinds: Object.fromEntries(
            WRITING_KINDS.map((kind) => [
              kind,
              rows.filter((row) => row.writingKind === kind).length,
            ]),
          ) as Record<WritingKind, number>,
        }
      : {}),
  };
}

export type SpeakingSetRow = {
  id: string;
  tracks?: string[];
  title: string;
  description?: string | null;
  level?: string | null;
  publicationStatus?: string | null;
  createdAt?: Date | string | null;
  exerciseCount: number;
};

/** Speaking set levels in order; an unknown one sorts last. */
const speakingLevelRank = levelRank;

/**
 * Speaking sets after search, level, status and track, newest first. The old
 * category filter is gone: Phân loại folded into Lĩnh vực (2026-11-21).
 */
export function filterSpeakingSets<T extends SpeakingSetRow>(
  rows: T[],
  query: ListQuery,
): T[] {
  const visible = rows.filter(
    (row) =>
      (matchesSearch(query.q, row.title, row.description) ||
        hasTitleId(query, row.id)) &&
      (isAll(query.level) || row.level === query.level) &&
      (isAll(query.status) || row.publicationStatus === query.status) &&
      matchesTrack(row.tracks, query.track),
  );
  // "Mới tạo trước" like the other lists: by creation, not by last edit.
  const created = (row: T) => new Date(row.createdAt ?? 0).getTime();
  const order: Record<string, (a: T, b: T) => number> = {
    NEWEST: (a, b) => created(b) - created(a),
    OLDEST: (a, b) => created(a) - created(b),
    TITLE: (a, b) => a.title.localeCompare(b.title, 'vi'),
    LEVEL: (a, b) =>
      speakingLevelRank(a.level) - speakingLevelRank(b.level) ||
      created(b) - created(a),
    FEWEST: (a, b) =>
      a.exerciseCount - b.exerciseCount || created(b) - created(a),
  };
  return visible.sort(order[query.sort ?? ''] ?? order.NEWEST);
}

export function speakingSetFacets(rows: SpeakingSetRow[]) {
  return {
    total: rows.length,
    published: rows.filter((row) => row.publicationStatus === 'PUBLISHED')
      .length,
    // In level order, as the quiz lists give theirs.
    levels: PRACTICE_LEVELS.filter((level) =>
      rows.some((row) => row.level === level),
    ),
  };
}

/** The first image of each quiz, from rows already sorted by question order. */
export function firstImageByQuiz(
  rows: Array<{ quizId: number | null; content: unknown }>,
) {
  const images = new Map<number, string>();
  for (const { quizId, content } of rows) {
    const imageUrl = (content as { imageUrl?: unknown } | null)?.imageUrl;
    if (quizId == null || images.has(quizId)) continue;
    if (typeof imageUrl === 'string' && imageUrl) images.set(quizId, imageUrl);
  }
  return images;
}

/** Why a picture card is missing from learners' Writing page, if it is. */
export function pictureCardHiddenReason(card: {
  publicationStatus?: string | null;
  hasPracticeTopic: boolean;
  imageUrl: string | null;
  keywords: string[];
}) {
  if (card.publicationStatus !== 'PUBLISHED') return 'bài chưa xuất bản';
  if (!card.hasPracticeTopic) return 'bài chưa thuộc chủ đề luyện viết';
  if (!card.imageUrl) return 'chưa có ảnh';
  if (card.keywords.length !== 2) return 'cần đúng 2 từ khoá';
  return null;
}
