import {
  buildRoadmap,
  deckDone,
  STARTER_ROADMAP,
  type RoadmapStep,
} from './starter-roadmap.logic';
import { StarterRoadmapService } from './starter-roadmap.service';

describe('starter roadmap data', () => {
  it('has unique steps covering foundation and all four skills', () => {
    const keys = STARTER_ROADMAP.map((step) => step.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(STARTER_ROADMAP.map((s) => s.ref.kind))).toEqual(
      new Set(['GRAMMAR', 'VOCAB', 'QUIZ', 'SPEAKING_SET']),
    );
  });

  it('keeps level and certificate claims out of learner copy', () => {
    for (const step of STARTER_ROADMAP)
      expect(`${step.title} ${step.why}`).not.toMatch(
        /CEFR|[ABC][12]|chứng chỉ/,
      );
  });
});

describe('buildRoadmap', () => {
  const step = (key: string): RoadmapStep => ({
    key,
    title: key,
    why: '',
    minutes: 5,
    ref: { kind: 'QUIZ', title: key },
  });

  it('points at the first open step that is not done', () => {
    const roadmap = buildRoadmap([step('a'), step('b'), step('c')], (s) => ({
      route: `/${s.key}`,
      done: s.key === 'a',
      locked: s.key === 'b',
    }));
    expect(roadmap).toMatchObject({ done: 1, total: 3, nextKey: 'c' });
    expect(roadmap.steps[0]).not.toHaveProperty('ref');
  });

  it('drops a step whose item is not published', () => {
    const roadmap = buildRoadmap([step('a'), step('b')], (s) =>
      s.key === 'a' ? { route: '/a', done: false, locked: false } : undefined,
    );
    expect(roadmap.steps.map((s) => s.key)).toEqual(['a']);
    expect(roadmap.total).toBe(1);
  });

  it('has no next step at the end of the path', () => {
    expect(
      buildRoadmap([step('a')], () => ({
        route: '/a',
        done: true,
        locked: false,
      })).nextKey,
    ).toBeNull();
  });
});

describe('deckDone', () => {
  it('needs half the deck', () => {
    expect(deckDone(4, 10)).toBe(false);
    expect(deckDone(5, 10)).toBe(true);
    expect(deckDone(0, 0)).toBe(false);
  });
});

describe('StarterRoadmapService', () => {
  function setup(unlocked = 'STARTER') {
    const titled = (where: { title: { in: string[] } }, extra: object) =>
      Promise.resolve(
        where.title.in.map((title, index) => ({
          id: index + 1,
          title,
          ...extra,
        })),
      );
    const prisma: any = {
      grammarTopic: {
        findMany: ({ where }: any) => titled(where, { attempts: [{ id: 1 }] }),
      },
      vocabTopic: {
        findMany: ({ where }: any) => titled(where, { totalWords: 10 }),
      },
      quiz: {
        findMany: ({ where }: any) =>
          Promise.resolve(
            where.title.in.map((title: string, index: number) => ({
              id: index + 1,
              title,
              type: title.includes('tranh')
                ? 'WRITING_PICTURE'
                : title.startsWith('Reading')
                  ? 'BILINGUAL_READING'
                  : 'LISTENING_PRACTICE',
              submissions: [],
            })),
          ),
      },
      speakingPracticeSet: {
        findMany: () =>
          Promise.resolve([
            {
              id: 'practice-read-aloud-a1-a2',
              level: 'A1-A2',
              exercises: [{ id: 7, submissions: [{ id: 1 }] }],
            },
          ]),
      },
      userVocabWordProgress: {
        groupBy: () =>
          Promise.resolve([1, 2, 3, 4, 5].map((wordId) => ({ wordId }))),
      },
      vocabWord: {
        findMany: ({ where }: any) =>
          Promise.resolve(where.id.in.map(() => ({ topicId: 1 }))),
      },
    };
    const levels = {
      unlockedLevels: () =>
        Promise.resolve({
          LISTENING: unlocked,
          READING: unlocked,
          SPEAKING: unlocked,
          WRITING: unlocked,
        }),
    };
    return new StarterRoadmapService(prisma, levels as never);
  }

  it('reads done, locked and routes from real progress', async () => {
    const roadmap = await setup().forUser(7);
    const by = Object.fromEntries(roadmap.steps.map((s) => [s.key, s]));
    expect(roadmap.total).toBe(STARTER_ROADMAP.length);
    expect(by['grammar-present']).toMatchObject({
      done: true,
      route: '/reading?category=grammar&topicId=1',
    });
    expect(by['vocab-daily']).toMatchObject({
      done: true,
      route: '/flashcard/1',
    });
    expect(by['read-aloud']).toMatchObject({
      done: true,
      route: '/speaking/7?set=practice-read-aloud-a1-a2',
    });
    expect(by['listening-a1']).toMatchObject({ done: false, locked: false });
    expect(by['picture-sentences']).toMatchObject({ locked: true });
    expect(roadmap.nextKey).toBe('listening-a1');
  });

  it('opens the picture step once Cơ bản is open', async () => {
    const roadmap = await setup('BASIC').forUser(7);
    expect(
      roadmap.steps.find((s) => s.key === 'picture-sentences')?.locked,
    ).toBe(false);
  });
});
