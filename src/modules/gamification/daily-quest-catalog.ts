/**
 * Daily quests (owner decision 2026-11-03): every day each learner gets three
 * quests drawn from this pool, fixed for the day and different the next day.
 * The pool is the source of truth for titles, targets and rewards; a
 * DailyQuest row only anchors UserQuestProgress (found by type, created when
 * missing). Pure: no Prisma, no I/O.
 *
 * Every quest counts only practice that is itself rewarded
 * (reward-eligibility.ts). One activity advances at most one speaking quest:
 * free speech counts for "Luyện Speaking", read-aloud and pronunciation drills
 * for "Thực hành phát âm".
 */
import { createHash } from 'node:crypto';

export type DailyQuestType =
  | 'DO_LISTENING'
  | 'DO_READING'
  | 'DO_WRITING'
  | 'DO_SPEAKING'
  | 'PRACTICE_SPEAKING'
  | 'PERFECT_QUIZ';

export type DailyQuestDefinition = {
  type: DailyQuestType;
  title: string;
  description: string;
  targetValue: number;
  rewardXP: number;
  rewardBanh: number;
};

export const DAILY_QUEST_POOL: readonly DailyQuestDefinition[] = [
  {
    type: 'DO_LISTENING',
    title: 'Luyện nghe 1 bài',
    description: 'Hoàn thành một bài luyện Nghe',
    targetValue: 1,
    rewardXP: 20,
    rewardBanh: 8,
  },
  {
    type: 'DO_READING',
    title: 'Luyện đọc 1 bài',
    description: 'Hoàn thành một bài luyện Đọc',
    targetValue: 1,
    rewardXP: 20,
    rewardBanh: 8,
  },
  {
    type: 'DO_WRITING',
    title: 'Luyện viết 1 bài',
    description: 'Nộp một bài luyện Viết',
    targetValue: 1,
    rewardXP: 20,
    rewardBanh: 8,
  },
  {
    type: 'DO_SPEAKING',
    title: 'Luyện Speaking',
    description:
      'Nộp một bài nói tự do: trả lời câu hỏi, tả tranh hoặc nêu ý kiến',
    targetValue: 1,
    rewardXP: 25,
    rewardBanh: 10,
  },
  {
    type: 'PRACTICE_SPEAKING',
    title: 'Thực hành phát âm',
    description: 'Hoàn thành 3 bài đọc to hoặc luyện phát âm',
    targetValue: 3,
    rewardXP: 25,
    rewardBanh: 10,
  },
  {
    type: 'PERFECT_QUIZ',
    title: 'Làm đúng 100% một bài',
    description: 'Đạt điểm tuyệt đối ở một bài luyện Nghe hoặc Đọc',
    targetValue: 1,
    rewardXP: 30,
    rewardBanh: 12,
  },
];

export const DAILY_QUESTS_PER_DAY = 3;

const SPEAKING_QUESTS: readonly DailyQuestType[] = [
  'DO_SPEAKING',
  'PRACTICE_SPEAKING',
];

export function questDefinition(type: string): DailyQuestDefinition | null {
  return DAILY_QUEST_POOL.find((quest) => quest.type === type) ?? null;
}

/**
 * The learner's quests for one day: a stable shuffle seeded by user and day,
 * keeping at most one speaking quest (speaking grading allows 10 a day).
 */
export function questsForDay(
  userId: number,
  dateKey: string,
): DailyQuestDefinition[] {
  const ranked = [...DAILY_QUEST_POOL]
    .map((quest) => ({
      quest,
      rank: createHash('sha256')
        .update(`${userId}:${dateKey}:${quest.type}`)
        .digest('hex'),
    }))
    .sort((a, b) => a.rank.localeCompare(b.rank))
    .map((row) => row.quest);
  const picked: DailyQuestDefinition[] = [];
  for (const quest of ranked) {
    if (picked.length === DAILY_QUESTS_PER_DAY) break;
    if (
      SPEAKING_QUESTS.includes(quest.type) &&
      picked.some((other) => SPEAKING_QUESTS.includes(other.type))
    )
      continue;
    picked.push(quest);
  }
  return picked;
}

/** Quests a finished rewarded quiz advances. */
export function questTypesForQuiz(
  quizType: string | undefined,
  score: number,
): DailyQuestType[] {
  const types: DailyQuestType[] = [];
  if (quizType === 'LISTENING_PRACTICE') types.push('DO_LISTENING');
  if (quizType === 'BILINGUAL_READING') types.push('DO_READING');
  if (quizType === 'WRITING_EMAIL' || quizType === 'WRITING_PICTURE')
    types.push('DO_WRITING');
  if (
    score >= 100 &&
    (quizType === 'LISTENING_PRACTICE' || quizType === 'BILINGUAL_READING')
  )
    types.push('PERFECT_QUIZ');
  return types;
}

const PRONUNCIATION_TASKS = ['READ_ALOUD', 'PRONUNCIATION_DRILL'];

/** The one speaking quest a rewarded speaking exercise advances. */
export function questTypeForSpeaking(
  taskType: string | null | undefined,
): DailyQuestType | null {
  if (!taskType) return null;
  return PRONUNCIATION_TASKS.includes(taskType)
    ? 'PRACTICE_SPEAKING'
    : 'DO_SPEAKING';
}
