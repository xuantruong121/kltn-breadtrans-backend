import { pictureTaskIssues } from '../../src/modules/writing/practice-writing-grading';
import {
  parseCefrRange,
  requiredPracticePlan,
} from '../../src/modules/subscription/practice-level';
import {
  PICTURE_WRITING_EXERCISES,
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
      const range = parseCefrRange(exercise.title);
      expect(range).not.toBeNull();
      const plan = requiredPracticePlan('WRITING', range!);
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
