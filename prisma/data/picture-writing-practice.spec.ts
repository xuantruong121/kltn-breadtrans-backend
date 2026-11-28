import { pictureTaskIssues } from '../../src/modules/writing/practice-writing-grading';
import {
  legacyPracticeLevel,
  requiredPracticePlan,
} from '../../src/modules/subscription/practice-level';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  PICTURE_MORE_ARTIFACT_DIR,
  PICTURE_WRITING_EXERCISES,
  PICTURE_WRITING_MORE_EXERCISES,
  pictureTaskContent,
} from './picture-writing-practice';

describe('picture writing content (Viết câu theo tranh)', () => {
  const base = 'https://example.r2.dev';

  it.each(
    PICTURE_WRITING_EXERCISES.flatMap((exercise) =>
      exercise.tasks.map(
        (task, i) => [exercise.title, i + 1, exercise, task] as const,
      ),
    ),
  )('%s task %i is publishable', (_title, _n, exercise, task) => {
    expect(pictureTaskIssues(pictureTaskContent(exercise, task, base))).toEqual(
      [],
    );
  });

  it('A2 is free, B1 needs PLUS, and the stored flag agrees', () => {
    const plans = PICTURE_WRITING_EXERCISES.map((exercise) => {
      const level = legacyPracticeLevel(exercise.title);
      expect(level).not.toBeNull();
      const plan = requiredPracticePlan('WRITING', level!);
      expect(exercise.isPremiumContent).toBe(plan !== 'FREE');
      return plan;
    });
    expect(plans).toEqual(['FREE', 'PLUS']);
  });

  it('B1 asks for one linked sentence and says so; A2 does not', () => {
    const [a2, b1] = PICTURE_WRITING_EXERCISES;
    expect(a2.requireLinking).toBe(false);
    expect(b1.requireLinking).toBe(true);
    expect(b1.prompt).toContain('MỘT câu');
    expect(b1.requirements.join(' ')).toContain('từ nối');
  });

  it('every exercise has five tasks with distinct pictures', () => {
    const images = PICTURE_WRITING_EXERCISES.flatMap((e) =>
      e.tasks.map((t) => t.image),
    );
    expect(PICTURE_WRITING_EXERCISES.every((e) => e.tasks.length === 5)).toBe(
      true,
    );
    expect(new Set(images).size).toBe(images.length);
  });
});

describe('picture writing, second batch (2026-11-24)', () => {
  const base = 'https://example.r2.dev';
  const all = [...PICTURE_WRITING_EXERCISES, ...PICTURE_WRITING_MORE_EXERCISES];

  it.each(
    PICTURE_WRITING_MORE_EXERCISES.flatMap((exercise) =>
      exercise.tasks.map(
        (task, i) => [exercise.title, i + 1, exercise, task] as const,
      ),
    ),
  )('%s task %i is publishable', (_title, _n, exercise, task) => {
    expect(pictureTaskIssues(pictureTaskContent(exercise, task, base))).toEqual(
      [],
    );
  });

  it('adds twenty tasks: three free A2 sets and one PLUS B1 set', () => {
    const plans = PICTURE_WRITING_MORE_EXERCISES.map((exercise) => {
      const level = legacyPracticeLevel(exercise.title);
      expect(level).not.toBeNull();
      const plan = requiredPracticePlan('WRITING', level!);
      expect(exercise.isPremiumContent).toBe(plan !== 'FREE');
      return plan;
    });
    expect(plans).toEqual(['FREE', 'FREE', 'FREE', 'PLUS']);
    expect(
      PICTURE_WRITING_MORE_EXERCISES.every((e) => e.tasks.length === 5),
    ).toBe(true);
  });

  it('keeps the B1 rule: one linked sentence', () => {
    const b1 = PICTURE_WRITING_MORE_EXERCISES[3];
    expect(b1.requireLinking).toBe(true);
    expect(b1.prompt).toContain('MỘT câu');
  });

  it('no picture, title or cue-word pair repeats across both batches', () => {
    const images = all.flatMap((e) => e.tasks.map((t) => t.image));
    const pairs = all.flatMap((e) =>
      e.tasks.map((t) => [...t.keywords].sort().join('+')),
    );
    expect(new Set(images).size).toBe(images.length);
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(new Set(all.map((e) => e.title)).size).toBe(all.length);
  });

  it('each new picture is its committed file, named by its hash', () => {
    for (const task of PICTURE_WRITING_MORE_EXERCISES.flatMap((e) => e.tasks)) {
      const match =
        /^catalog\/writing\/picture\/([a-z-]+)-([0-9a-f]{12})\.jpg$/.exec(
          task.image,
        );
      expect(match).not.toBeNull();
      const body = readFileSync(
        `${PICTURE_MORE_ARTIFACT_DIR}/${match![1]}.jpg`,
      );
      expect(createHash('sha256').update(body).digest('hex').slice(0, 12)).toBe(
        match![2],
      );
    }
  });

  it('the first ten keep their old picture URLs', () => {
    const [a2] = PICTURE_WRITING_EXERCISES;
    expect(pictureTaskContent(a2, a2.tasks[0], base).imageUrl).toBe(
      `${base}/catalog/toeic/shared/images/grocery-checkout.png`,
    );
  });
});
