/**
 * The daily study reminder (owner 2026-11-11): one reminder a day, sent at
 * the hour the learner usually studies, saying what is actually waiting for
 * them: the streak about to end, words due for review, open mistakes.
 *
 * It replaces the fixed 20:00 streak reminder. Nothing is sent to a learner
 * who has studied today, nothing between 22:00 and 07:00, and nothing when
 * there is no concrete thing to say. Written from templates; no AI.
 *
 * Pure: no Prisma, no I/O. Hours are Vietnam time (UTC+7, no daylight saving).
 */

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Notification type; one a day per learner. */
export const STUDY_REMINDER_TYPE = 'study_reminder';
/** Reminder kinds that share the "one push a day" allowance. */
export const STUDY_PUSH_TYPES = [STUDY_REMINDER_TYPE, 'vocab_review', 'streak'];

/** The hour used until a learner has a habit to read: the old fixed time. */
export const DEFAULT_REMINDER_HOUR = 20;
/** No reminder from 22:00 up to 07:00. */
export const QUIET_FROM_HOUR = 22;
export const QUIET_UNTIL_HOUR = 7;
/** A habit needs this much practice in the look-back window. */
export const HABIT_MIN_EVENTS = 5;
export const HABIT_MIN_DAYS = 3;
export const HABIT_LOOKBACK_DAYS = 28;
/** Learners who have not studied for longer than this get no daily reminder. */
export const ACTIVE_WITHIN_DAYS = 14;

export const vietnamHour = (date: Date): number =>
  new Date(date.getTime() + VN_OFFSET_MS).getUTCHours();

export const isQuietHour = (hour: number): boolean =>
  hour >= QUIET_FROM_HOUR || hour < QUIET_UNTIL_HOUR;

/**
 * The hour to remind a learner: the hour of the day they practised most
 * often in the look-back window (the earliest on a tie), moved out of the
 * quiet hours. With too little practice to call it a habit, the default.
 */
export function reminderHour(practisedAt: Date[]): number {
  const days = new Set(
    practisedAt.map((d) => Math.floor((d.getTime() + VN_OFFSET_MS) / DAY_MS)),
  );
  if (practisedAt.length < HABIT_MIN_EVENTS || days.size < HABIT_MIN_DAYS)
    return DEFAULT_REMINDER_HOUR;
  const perHour = new Array<number>(24).fill(0);
  for (const at of practisedAt) perHour[vietnamHour(at)] += 1;
  let best = 0;
  for (let hour = 1; hour < 24; hour += 1)
    if (perHour[hour] > perHour[best]) best = hour;
  if (best >= QUIET_FROM_HOUR) return QUIET_FROM_HOUR - 1;
  if (best < QUIET_UNTIL_HOUR) return QUIET_UNTIL_HOUR;
  return best;
}

export type StudyReminderFacts = {
  learnerName?: string | null;
  /** Days of the running streak; it ends tonight without practice. */
  streak: number;
  /** Words whose review time has come. */
  dueWords: number;
  /** Open mistakes in the notebook. */
  openMistakes: number;
};

/**
 * The reminder text, or null when nothing concrete is waiting. The link goes
 * to the first thing named.
 */
export function studyReminderMessage(
  facts: StudyReminderFacts,
): { title: string; body: string; url: string } | null {
  const streak = Math.max(0, Math.floor(facts.streak));
  const dueWords = Math.max(0, Math.floor(facts.dueWords));
  const openMistakes = Math.max(0, Math.floor(facts.openMistakes));
  if (!streak && !dueWords && !openMistakes) return null;

  const waiting: string[] = [];
  if (dueWords) waiting.push(`${dueWords} từ đến hạn ôn`);
  if (openMistakes) waiting.push(`${openMistakes} lỗi chưa khắc phục`);
  const name = facts.learnerName?.trim();
  const hello = name ? `Chào ${name}. ` : '';

  if (streak) {
    return {
      title: `Giữ chuỗi ${streak} ngày: hôm nay bạn chưa học`,
      body:
        `${hello}Học một bài trước nửa đêm để giữ chuỗi.` +
        (waiting.length ? ` Đang chờ bạn: ${waiting.join(', ')}.` : ''),
      url: '/dashboard',
    };
  }
  if (dueWords) {
    return {
      title: `${dueWords} từ đến hạn ôn hôm nay`,
      body:
        `${hello}Ôn đúng lúc giúp nhớ lâu hơn.` +
        (openMistakes ? ` Sổ lỗi còn ${openMistakes} lỗi chưa khắc phục.` : ''),
      url: '/flashcard',
    };
  }
  return {
    title: `${openMistakes} lỗi đang chờ bạn ôn`,
    body: `${hello}Mở Sổ lỗi và trả lời lại vài câu đã sai.`,
    url: '/mistakes',
  };
}
