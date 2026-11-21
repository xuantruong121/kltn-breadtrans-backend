/**
 * Rules for "Lĩnh vực", the career or study tracks admins manage (owner
 * 2026-11-21). No I/O. Code relies on one fixed track only: GENERAL, the
 * default every learner starts on. It can be renamed, but never
 * deactivated, deleted or given another code.
 */

export const GENERAL_TRACK = 'GENERAL';

/** A track code as stored and as clients send it. */
export const TRACK_CODE_PATTERN = /^[A-Z0-9_]{1,40}$/;
export const TRACK_CODE_MAX_LENGTH = 40;

/** Gap between two tracks after a reorder: 10, 20, 30, ... */
export const SORT_STEP = 10;

function stripDiacritics(value: string) {
  return value
    .replace(/[Đđ]/g, (char) => (char === 'Đ' ? 'D' : 'd'))
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * "Văn phòng – Kinh doanh" -> "VAN_PHONG_KINH_DOANH". An empty string when
 * nothing is left; the caller decides how to refuse it.
 */
export function normalizeTrackCode(value: string) {
  return stripDiacritics(value.trim())
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** The key that blocks duplicate names: no diacritics, lower case, single spaces. */
export function normalizeTrackName(value: string) {
  return stripDiacritics(value.trim())
    .toLocaleLowerCase('vi-VN')
    .replace(/\s+/g, ' ');
}

/**
 * The code of a new track: the one given, or one made from the name (cut
 * to 40 characters). Null when the given code is empty or too long once
 * normalised.
 */
export function newTrackCode(name: string, code?: string | null) {
  if (code !== undefined && code !== null && code.trim()) {
    const given = normalizeTrackCode(code);
    return TRACK_CODE_PATTERN.test(given) ? given : null;
  }
  const derived = normalizeTrackCode(name)
    .slice(0, TRACK_CODE_MAX_LENGTH)
    .replace(/_+$/, '');
  return TRACK_CODE_PATTERN.test(derived) ? derived : null;
}

export type TrackChange = 'deactivate' | 'delete' | 'changeCode';

/** Why a change to a track is refused, or null when it is allowed. */
export function trackChangeRefusal(
  code: string,
  change: TrackChange,
): string | null {
  // The code is the key that tags and learner choices point at.
  if (change === 'changeCode') return 'Mã lĩnh vực không đổi được sau khi tạo.';
  if (code !== GENERAL_TRACK) return null;
  return change === 'deactivate'
    ? 'Lĩnh vực mặc định luôn bật: học viên chưa chọn lĩnh vực dùng lĩnh vực này.'
    : 'Lĩnh vực mặc định không xoá được.';
}

/**
 * Codes a client may not add: not among the active ones and not already
 * held. A deactivated track stays on what already has it, but nothing new
 * can take it.
 */
export function unavailableTracks(
  requested: readonly string[],
  current: readonly string[],
  active: readonly string[],
) {
  const held = new Set(current);
  const open = new Set(active);
  return requested.filter((code) => !held.has(code) && !open.has(code));
}

/** True when `requested` holds every code of `current` exactly once. */
export function isPermutation(
  current: readonly string[],
  requested: readonly string[],
) {
  const known = new Set(current);
  return (
    requested.length === current.length &&
    new Set(requested).size === requested.length &&
    requested.every((code) => known.has(code))
  );
}

/** The sortOrder of the track at `index` after a reorder. */
export const sortOrderAt = (index: number) => (index + 1) * SORT_STEP;

/**
 * Where a new track goes: after every other track but before GENERAL when
 * GENERAL is last (it is seeded last). `generalSortOrder` is set when
 * GENERAL has to move down to stay last.
 */
export function newTrackSortOrder(
  tracks: ReadonlyArray<{ code: string; sortOrder: number }>,
): { sortOrder: number; generalSortOrder?: number } {
  const others = tracks.filter((track) => track.code !== GENERAL_TRACK);
  const general = tracks.find((track) => track.code === GENERAL_TRACK);
  const sortOrder =
    Math.max(0, ...others.map((track) => track.sortOrder)) + SORT_STEP;
  const generalIsLast =
    !!general && others.every((track) => track.sortOrder <= general.sortOrder);
  return generalIsLast && general.sortOrder <= sortOrder
    ? { sortOrder, generalSortOrder: sortOrder + SORT_STEP }
    : { sortOrder };
}

export type TrackUsage = {
  listening: number;
  reading: number;
  writing: number;
  speaking: number;
  learners: number;
};

export const EMPTY_USAGE: TrackUsage = {
  listening: 0,
  reading: 0,
  writing: 0,
  speaking: 0,
  learners: 0,
};

/** The skill a tagged quiz counts for; TOEIC types count for none. */
export function quizUsageSkill(
  type: string | null | undefined,
): 'listening' | 'reading' | 'writing' | null {
  if (type === 'LISTENING_PRACTICE') return 'listening';
  if (type === 'BILINGUAL_READING') return 'reading';
  if (type === 'WRITING_PICTURE' || type === 'WRITING_EMAIL') return 'writing';
  return null;
}

/**
 * Items and learners per track: quiz tags by the quiz's type, speaking set
 * tags, and learners who chose the track.
 */
export function buildTrackUsage(input: {
  codes: readonly string[];
  quizTags: ReadonlyArray<{ track: string; quizType: string | null }>;
  speakingSets: ReadonlyArray<{ track: string; count: number }>;
  learners: ReadonlyArray<{ track: string; count: number }>;
}) {
  const usage = new Map<string, TrackUsage>(
    input.codes.map((code) => [code, { ...EMPTY_USAGE }]),
  );
  const of = (code: string) => {
    const row = usage.get(code) ?? { ...EMPTY_USAGE };
    usage.set(code, row);
    return row;
  };
  for (const tag of input.quizTags) {
    const skill = quizUsageSkill(tag.quizType);
    if (skill) of(tag.track)[skill] += 1;
  }
  for (const row of input.speakingSets) of(row.track).speaking += row.count;
  for (const row of input.learners) of(row.track).learners += row.count;
  return usage;
}

export const isTrackUsed = (usage: TrackUsage) =>
  Object.values(usage).some((count) => count > 0);
