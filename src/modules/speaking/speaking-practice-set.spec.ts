import { resolveSpeakingPracticeSet } from './speaking-practice-set';

describe('resolveSpeakingPracticeSet', () => {
  const set = {
    id: 'practice-read-aloud-a1-a2',
    title: 'Đọc thành tiếng — Cơ bản',
    description: 'Đọc to câu thông báo.',
  };

  it('groups an exercise under the set it belongs to', () => {
    expect(
      resolveSpeakingPracticeSet({
        id: 3,
        title: 'Read Aloud A1 — Daily Schedule',
        practiceSet: set,
      }),
    ).toEqual({
      key: 'practice-read-aloud-a1-a2',
      title: 'Đọc thành tiếng — Cơ bản',
      description: 'Đọc to câu thông báo.',
    });
  });

  it('keys by the set, not by the title: two titles, one set', () => {
    const keys = ['Read Aloud 1', 'Opinion 2'].map(
      (title, id) =>
        resolveSpeakingPracticeSet({ id, title, practiceSet: set }).key,
    );
    expect(keys).toEqual([set.id, set.id]);
  });

  it('lets an exercise without a set stand alone under its own title', () => {
    const first = resolveSpeakingPracticeSet({
      id: 41,
      title: 'Read Aloud — Daily 1',
      practiceSet: null,
    });
    const second = resolveSpeakingPracticeSet({
      id: 42,
      title: 'Read Aloud — Daily 2',
    });
    expect(first).toEqual({
      key: 'exercise-41',
      title: 'Read Aloud — Daily 1',
      description: 'Bài luyện nói theo câu.',
    });
    // The same title family no longer folds two loose exercises together.
    expect(second.key).toBe('exercise-42');
  });
});
