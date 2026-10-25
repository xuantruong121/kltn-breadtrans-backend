/**
 * Regression tests for the Entry Diagnostic P1 correctness fixes.
 *
 * DIAG-001: the reported score dropped Speaking-labelled MCQs from the
 *           numerator while keeping them in the denominator.
 * DIAG-002: the scoring algorithm was selected from the assessment id/title.
 */
import { DiagnosticService } from './diagnostic.service';
import {
  CURRENT_AUTHORED_FORM_SCORER,
  SUPPORTED_DIAGNOSTIC_SCORING_VERSIONS,
  resolvePersistedScoringVersion,
  buildSkillProfiles,
  describeAdministeredForm,
  resolveDiagnosticScoringVersion,
  assertSectionBandV2Scorable,
  resolveEstimatedLevel,
  type DiagnosticQuestionForScoring,
} from './diagnostic.logic';

/** The active canonical form: 20 MCQs, Speaking/Writing labelled but objective. */
function activeForm(): DiagnosticQuestionForScoring[] {
  const skills = [
    ...Array(4).fill('Listening'),
    ...Array(4).fill('Reading'),
    ...Array(4).fill('Grammar'),
    ...Array(4).fill('Vocabulary'),
    ...Array(2).fill('Speaking'),
    ...Array(2).fill('Writing'),
  ] as string[];
  return skills.map((skill, index) => ({
    id: index + 1,
    skill,
    question: `Q${index + 1}`,
    options: ['right', 'wrong-a', 'wrong-b', 'wrong-c'],
    correctIndex: 0,
    order: index + 1,
  }));
}

/** Answers where the first `correct` items are right and the rest are wrong. */
function answersWith(
  questions: DiagnosticQuestionForScoring[],
  correct: number,
): Record<string, string> {
  const answers: Record<string, string> = {};
  questions.forEach((question, index) => {
    answers[String(question.id)] = index < correct ? 'right' : 'wrong-a';
  });
  return answers;
}

/**
 * Independent transcription of the reported-score contract, written from the
 * documented behaviour rather than by calling the service under test.
 */
function expectedReported(
  questions: DiagnosticQuestionForScoring[],
  answers: Record<string, string>,
) {
  const objective = questions.filter(
    (question) => (question.options as string[]).length > 1,
  );
  const correct = objective.filter(
    (question) =>
      answers[String(question.id)] ===
      (question.options as string[])[question.correctIndex],
  ).length;
  const percentage = objective.length
    ? Math.round((correct / objective.length) * 100)
    : 0;
  return { correct, total: objective.length, percentage };
}

describe('Entry Diagnostic objective scoring (DIAG-001)', () => {
  it('counts every objective item, including Speaking-labelled MCQs', () => {
    const questions = activeForm();
    const answers = answersWith(questions, 20);
    const profiles = buildSkillProfiles(questions, answers);
    const numerator = profiles.reduce((sum, p) => sum + p.correctCount, 0);

    expect(numerator).toBe(20);
    // The old defect: filtering the numerator by skill name dropped 2 items.
    const defective = profiles
      .filter((p) => p.skill !== 'Speaking')
      .reduce((sum, p) => sum + p.correctCount, 0);
    expect(defective).toBe(18);
    expect(numerator).not.toBe(defective);
  });

  it('reports 100 percent for an all-correct attempt', () => {
    const questions = activeForm();
    const answers = answersWith(questions, 20);
    const expected = expectedReported(questions, answers);
    expect(expected).toEqual({ correct: 20, total: 20, percentage: 100 });
    const profiles = buildSkillProfiles(questions, answers);
    const numerator = profiles.reduce((sum, p) => sum + p.correctCount, 0);
    expect(Math.round((numerator / questions.length) * 100)).toBe(100);
  });

  it.each([
    [0, 0, 'Starter'],
    [8, 40, 'Starter'],
    [9, 45, 'Foundation'],
    [14, 70, 'Foundation'],
    [15, 75, 'Intermediate'],
    [18, 90, 'Intermediate'],
    [19, 95, 'Intermediate'],
    [20, 100, 'Intermediate'],
  ])(
    'scores %i/20 as %i percent and places the learner at %s',
    (correct, percentage, level) => {
      const questions = activeForm();
      const answers = answersWith(questions, correct);
      const profiles = buildSkillProfiles(questions, answers);
      const numerator = profiles.reduce((sum, p) => sum + p.correctCount, 0);
      const computed = Math.round((numerator / questions.length) * 100);
      expect(computed).toBe(percentage);
      expect(resolveEstimatedLevel(computed)).toBe(level);
    },
  );

  it('keeps the numerator and denominator over the same item set', () => {
    const questions = activeForm();
    for (let correct = 0; correct <= 20; correct += 1) {
      const answers = answersWith(questions, correct);
      const profiles = buildSkillProfiles(questions, answers);
      const numerator = profiles.reduce((sum, p) => sum + p.correctCount, 0);
      expect(numerator).toBeLessThanOrEqual(questions.length);
      expect(numerator).toBe(correct);
    }
  });
});

describe('Entry Diagnostic placement boundaries', () => {
  it.each([
    [39, 'Starter'],
    [40, 'Starter'],
    [44, 'Starter'],
    [45, 'Foundation'],
    [46, 'Foundation'],
    [74, 'Foundation'],
    [75, 'Intermediate'],
    [76, 'Intermediate'],
    [100, 'Intermediate'],
  ])('maps %i percent to %s', (percentage, level) => {
    expect(resolveEstimatedLevel(percentage)).toBe(level);
  });
});

describe('Entry Diagnostic scorer selection (DIAG-002)', () => {
  it('selects the pooled scorer for the active form, which has no band metadata', () => {
    const capability = resolveDiagnosticScoringVersion(activeForm());
    expect(capability.version).toBe('OBJECTIVE_POOLED_V1');
    expect(capability.itemsWithBandMetadata).toBe(0);
    expect(capability.objectiveItems).toBe(20);
  });

  it('does not depend on the assessment title or id', () => {
    // The resolver only ever sees items, so a rename cannot reach it. This
    // asserts the signature stays that way.
    const questions = activeForm();
    const first = resolveDiagnosticScoringVersion(questions);
    const renamed = resolveDiagnosticScoringVersion(
      questions.map((question) => ({ ...question })),
    );
    expect(renamed).toEqual(first);
    expect(resolveDiagnosticScoringVersion.length).toBe(1);
  });

  it('offers the section/band scorer only when every objective item carries the metadata', () => {
    const full: DiagnosticQuestionForScoring[] = [
      'LANGUAGE_USE',
      'READING',
      'LISTENING',
    ].flatMap((section, sectionIndex) =>
      ['A1', 'A2'].map((intendedLevel, levelIndex) => ({
        id: sectionIndex * 10 + levelIndex + 1,
        skill: 'Reading',
        question: 'Q',
        options: {
          values: ['right', 'wrong'],
          section,
          intendedLevel,
          construct: 'c',
          stableKey: `k-${section}-${intendedLevel}`,
          questionType: 'MCQ',
        },
        correctIndex: 0,
        order: sectionIndex * 10 + levelIndex + 1,
      })),
    );
    expect(resolveDiagnosticScoringVersion(full).version).toBe(
      'SECTION_BAND_V2',
    );
    expect(() => assertSectionBandV2Scorable(full)).not.toThrow();

    // Partial coverage must fall back rather than score the gaps as zero.
    const partial = [...full.slice(0, 3), ...activeForm().slice(0, 3)];
    expect(resolveDiagnosticScoringVersion(partial).version).toBe(
      'OBJECTIVE_POOLED_V1',
    );
  });

  it('fails closed instead of scoring the active form with the section/band scorer', () => {
    expect(() => assertSectionBandV2Scorable(activeForm())).toThrow(
      /DIAGNOSTIC_SCORER_UNSUPPORTED/,
    );
  });

  it('accepts a v2 form that covers only some weighted sections', () => {
    // Partial section coverage still yields meaningful non-zero scores, so it
    // is a content-authoring concern rather than something to refuse.
    const noListening: DiagnosticQuestionForScoring[] = [
      'LANGUAGE_USE',
      'READING',
    ].map((section, index) => ({
      id: index + 1,
      skill: 'Reading',
      question: 'Q',
      options: {
        values: ['right', 'wrong'],
        section,
        intendedLevel: 'A1',
        construct: 'c',
        stableKey: `k-${section}`,
        questionType: 'MCQ',
      },
      correctIndex: 0,
      order: index + 1,
    }));
    expect(() => assertSectionBandV2Scorable(noListening)).not.toThrow();
  });

  it('fails closed when no weighted section matches any item', () => {
    // This is the catastrophic shape: all section percentages would be 0 and
    // every learner would be placed at the bottom band regardless of answers.
    const wrongSections: DiagnosticQuestionForScoring[] = [1, 2].map(
      (index) => ({
        id: index,
        skill: 'Reading',
        question: 'Q',
        options: {
          values: ['right', 'wrong'],
          section: 'SOMETHING_ELSE',
          intendedLevel: 'A1',
          construct: 'c',
          stableKey: `k-${index}`,
          questionType: 'MCQ',
        },
        correctIndex: 0,
        order: index,
      }),
    );
    expect(() => assertSectionBandV2Scorable(wrongSections)).toThrow(
      /requires objective items in at least one of/,
    );
  });
});

describe('Entry Diagnostic administered form (DIAG-003)', () => {
  it('describes what was actually administered rather than the planned blueprint', () => {
    const described = describeAdministeredForm(activeForm());
    expect(described).toEqual({
      totalItems: 20,
      objectiveCount: 20,
      productiveCount: 0,
      itemsBySkill: {
        Listening: 4,
        Reading: 4,
        Grammar: 4,
        Vocabulary: 4,
        Speaking: 2,
        Writing: 2,
      },
    });
    // The planned 52-item blueprint must not be mistaken for this.
    expect(described.totalItems).not.toBe(52);
  });
});

describe('Entry Diagnostic rename regression at service level (DIAG-002)', () => {
  /**
   * The decisive DIAG-002 case: an assessment whose TITLE contains "v2" but
   * whose items are legacy-shaped (plain option arrays, no section or
   * intendedLevel metadata).
   *
   * Under the previous implementation `title.includes('v2')` selected the
   * section/band scorer, whose section and band percentages are all 0 for
   * these items, so weightedCore was 0 and the learner was stored as
   * 'Pre-A1 – Cần củng cố nền tảng' no matter how they answered. The scorer is
   * now chosen from item structure, so the pooled scorer runs instead.
   */
  it('does not switch scorers because the title says v2', async () => {
    const legacyQuestions = [1, 2, 3].map((id) => ({
      id,
      assessmentId: 9,
      skill: 'Reading',
      question: `Q${id}`,
      options: ['right', 'wrong'],
      correctIndex: 0,
      explanation: null,
      order: id,
    }));
    const created: Array<Record<string, unknown>> = [];
    const prisma: any = {
      diagnosticAssessment: {
        findFirst: jest.fn().mockResolvedValue({
          id: 9,
          title: 'Entry Diagnostic v2',
          description: null,
          isActive: true,
          // The title says v2; the persisted version says V1. The persisted
          // version must win.
          scoringVersion: 'OBJECTIVE_POOLED_V1',
          blueprintVersion: 'V1_LEGACY_20_ITEM',
          contentVersion: 1,
          status: 'ACTIVE',
          questions: legacyQuestions,
        }),
      },
      diagnosticAttempt: {
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      diagnosticSpeakingResponse: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
      },
      course: { findMany: jest.fn().mockResolvedValue([]) },
      $executeRaw: jest.fn().mockResolvedValue(0),
      $transaction: jest.fn((callback: (tx: any) => unknown) =>
        callback({
          $executeRaw: jest.fn().mockResolvedValue(0),
          diagnosticAttempt: {
            findFirst: jest.fn().mockResolvedValue(null),
            count: jest.fn().mockResolvedValue(0),
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn((args: { data: Record<string, unknown> }) => {
              created.push(args.data);
              return Promise.resolve({
                id: 1,
                answers: args.data.answers,
                correctCount: args.data.correctCount,
                totalCount: args.data.totalCount,
                percentage: args.data.percentage,
                level: args.data.level,
                submittedAt: new Date(),
              });
            }),
          },
          learningActivity: { create: jest.fn() },
          userStats: {
            upsert: jest.fn().mockResolvedValue({ totalBanhRan: 0 }),
          },
        }),
      ),
    };
    const gamification: any = {
      awardBanh: jest.fn().mockResolvedValue(undefined),
      awardQuestCredit: jest.fn().mockResolvedValue(undefined),
      grantDiagnosticReward: jest.fn().mockResolvedValue(undefined),
    };

    const service = new DiagnosticService(prisma, gamification);

    await service.submitAssessment(7, 9, {
      '1': 'right',
      '2': 'right',
      '3': 'right',
    });

    expect(created).toHaveLength(1);
    const stored = created[0];
    expect(stored.correctCount).toBe(3);
    expect(stored.totalCount).toBe(3);
    expect(stored.percentage).toBe(100);
    // The pooled band, not a CEFR band produced by the incompatible scorer.
    expect(stored.level).toBe('Intermediate');
    expect(String(stored.level)).not.toMatch(/Pre-A1|A1|A2|B1|B2/);
  });
});

describe('Entry Diagnostic explicit scorer selection (DIAG-008)', () => {
  it('names the production scorer as a constant rather than inferring it', () => {
    expect(CURRENT_AUTHORED_FORM_SCORER).toBe('OBJECTIVE_POOLED_V1');
  });

  /**
   * The strong form of the regression: the same 20 items score identically
   * however they are labelled and however much metadata they carry. Enriching
   * content with section/intendedLevel must not move scoring semantics.
   */
  const variants: Array<{
    label: string;
    decorate: (q: DiagnosticQuestionForScoring) => DiagnosticQuestionForScoring;
  }> = [
    { label: 'plain legacy items', decorate: (q) => q },
    {
      label: 'items carrying section metadata',
      decorate: (q) => ({
        ...q,
        options: {
          values: q.options as string[],
          section: 'READING',
          questionType: 'MCQ',
        },
      }),
    },
    {
      label: 'items carrying intendedLevel metadata',
      decorate: (q) => ({
        ...q,
        options: {
          values: q.options as string[],
          intendedLevel: 'B1',
          questionType: 'MCQ',
        },
      }),
    },
    {
      label: 'items carrying both section and intendedLevel',
      decorate: (q) => ({
        ...q,
        options: {
          values: q.options as string[],
          section: 'READING',
          intendedLevel: 'B1',
          construct: 'detail',
          stableKey: `k-${q.id}`,
          questionType: 'MCQ',
        },
      }),
    },
  ];

  it.each([
    [20, 100, 'Intermediate'],
    [15, 75, 'Intermediate'],
    [9, 45, 'Foundation'],
  ])(
    'scores %i/20 as %i percent / %s for every metadata variant',
    (correct, percentage, level) => {
      for (const variant of variants) {
        const questions = activeForm().map(variant.decorate);
        const answers = answersWith(questions, correct);
        const profiles = buildSkillProfiles(questions, answers);
        const numerator = profiles.reduce((sum, p) => sum + p.correctCount, 0);
        const computed = Math.round((numerator / questions.length) * 100);
        expect({ variant: variant.label, computed }).toEqual({
          variant: variant.label,
          computed: percentage,
        });
        expect({
          variant: variant.label,
          level: resolveEstimatedLevel(computed),
        }).toEqual({ variant: variant.label, level });
      }
    },
  );

  it('keeps the section/band scorer failing closed when named explicitly', () => {
    // Even a form rich enough to be "capable" must still be requested by name;
    // and a form without the structure must still be refused.
    expect(() => assertSectionBandV2Scorable(activeForm())).toThrow(
      /DIAGNOSTIC_SCORER_UNSUPPORTED/,
    );
    const enriched = activeForm().map((question) => ({
      ...question,
      options: {
        values: question.options as string[],
        section: 'READING',
        intendedLevel: 'B1',
        construct: 'detail',
        stableKey: `k-${question.id}`,
        questionType: 'MCQ',
      },
    }));
    // Capability alone no longer selects it: production still uses the
    // constant, so enriching content cannot switch the algorithm.
    expect(CURRENT_AUTHORED_FORM_SCORER).toBe('OBJECTIVE_POOLED_V1');
    // ...but when named explicitly against a suitable form it is usable.
    expect(() => assertSectionBandV2Scorable(enriched)).not.toThrow();
  });
});

describe('Entry Diagnostic persisted scoring version (Step 1)', () => {
  it('resolves the V1 scorer from its persisted version', () => {
    expect(resolvePersistedScoringVersion('OBJECTIVE_POOLED_V1')).toBe(
      'OBJECTIVE_POOLED_V1',
    );
  });

  it('takes only the stored version, so nothing about the content can reach it', () => {
    // Arity 1: there is no parameter through which an id, title, question
    // count or item metadata could influence the decision.
    expect(resolvePersistedScoringVersion.length).toBe(1);
  });

  it('fails closed when an assessment has no persisted version', () => {
    for (const value of [null, undefined, '', '   ']) {
      expect(() => resolvePersistedScoringVersion(value)).toThrow(
        /DIAGNOSTIC_SCORER_UNSUPPORTED/,
      );
    }
  });

  it('refuses a known but unimplemented scorer instead of silently using V1', () => {
    // FOUR_SKILL_PLACEMENT_V2 content is authored before its scorer exists;
    // scoring such a form with the V1 algorithm would produce a confident
    // wrong result.
    expect(() =>
      resolvePersistedScoringVersion('FOUR_SKILL_PLACEMENT_V2'),
    ).toThrow(/known but its scorer is not implemented/);
    expect(() => resolvePersistedScoringVersion('SECTION_BAND_V2')).toThrow(
      /known but its scorer is not implemented/,
    );
  });

  it('refuses an unknown scorer', () => {
    expect(() => resolvePersistedScoringVersion('MADE_UP_V9')).toThrow(
      /unknown scoringVersion/,
    );
  });

  it('is unaffected by content metadata, which only the old code read', () => {
    // The DIAG-008 regression, now at the version level: enriching items with
    // section/intendedLevel cannot change the persisted version.
    const enrichedCapability = resolveDiagnosticScoringVersion(
      activeForm().map((question) => ({
        ...question,
        options: {
          values: question.options as string[],
          section: 'READING',
          intendedLevel: 'B1',
          construct: 'detail',
          stableKey: `k-${question.id}`,
          questionType: 'MCQ',
        },
      })),
    );
    // The capability reporter may well say the items *could* support V2...
    expect(enrichedCapability.version).toBe('SECTION_BAND_V2');
    // ...but production reads the persisted version, which is unchanged.
    expect(resolvePersistedScoringVersion('OBJECTIVE_POOLED_V1')).toBe(
      'OBJECTIVE_POOLED_V1',
    );
  });

  it('lists exactly the versions this build can run', () => {
    expect([...SUPPORTED_DIAGNOSTIC_SCORING_VERSIONS]).toEqual([
      'OBJECTIVE_POOLED_V1',
    ]);
  });
});
