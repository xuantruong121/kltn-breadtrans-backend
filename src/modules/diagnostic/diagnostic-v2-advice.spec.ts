import { scoreFourSkillPlacementV2 } from './diagnostic-four-skill';
import {
  allAdviceResourceRefs,
  buildDiagnosticAdvice,
  type NearLevelResolver,
  type ProductiveTaskEvidence,
  type ResolvedResource,
  type ResourceRef,
} from './diagnostic-v2-advice';

const LISTENING = [
  'gist',
  'gist',
  'specific detail',
  'specific detail',
  'specific detail',
  'specific detail',
  'purpose',
  'speaker intention',
  'inference',
  'inference',
];
const READING = [
  'main idea',
  'specific detail',
  'specific detail',
  'main idea',
  'specific detail',
  'meaning in context',
  'reference',
  'meaning in context',
  'inference',
  'inference',
];
const LU = ['grammar', 'grammar', 'grammar', 'vocabulary', 'vocabulary'];

/** `wrong` lists the constructs answered wrongly (each once). */
function items(section: string, constructs: string[], wrong: string[] = []) {
  const left = [...wrong];
  return constructs.map((construct) => {
    const i = left.indexOf(construct);
    if (i >= 0) left.splice(i, 1);
    return { section, construct, isCorrect: i < 0 };
  });
}

const crit = (
  skill: 'SPEAKING' | 'WRITING',
  v: number[],
): Record<string, number> =>
  skill === 'SPEAKING'
    ? {
        task_fulfilment: v[0],
        intelligibility: v[1],
        fluency: v[2],
        language_use: v[3],
      }
    : {
        task_achievement: v[0],
        organisation: v[1],
        vocabulary: v[2],
        grammar: v[3],
      };

function task(
  skill: 'SPEAKING' | 'WRITING',
  questionId: number,
  status: string,
  v: number[] | null,
  provider = 'gemini',
): ProductiveTaskEvidence {
  return {
    skill,
    questionId,
    status,
    criteria: v ? crit(skill, v) : null,
    criterionFeedback: v
      ? Object.fromEntries(
          Object.keys(crit(skill, v)).map((k) => [
            k,
            `feedback ${k} q${questionId}`,
          ]),
        )
      : null,
    provider,
  };
}
const pct = (v: number[]) => (v.reduce((a, b) => a + b, 0) / 16) * 100;

const OPEN: ResourceRef[] = allAdviceResourceRefs();
function resolver(
  opts: { missing?: string[]; locked?: string[]; levelLocked?: string[] } = {},
) {
  return (ref: ResourceRef): ResolvedResource | null => {
    const key = `${ref.kind}:${ref.id}`;
    if (opts.missing?.includes(key)) return null;
    if (opts.levelLocked?.includes(key))
      return {
        ...ref,
        title: key,
        route: `/x/${ref.id}`,
        access: 'LOCKED',
        requirement: 'Cần mở mức Trung cấp',
        lockedBy: 'LEVEL',
      };
    const locked = opts.locked?.includes(key) ?? false;
    return {
      ...ref,
      title: key,
      route: `/x/${ref.id}`,
      access: locked ? 'LOCKED' : 'OPEN',
      requirement: locked ? 'Cần gói Pro' : null,
      lockedBy: locked ? 'PLAN' : null,
    };
  };
}

/** Open items at the learner's level, as the recommender would give them. */
const openAtLevel = (
  items: Array<{
    id: number;
    kind: 'SPEAKING_EXERCISE' | 'WRITING_QUIZ' | 'READING_QUIZ';
    skill: string;
    kinds: string[];
  }>,
): NearLevelResolver & { asked: Array<[string, string[] | null]> } => {
  const asked: Array<[string, string[] | null]> = [];
  const fn = ((skill: string, kinds: string[] | null) => {
    asked.push([skill, kinds]);
    return items
      .filter(
        (i) =>
          i.skill === skill &&
          (!kinds || i.kinds.some((k) => kinds.includes(k))),
      )
      .map((i) => ({
        kind: i.kind,
        id: i.id,
        title: `near ${i.id}`,
        route: `/near/${i.id}`,
        access: 'OPEN' as const,
        requirement: null,
        lockedBy: null,
      }));
  }) as NearLevelResolver & { asked: Array<[string, string[] | null]> };
  fn.asked = asked;
  return fn;
};

function run(o: {
  lWrong?: string[];
  rWrong?: string[];
  luWrong?: string[];
  speaking?: ProductiveTaskEvidence[];
  writing?: ProductiveTaskEvidence[];
  resolve?: ReturnType<typeof resolver>;
  nearLevel?: NearLevelResolver;
}) {
  const objective = [
    ...items('LISTENING', LISTENING, o.lWrong),
    ...items('READING', READING, o.rWrong),
    ...items('LANGUAGE_USE', LU, o.luWrong),
  ];
  const speaking = o.speaking ?? [
    task('SPEAKING', 21, 'GRADED', [3, 3, 3, 3]),
    task('SPEAKING', 22, 'GRADED', [3, 3, 3, 3]),
  ];
  const writing = o.writing ?? [
    task('WRITING', 23, 'GRADED', [3, 3, 3, 3]),
    task('WRITING', 24, 'GRADED', [3, 3, 3, 3]),
  ];
  const fourSkill = scoreFourSkillPlacementV2({
    objective,
    speakingQuestionIds: [21, 22],
    speaking: speaking.map((t) => ({
      questionId: t.questionId,
      status: t.status,
      score:
        t.status === 'GRADED' && t.criteria
          ? pct(Object.values(t.criteria) as number[])
          : null,
    })),
    writingQuestionIds: [23, 24],
    writing: writing.map((t) => ({
      questionId: t.questionId,
      status: t.status,
      score:
        t.status === 'GRADED' && t.criteria
          ? pct(Object.values(t.criteria) as number[])
          : null,
    })),
  });
  return {
    fourSkill,
    advice: buildDiagnosticAdvice({
      fourSkill,
      objective,
      productive: [...speaking, ...writing],
      resolve: o.resolve ?? resolver(),
      nearLevel: o.nearLevel,
    }),
  };
}

describe('D1 advice (FOUR_SKILL_PLACEMENT_V2)', () => {
  it('Listening weakest: the first priority is the Listening area with the most wrong items, with item evidence', () => {
    const { advice } = run({
      lWrong: ['specific detail', 'specific detail', 'specific detail', 'gist'],
    });
    expect(advice.profile.weakest).toEqual(['LISTENING']);
    expect(advice.priorities[0]).toMatchObject({
      skill: 'LISTENING',
      areaKey: 'LISTENING_DETAIL',
      evidence: 'Sai 3/4 câu thuộc dạng này.',
    });
    expect(advice.priorities[0].resources.length).toBeGreaterThan(0);
  });

  it('Reading weakest: priority comes from Reading constructs', () => {
    const { advice } = run({ rWrong: ['inference', 'inference', 'main idea'] });
    expect(advice.profile.weakest).toEqual(['READING']);
    expect(advice.priorities[0]).toMatchObject({
      skill: 'READING',
      areaKey: 'READING_INFERENCE',
      evidence: 'Sai 2/2 câu thuộc dạng này.',
    });
  });

  it('Speaking weakest by rubric: the lowest criterion, with the grader feedback for it', () => {
    const { advice } = run({
      speaking: [
        task('SPEAKING', 21, 'GRADED', [2, 3, 1, 2]),
        task('SPEAKING', 22, 'GRADED', [2, 3, 1, 2]),
      ],
    });
    expect(advice.profile.weakest).toEqual(['SPEAKING']);
    expect(advice.priorities[0]).toMatchObject({
      skill: 'SPEAKING',
      areaKey: 'SPEAKING_FLUENCY',
    });
    expect(advice.priorities[0].evidence).toContain('1/4');
    expect(advice.priorities[0].graderFeedback).toEqual([
      'feedback fluency q21',
      'feedback fluency q22',
    ]);
    expect(advice.strengths).toContainEqual(
      expect.objectContaining({
        skill: 'SPEAKING',
        areaKey: 'SPEAKING_INTELLIGIBILITY',
      }),
    );
  });

  it('Writing weakest by rubric: the lowest criterion', () => {
    const { advice } = run({
      writing: [
        task('WRITING', 23, 'GRADED', [2, 1, 2, 2]),
        task('WRITING', 24, 'GRADED', [2, 2, 2, 1]),
      ],
    });
    expect(advice.profile.weakest).toEqual(['WRITING']);
    expect(advice.priorities[0].skill).toBe('WRITING');
    // organisation and grammar both average 1.5: both reported.
    expect(
      advice.priorities
        .filter((p) => p.skill === 'WRITING')
        .map((p) => p.areaKey)
        .sort(),
    ).toEqual(['WRITING_GRAMMAR', 'WRITING_ORGANISATION']);
  });

  it('multiple weak skills: at most three priorities, lowest skill first, one area per skill per round', () => {
    const { advice } = run({
      lWrong: [
        'gist',
        'gist',
        'specific detail',
        'specific detail',
        'inference',
      ],
      rWrong: ['main idea', 'main idea', 'inference'],
    });
    expect(advice.priorities).toHaveLength(3);
    expect(advice.priorities.map((p) => p.skill)).toEqual(
      ['LISTENING', 'READING', 'SPEAKING']
        .slice(0, 2)
        .concat(advice.priorities[2].skill),
    );
    expect(advice.priorities[0].skill).toBe('LISTENING');
    expect(advice.priorities[1].skill).toBe('READING');
  });

  it('all skills within one objective item: reported as balanced, no weakest skill named', () => {
    const { advice } = run({
      lWrong: ['inference', 'gist', 'specific detail'],
      rWrong: ['inference', 'main idea', 'reference'],
    });
    // L 70, R 70, S 75, W 75
    expect(advice.profile.balanced).toBe(true);
    expect(advice.profile.weakest).toEqual([]);
    expect(advice.profile.strongest).toEqual([]);
  });

  it('high performer: no weakness is invented', () => {
    const { advice } = run({
      speaking: [
        task('SPEAKING', 21, 'GRADED', [4, 4, 4, 4]),
        task('SPEAKING', 22, 'GRADED', [4, 4, 4, 4]),
      ],
      writing: [
        task('WRITING', 23, 'GRADED', [4, 4, 4, 4]),
        task('WRITING', 24, 'GRADED', [4, 4, 4, 4]),
      ],
    });
    expect(advice.priorities).toEqual([]);
    expect(advice.noWeaknessFound).toBe(true);
    expect(advice.strengths.length).toBeGreaterThan(0);
  });

  it('skipped Speaking: not assessed, never a weakness, general practice offered as general', () => {
    const { advice, fourSkill } = run({
      lWrong: ['gist'],
      speaking: [
        task('SPEAKING', 21, 'SKIPPED', null),
        task('SPEAKING', 22, 'SKIPPED', null),
      ],
    });
    expect(fourSkill.overall).toBeNull();
    expect(advice.profile.assessed).not.toContain('SPEAKING');
    expect(advice.priorities.some((p) => p.skill === 'SPEAKING')).toBe(false);
    expect(advice.strengths.some((s) => s.skill === 'SPEAKING')).toBe(false);
    expect(advice.unassessed).toEqual([
      expect.objectContaining({
        skill: 'SPEAKING',
        reason: 'SKIPPED',
        generalPractice: expect.objectContaining({ kind: 'SPEAKING_EXERCISE' }),
      }),
    ]);
  });

  it('skipped Writing: not assessed', () => {
    const { advice } = run({
      writing: [
        task('WRITING', 23, 'GRADED', [2, 2, 2, 2]),
        task('WRITING', 24, 'SKIPPED', null),
      ],
    });
    expect(advice.unassessed).toEqual([
      expect.objectContaining({ skill: 'WRITING', reason: 'SKIPPED' }),
    ]);
    expect(advice.priorities.some((p) => p.skill === 'WRITING')).toBe(false);
  });

  it('pending grading: not final, no general practice, no finding', () => {
    const { advice } = run({
      writing: [
        task('WRITING', 23, 'GRADED', [1, 1, 1, 1]),
        task('WRITING', 24, 'QUEUED', null),
      ],
    });
    expect(advice.unassessed).toEqual([
      { skill: 'WRITING', reason: 'PENDING_GRADING', generalPractice: null },
    ]);
    expect(advice.priorities.some((p) => p.skill === 'WRITING')).toBe(false);
  });

  it('failed grading: reported as failed, not as weakness', () => {
    const { advice } = run({
      speaking: [
        task('SPEAKING', 21, 'GRADING_FAILED', null),
        task('SPEAKING', 22, 'GRADED', [1, 1, 1, 1]),
      ],
    });
    expect(advice.unassessed).toEqual([
      { skill: 'SPEAKING', reason: 'GRADING_FAILED', generalPractice: null },
    ]);
    expect(advice.priorities.some((p) => p.skill === 'SPEAKING')).toBe(false);
  });

  it('no matching published resource: the finding stays, with no phantom link', () => {
    const { advice } = run({
      lWrong: ['specific detail', 'specific detail'],
      resolve: resolver({
        missing: ['LISTENING_QUIZ:23', 'LISTENING_QUIZ:24'],
      }),
    });
    const detail = advice.priorities.find(
      (p) => p.areaKey === 'LISTENING_DETAIL',
    );
    expect(detail).toBeDefined();
    expect(detail!.resources).toEqual([]);
  });

  it('locked resources are kept with their requirement, open ones listed first', () => {
    const { advice } = run({
      rWrong: ['inference', 'inference'],
      resolve: resolver({ locked: ['READING_QUIZ:6'] }),
    });
    const res = advice.priorities.find(
      (p) => p.areaKey === 'READING_INFERENCE',
    )!.resources;
    expect(res.map((r) => r.access)).toEqual(['OPEN', 'LOCKED']);
    expect(res[1].requirement).toBe('Cần gói Pro');
  });

  it('a fixed item above the learner level gives way to open practice at that level for the same criterion', () => {
    // student1: Speaking at Cơ bản, weakest criterion pronunciation, and the
    // fixed pronunciation item (Speaking 11) is a Trung cấp set.
    const near = openAtLevel([
      {
        id: 301,
        kind: 'SPEAKING_EXERCISE',
        skill: 'SPEAKING',
        kinds: ['READ_ALOUD'],
      },
      {
        id: 302,
        kind: 'SPEAKING_EXERCISE',
        skill: 'SPEAKING',
        kinds: ['RESPOND_TO_QUESTION'],
      },
      {
        id: 303,
        kind: 'SPEAKING_EXERCISE',
        skill: 'SPEAKING',
        kinds: ['READ_ALOUD'],
      },
    ]);
    const { advice } = run({
      speaking: [
        task('SPEAKING', 21, 'GRADED', [3, 1, 3, 3]),
        task('SPEAKING', 22, 'GRADED', [3, 1, 3, 3]),
      ],
      resolve: resolver({ levelLocked: ['SPEAKING_EXERCISE:11'] }),
      nearLevel: near,
    });
    const card = advice.priorities.find(
      (p) => p.areaKey === 'SPEAKING_INTELLIGIBILITY',
    )!;
    expect(card.resources.map((r) => [r.id, r.access])).toEqual([
      [301, 'OPEN'],
      [303, 'OPEN'],
    ]);
    expect(near.asked).toContainEqual([
      'SPEAKING',
      ['READ_ALOUD', 'PRONUNCIATION_DRILL'],
    ]);
  });

  it('with no open practice at the level, the level-locked item still shows with its requirement', () => {
    const { advice } = run({
      speaking: [
        task('SPEAKING', 21, 'GRADED', [3, 1, 3, 3]),
        task('SPEAKING', 22, 'GRADED', [3, 1, 3, 3]),
      ],
      resolve: resolver({ levelLocked: ['SPEAKING_EXERCISE:11'] }),
      nearLevel: openAtLevel([]),
    });
    const card = advice.priorities.find(
      (p) => p.areaKey === 'SPEAKING_INTELLIGIBILITY',
    )!;
    expect(card.resources).toEqual([
      expect.objectContaining({
        id: 11,
        access: 'LOCKED',
        requirement: 'Cần mở mức Trung cấp',
      }),
    ]);
  });

  it('an open fixed item stays first; open practice at the level fills the rest', () => {
    const { advice } = run({
      writing: [
        task('WRITING', 23, 'GRADED', [1, 3, 3, 3]),
        task('WRITING', 24, 'GRADED', [1, 3, 3, 3]),
      ],
      resolve: resolver({ levelLocked: ['WRITING_QUIZ:4'] }),
      nearLevel: openAtLevel([
        {
          id: 401,
          kind: 'WRITING_QUIZ',
          skill: 'WRITING',
          kinds: ['WRITING_EMAIL'],
        },
        {
          id: 402,
          kind: 'WRITING_QUIZ',
          skill: 'WRITING',
          kinds: ['WRITING_PICTURE'],
        },
      ]),
    });
    const card = advice.priorities.find((p) => p.areaKey === 'WRITING_TASK')!;
    expect(card.resources.map((r) => [r.id, r.access])).toEqual([
      [17, 'OPEN'],
      [401, 'OPEN'],
    ]);
  });

  it('a plan-locked item ranks after open practice but before a level-locked one', () => {
    const { advice } = run({
      rWrong: ['inference', 'inference'],
      resolve: resolver({
        locked: ['READING_QUIZ:6'],
        levelLocked: ['READING_QUIZ:16'],
      }),
      nearLevel: openAtLevel([]),
    });
    const res = advice.priorities.find(
      (p) => p.areaKey === 'READING_INFERENCE',
    )!.resources;
    expect(res.map((r) => [r.id, r.lockedBy])).toEqual([
      [6, 'PLAN'],
      [16, 'LEVEL'],
    ]);
  });

  it('mock-graded productive evidence is flagged', () => {
    const { advice } = run({
      speaking: [
        task('SPEAKING', 21, 'GRADED', [2, 2, 1, 2], 'mock'),
        task('SPEAKING', 22, 'GRADED', [2, 2, 1, 2], 'mock'),
      ],
    });
    expect(advice.mockGraderEvidence).toBe(true);
    const real = run({}).advice;
    expect(real.mockGraderEvidence).toBe(false);
  });

  it('Language Use stays supplemental and never ranks a required skill', () => {
    const { advice } = run({ luWrong: ['grammar', 'grammar', 'vocabulary'] });
    expect(advice.priorities.some((p) => p.skill === 'LANGUAGE_USE')).toBe(
      false,
    );
    expect(advice.supplemental[0]).toMatchObject({
      skill: 'LANGUAGE_USE',
      areaKey: 'LANGUAGE_USE_GRAMMAR',
    });
  });

  it('every cited resource reference is in the resolvable list', () => {
    const { advice } = run({
      lWrong: ['gist', 'inference'],
      rWrong: ['reference'],
    });
    const keys = new Set(OPEN.map((r) => `${r.kind}:${r.id}`));
    for (const p of [...advice.priorities, ...advice.supplemental])
      for (const r of p.resources)
        expect(keys.has(`${r.kind}:${r.id}`)).toBe(true);
  });
});
