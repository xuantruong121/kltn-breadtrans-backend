/**
 * Links the weakest rubric criterion of the entry diagnostic to the kinds of
 * practice that train it (F26). A kind is a speaking task type or a writing
 * quiz type, so new content of that kind joins by itself. Pure: no I/O.
 */
import type { PracticeSkill } from '@prisma/client';

type ProductiveSkill = Extract<PracticeSkill, 'SPEAKING' | 'WRITING'>;

const FOCUS: Record<
  ProductiveSkill,
  Record<string, { label: string; kinds: string[] }>
> = {
  SPEAKING: {
    intelligibility: {
      label: 'phát âm',
      kinds: ['READ_ALOUD', 'PRONUNCIATION_DRILL'],
    },
    fluency: {
      label: 'nói trôi chảy',
      kinds: ['RESPOND_TO_QUESTION', 'EXPRESS_OPINION'],
    },
    task_fulfilment: {
      label: 'trả lời đủ ý',
      kinds: ['RESPOND_TO_QUESTION', 'RESPOND_USING_INFORMATION'],
    },
    language_use: {
      label: 'dùng từ và ngữ pháp khi nói',
      kinds: ['EXPRESS_OPINION', 'DESCRIBE_PICTURE'],
    },
  },
  WRITING: {
    task_achievement: {
      label: 'đáp ứng yêu cầu đề',
      kinds: ['WRITING_EMAIL'],
    },
    organisation: { label: 'bố cục bài viết', kinds: ['WRITING_EMAIL'] },
    vocabulary: { label: 'dùng từ khi viết', kinds: ['WRITING_PICTURE'] },
    grammar: { label: 'ngữ pháp khi viết', kinds: ['WRITING_PICTURE'] },
  },
};

export type WeakFocus = {
  skill: ProductiveSkill;
  label: string;
  kinds: string[];
};

export type GradedTask = {
  skill: ProductiveSkill;
  criteria: Record<string, number | null> | null | undefined;
};

/**
 * The lowest criterion of each skill. A criterion counts only when every
 * graded task reports it, and none stands out when all are equal, the same
 * rules the result page uses.
 */
/** The kinds of practice that train one rubric criterion; empty if unknown. */
export function focusKindsFor(
  skill: ProductiveSkill,
  criterion: string,
): string[] {
  return FOCUS[skill][criterion]?.kinds ?? [];
}

export function weakFocus(tasks: GradedTask[]): WeakFocus[] {
  const skills: ProductiveSkill[] = ['SPEAKING', 'WRITING'];
  return skills.flatMap((skill) => {
    const graded = tasks.filter((t) => t.skill === skill);
    const means = Object.keys(FOCUS[skill]).flatMap((key) => {
      const values = graded
        .map((t) => t.criteria?.[key])
        .filter((v): v is number => typeof v === 'number');
      if (!graded.length || values.length !== graded.length) return [];
      return [{ key, mean: values.reduce((a, b) => a + b, 0) / values.length }];
    });
    if (!means.length) return [];
    const min = Math.min(...means.map((m) => m.mean));
    const max = Math.max(...means.map((m) => m.mean));
    if (min === max) return [];
    const { key } = means.find((m) => m.mean === min)!;
    const { label, kinds } = FOCUS[skill][key];
    return [{ skill, label, kinds }];
  });
}

/** The weak area an item trains, if any. */
export function focusOf(
  item: { skill: PracticeSkill; kinds: string[] },
  focus: WeakFocus[],
): WeakFocus | null {
  return (
    focus.find(
      (f) =>
        f.skill === item.skill && f.kinds.some((k) => item.kinds.includes(k)),
    ) ?? null
  );
}
