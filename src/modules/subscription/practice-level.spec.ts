import {
  CEFR_LEVELS,
  isDictationContent,
  isPracticeLevel,
  keepTitleHead,
  legacyPracticeLevel,
  listeningTitleLabel,
  parseCefrRange,
  practiceLevelLabel,
  practiceLevelRank,
  PRACTICE_LEVELS,
  relabelTitleHead,
  requiredPracticePlan,
  type PracticePlan,
  type PracticeSkill,
} from './practice-level';

/**
 * Every level tag stored before 2026-11-27, as the migration met them in
 * kltn_db (titles, speaking set levels, deck levels), plus the legacy ranges
 * the speaking contract allowed.
 */
const OLD_TAGS = [
  'A1',
  'A1-A2',
  'A1–A2',
  'A2',
  'A1-B1',
  'A2-B1',
  'A2-B2',
  'B1',
  'B1-B2',
  'B2',
  'B1-C1',
  'B2-C1',
  'B2–C1',
  'C1',
  'C1-C2',
  'C2',
];

/** The plan matrix as it was written on CEFR ranges (owner 2026-10-30). */
function oldPlan(
  skill: PracticeSkill,
  tag: string,
  dictation = false,
): PracticePlan {
  const range = parseCefrRange(tag)!;
  const at = (level: string) =>
    CEFR_LEVELS.indexOf(range.max) >=
    CEFR_LEVELS.indexOf(level as (typeof CEFR_LEVELS)[number]);
  if (skill === 'READING') return 'FREE';
  if (skill === 'LISTENING') return dictation && at('B1') ? 'PLUS' : 'FREE';
  if (at('C1')) return 'PRO';
  return at('B1') ? 'PLUS' : 'FREE';
}

describe('legacyPracticeLevel (the migration table, owner 2026-11-27)', () => {
  it.each([
    ['A1', 'STARTER'],
    ['A1-A2', 'STARTER'],
    ['A1–A2', 'STARTER'],
    ['A2', 'BASIC'],
    ['A1-B1', 'INTERMEDIATE'],
    ['A2-B1', 'INTERMEDIATE'],
    ['A2-B2', 'INTERMEDIATE'],
    ['B1', 'INTERMEDIATE'],
    ['B1-B2', 'INTERMEDIATE'],
    ['B2', 'INTERMEDIATE'],
    ['B1-C1', 'ADVANCED'],
    ['B2–C1', 'ADVANCED'],
    ['C1', 'ADVANCED'],
    ['C2', 'ADVANCED'],
    ['BEGINNER', 'BASIC'],
    ['INTERMEDIATE', 'INTERMEDIATE'],
    ['STARTER', 'STARTER'],
    ['Listening B1 — Workplace Conversations', 'INTERMEDIATE'],
    ['Reading A1–A2 — Everyday Texts', 'STARTER'],
    ['Writing B2–C1 — Argument & Problem Solving', 'ADVANCED'],
  ])('%s → %s', (value, level) => {
    expect(legacyPracticeLevel(value)).toBe(level);
  });

  it('reads nothing from a value without a level', () => {
    expect(legacyPracticeLevel('Viết câu theo tranh — Giao hàng')).toBeNull();
    expect(legacyPracticeLevel('')).toBeNull();
    expect(legacyPracticeLevel(null)).toBeNull();
  });

  it('only reads the head of a title', () => {
    expect(legacyPracticeLevel('Office tasks — B2 vocabulary')).toBeNull();
  });
});

describe('requiredPracticePlan on practice levels', () => {
  it.each([
    ['READING', 'ADVANCED', false, 'FREE'],
    ['LISTENING', 'ADVANCED', false, 'FREE'],
    ['LISTENING', 'BASIC', true, 'FREE'],
    ['LISTENING', 'INTERMEDIATE', true, 'PLUS'],
    ['LISTENING', 'ADVANCED', true, 'PLUS'],
    ['SPEAKING', 'STARTER', false, 'FREE'],
    ['SPEAKING', 'BASIC', false, 'FREE'],
    ['SPEAKING', 'INTERMEDIATE', false, 'PLUS'],
    ['SPEAKING', 'ADVANCED', false, 'PRO'],
    ['WRITING', 'BASIC', false, 'FREE'],
    ['WRITING', 'INTERMEDIATE', false, 'PLUS'],
    ['WRITING', 'ADVANCED', false, 'PRO'],
  ] as const)('%s %s (dictation %s) → %s', (skill, level, dictation, plan) => {
    expect(requiredPracticePlan(skill, level, { dictation })).toBe(plan);
  });

  // The owner's 2026-11-27 decision: no item changes plan in the move. The
  // three items reaching C1 from B1 or B2 keep PRO; only their level lock
  // moves from Trung cấp to Nâng cao.
  const SKILLS: Array<[PracticeSkill, boolean]> = [
    ['READING', false],
    ['LISTENING', false],
    ['LISTENING', true],
    ['SPEAKING', false],
    ['WRITING', false],
  ];
  it.each(OLD_TAGS)(
    'gives a %s item the plan the CEFR matrix gave it, for every skill',
    (tag) => {
      const level = legacyPracticeLevel(tag)!;
      for (const [skill, dictation] of SKILLS)
        expect({
          skill,
          dictation,
          plan: requiredPracticePlan(skill, level, { dictation }),
        }).toEqual({ skill, dictation, plan: oldPlan(skill, tag, dictation) });
    },
  );
});

describe('practice level helpers', () => {
  it('orders and names the four levels', () => {
    expect([...PRACTICE_LEVELS]).toEqual([
      'STARTER',
      'BASIC',
      'INTERMEDIATE',
      'ADVANCED',
    ]);
    expect(PRACTICE_LEVELS.map(practiceLevelRank)).toEqual([0, 1, 2, 3]);
    expect(practiceLevelLabel('STARTER')).toBe('Mất gốc');
    expect(practiceLevelLabel('ADVANCED')).toBe('Nâng cao');
    expect(practiceLevelLabel(null)).toBeNull();
  });

  it('recognises only the four levels', () => {
    expect(isPracticeLevel('BASIC')).toBe(true);
    expect(isPracticeLevel('BEGINNER')).toBe(false);
    expect(isPracticeLevel('B1')).toBe(false);
  });
});

describe('titles', () => {
  it('names a listening lesson by its form', () => {
    expect(listeningTitleLabel('DIALOGUE')).toBe('Hội thoại');
    expect(listeningTitleLabel('DICTATION')).toBe('Nghe chép');
    expect(listeningTitleLabel('COMPREHENSION')).toBe('Nghe hiểu');
    expect(listeningTitleLabel(undefined)).toBe('Listening');
  });

  it('swaps the head word and keeps the old level head', () => {
    expect(relabelTitleHead('Listening A2 — Work', 'Nghe hiểu')).toBe(
      'Nghe hiểu A2 — Work',
    );
    expect(relabelTitleHead('Work day', 'Nghe hiểu')).toBe('Work day');
  });

  it('keeps an old title head on edit, which titles are looked up by', () => {
    expect(keepTitleHead('Listening B1 — Workplace', 'Workplace calls')).toBe(
      'Listening B1 — Workplace calls',
    );
    expect(
      keepTitleHead('Listening B1 — Workplace', 'Nghe chép B1 — Calls'),
    ).toBe('Nghe chép B1 — Calls');
    expect(keepTitleHead('Thư phản hồi — Dời lịch họp', 'Dời lịch')).toBe(
      'Dời lịch',
    );
    expect(keepTitleHead('Work day', 'Work days')).toBe('Work days');
  });
});

describe('isDictationContent', () => {
  it('reads the listening mode from the quiz metadata', () => {
    expect(isDictationContent({ mode: 'DICTATION' })).toBe(true);
    expect(isDictationContent({ mode: 'DIALOGUE' })).toBe(false);
    expect(isDictationContent(null)).toBe(false);
  });
});
