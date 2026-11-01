import { buildLevelRoadmap, type RoadmapSkill } from './level-roadmap.logic';

const skill = (over: Partial<RoadmapSkill>): RoadmapSkill => ({
  skill: 'LISTENING',
  unlockedLevel: 'BASIC',
  done: 0,
  average: null,
  nextRoute: null,
  ...over,
});

describe('buildLevelRoadmap', () => {
  it('has a step per skill, grammar and vocabulary of the level', () => {
    const r = buildLevelRoadmap({
      level: 'BASIC',
      skills: [skill({ skill: 'LISTENING', nextRoute: '/listening/9' })],
      grammar: [
        { id: 1, title: 'A', level: 'BEGINNER', best: 90 },
        { id: 2, title: 'B', level: 'BEGINNER', best: null },
        { id: 3, title: 'C', level: 'ADVANCED', best: null },
      ],
      decks: [{ id: 7, title: 'D', level: 'A2', total: 10, mastered: 5 }],
    });
    expect(r.title).toBe('Lộ trình mức Cơ bản');
    expect(r.steps.map((s) => s.key)).toEqual([
      'skill-LISTENING',
      'grammar',
      'vocab',
    ]);
    expect(r.steps[0].route).toBe('/listening/9');
    expect(r.steps[0].title).toBe('Nghe: mở mức Trung cấp');
    expect(r.steps[1].why).toBe('Đã đạt 1/2 chủ đề.');
    expect(r.steps[1].route).toBe('/reading?category=grammar&topicId=2');
    expect(r.steps[2].done).toBe(true);
    expect(r.done).toBe(1);
    expect(r.nextKey).toBe('skill-LISTENING');
  });

  it('marks a skill past the level as done and points at the next step', () => {
    const r = buildLevelRoadmap({
      level: 'BASIC',
      skills: [
        skill({ skill: 'LISTENING', unlockedLevel: 'ADVANCED' }),
        skill({ skill: 'SPEAKING', done: 2, average: 75 }),
      ],
      grammar: [],
      decks: [],
    });
    expect(r.steps[0].done).toBe(true);
    expect(r.steps[0].why).toBe('Đã vượt mức Cơ bản.');
    expect(r.steps[1].why).toContain('2/3 bài');
    expect(r.steps[1].route).toBe('/speaking');
    expect(r.nextKey).toBe('skill-SPEAKING');
  });

  it('leaves out grammar and vocabulary when the level has none', () => {
    const r = buildLevelRoadmap({
      level: 'ADVANCED',
      skills: [skill({ unlockedLevel: 'ADVANCED', done: 3, average: 80 })],
      grammar: [{ id: 1, title: 'A', level: 'BEGINNER', best: null }],
      decks: [],
    });
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0].done).toBe(true);
    expect(r.nextKey).toBeNull();
  });
});
