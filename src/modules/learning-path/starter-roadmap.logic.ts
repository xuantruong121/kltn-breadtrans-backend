/**
 * The Mất gốc starter path (F5.4): a curated order of foundation, listening,
 * speaking, reading and writing. It is data, so changing the path never
 * touches the screen. Items are named by title or set id, which outlive
 * database ids. No Prisma, no I/O.
 */
export type RoadmapRef =
  | { kind: 'GRAMMAR'; title: string }
  | { kind: 'VOCAB'; title: string }
  | { kind: 'QUIZ'; title: string }
  | { kind: 'SPEAKING_SET'; id: string };

export type RoadmapStep = {
  key: string;
  title: string;
  why: string;
  minutes: number;
  ref: RoadmapRef;
};

export const STARTER_ROADMAP: RoadmapStep[] = [
  {
    key: 'grammar-present',
    title: 'Thì hiện tại đơn',
    why: 'Nền tảng để nói về việc hằng ngày.',
    minutes: 10,
    ref: { kind: 'GRAMMAR', title: 'Present Simple & Adverbs of Frequency' },
  },
  {
    key: 'vocab-daily',
    title: 'Từ vựng sinh hoạt hằng ngày',
    why: 'Những từ gặp nhiều nhất ở các bài sau.',
    minutes: 10,
    ref: { kind: 'VOCAB', title: 'Daily Routines & Time' },
  },
  {
    key: 'listening-a1',
    title: 'Nghe câu ngắn',
    why: 'Làm quen với giờ giấc, địa điểm và việc thường ngày.',
    minutes: 10,
    ref: { kind: 'QUIZ', title: 'Listening A1 — Essential Everyday English' },
  },
  {
    key: 'dictation-a1',
    title: 'Nghe và chép lại',
    why: 'Tập nghe rõ từng từ trong câu.',
    minutes: 15,
    ref: { kind: 'QUIZ', title: 'Nghe chép A1 — Tin nhắn hằng ngày' },
  },
  {
    key: 'grammar-past',
    title: 'Thì quá khứ đơn',
    why: 'Kể lại việc đã xảy ra.',
    minutes: 10,
    ref: { kind: 'GRAMMAR', title: 'Past Simple & Time Expressions' },
  },
  {
    key: 'read-aloud',
    title: 'Đọc thành tiếng',
    why: 'Tập phát âm và nhịp câu.',
    minutes: 10,
    ref: { kind: 'SPEAKING_SET', id: 'practice-read-aloud-a1-a2' },
  },
  {
    key: 'reading-a1',
    title: 'Đọc văn bản ngắn',
    why: 'Tìm thông tin trong thông báo và tin nhắn.',
    minutes: 10,
    ref: { kind: 'QUIZ', title: 'Reading A1–A2 — Everyday Texts' },
  },
  {
    key: 'picture-sentences',
    title: 'Viết câu theo tranh',
    why: 'Tự viết câu đầu tiên từ hai từ gợi ý.',
    minutes: 15,
    ref: {
      kind: 'QUIZ',
      title: 'Viết câu theo tranh: đời sống và dịch vụ (A2)',
    },
  },
];

/** What the database says about one step; absent when it is not published. */
export type StepFacts = { route: string; done: boolean; locked: boolean };

/** A step whose item is gone drops out instead of leaving a dead link. */
export function buildRoadmap(
  steps: RoadmapStep[],
  factsOf: (step: RoadmapStep) => StepFacts | undefined,
) {
  const items = steps.flatMap(({ ref: _ref, ...step }) => {
    const facts = factsOf({ ...step, ref: _ref });
    return facts ? [{ ...step, ...facts }] : [];
  });
  return {
    steps: items,
    done: items.filter((step) => step.done).length,
    total: items.length,
    nextKey: items.find((step) => !step.done && !step.locked)?.key ?? null,
  };
}

/** A deck counts once half its words have been studied. */
export const deckDone = (studied: number, words: number) =>
  words > 0 && studied * 2 >= words;
