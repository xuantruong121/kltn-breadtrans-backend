/**
 * Regression tests for the Entry Diagnostic scoring contract.
 *
 * DIAG-001: the reported score dropped Speaking-labelled MCQs from the
 *           numerator while keeping them in the denominator.
 * DIAG-002 / DIAG-008: the scoring algorithm must come from the persisted
 *           scoringVersion only, and a version this build does not run must
 *           stop (fail closed), never fall back to another scorer.
 *
 * FOUR_SKILL_PLACEMENT_V2 is the only version this build runs. The retired
 * ones (OBJECTIVE_POOLED_V1, SECTION_BAND_V2) are tested here only as
 * versions that are refused.
 */
import { DiagnosticService } from './diagnostic.service';
import {
  SUPPORTED_DIAGNOSTIC_SCORING_VERSIONS,
  resolvePersistedScoringVersion,
  buildSkillProfiles,
  describeAdministeredForm,
  type DiagnosticQuestionForScoring,
} from './diagnostic.logic';

/** A 20-item objective form with Speaking/Writing labelled but objective. */
function twentyItemForm(): DiagnosticQuestionForScoring[] {
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

describe('Entry Diagnostic objective scoring (DIAG-001)', () => {
  it('counts every objective item, including Speaking-labelled MCQs', () => {
    const questions = twentyItemForm();
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

  it('keeps the numerator and denominator over the same item set', () => {
    const questions = twentyItemForm();
    for (let correct = 0; correct <= 20; correct += 1) {
      const answers = answersWith(questions, correct);
      const profiles = buildSkillProfiles(questions, answers);
      const numerator = profiles.reduce((sum, p) => sum + p.correctCount, 0);
      expect(numerator).toBeLessThanOrEqual(questions.length);
      expect(numerator).toBe(correct);
    }
  });
});

describe('Entry Diagnostic administered form (DIAG-003)', () => {
  it('describes what was actually administered', () => {
    expect(describeAdministeredForm(twentyItemForm())).toEqual({
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
  });
});

describe('Entry Diagnostic persisted scoring version', () => {
  it('resolves FOUR_SKILL_PLACEMENT_V2 from its persisted version', () => {
    expect(resolvePersistedScoringVersion('FOUR_SKILL_PLACEMENT_V2')).toBe(
      'FOUR_SKILL_PLACEMENT_V2',
    );
  });

  it('takes only the stored version, so nothing about the content can reach it', () => {
    // Arity 1: there is no parameter through which an id, title, question
    // count or item metadata could influence the decision.
    expect(resolvePersistedScoringVersion.length).toBe(1);
  });

  it('fails closed when there is no persisted version', () => {
    for (const value of [null, undefined, '', '   ']) {
      expect(() => resolvePersistedScoringVersion(value)).toThrow(
        /DIAGNOSTIC_SCORER_UNSUPPORTED: assessment has no persisted scoringVersion/,
      );
    }
  });

  it.each([
    'OBJECTIVE_POOLED_V1',
    'SECTION_BAND_V2',
    'MADE_UP_V9',
    'four_skill_placement_v2',
  ])('refuses %s instead of falling back to another scorer', (version) => {
    expect(() => resolvePersistedScoringVersion(version)).toThrow(
      /DIAGNOSTIC_SCORER_UNSUPPORTED: unknown scoringVersion/,
    );
  });

  it('lists exactly the one version this build can run', () => {
    expect([...SUPPORTED_DIAGNOSTIC_SCORING_VERSIONS]).toEqual([
      'FOUR_SKILL_PLACEMENT_V2',
    ]);
  });
});

describe('Entry Diagnostic fails closed at the service level', () => {
  const questions = [1, 2, 3].map((id) => ({
    id,
    assessmentId: 9,
    skill: 'Reading',
    question: `Q${id}`,
    options: ['right', 'wrong'],
    correctIndex: 0,
    explanation: null,
    order: id,
  }));

  function assessment(scoringVersion: string | null) {
    return {
      id: 9,
      // A title that says "v2" must not matter: only the stored version counts.
      title: 'Entry Diagnostic v2',
      description: null,
      isActive: true,
      scoringVersion,
      blueprintVersion: 'X',
      contentVersion: 1,
      status: 'ACTIVE',
      questions,
    };
  }

  function build(options: {
    assessmentVersion: string | null;
    attempt?: Record<string, unknown> | null;
  }) {
    const prisma: any = {
      diagnosticAssessment: {
        findFirst: jest
          .fn()
          .mockResolvedValue(assessment(options.assessmentVersion)),
      },
      diagnosticAttempt: {
        findFirst: jest.fn().mockResolvedValue(options.attempt ?? null),
        findUnique: jest.fn().mockResolvedValue(options.attempt ?? null),
      },
      diagnosticSpeakingResponse: { findMany: jest.fn() },
      $transaction: jest.fn(),
      $executeRaw: jest.fn(),
    };
    return { prisma, service: new DiagnosticService(prisma, {} as any) };
  }

  const retired: Array<string | null> = [
    'OBJECTIVE_POOLED_V1',
    'SECTION_BAND_V2',
    '',
    null,
    'MADE_UP_V9',
  ];

  it.each(retired)(
    'refuses to start an attempt on an assessment stored as %p',
    async (version) => {
      const { prisma, service } = build({ assessmentVersion: version });
      await expect(service.startAttempt(7, 9)).rejects.toThrow(
        /DIAGNOSTIC_SCORER_UNSUPPORTED/,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it.each(retired)(
    'refuses to grade an attempt pinned as %p, even if the assessment now says V2',
    async (pinned) => {
      const { prisma, service } = build({
        assessmentVersion: 'FOUR_SKILL_PLACEMENT_V2',
        attempt: {
          id: 1,
          userId: 7,
          assessmentId: 9,
          status: 'IN_PROGRESS',
          answers: {},
          scoringVersion: pinned,
        },
      });
      await expect(
        service.submitAssessment(
          7,
          9,
          { '1': 'right', '2': 'right', '3': 'right' },
          undefined,
          1,
        ),
      ).rejects.toThrow(/DIAGNOSTIC_SCORER_UNSUPPORTED/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it.each(retired)(
    'refuses to show the stored result of an attempt pinned as %p',
    async (pinned) => {
      const { service } = build({
        assessmentVersion: 'FOUR_SKILL_PLACEMENT_V2',
        attempt: {
          id: 1,
          userId: 7,
          assessmentId: 9,
          status: 'COMPLETED',
          answers: {},
          correctCount: 3,
          totalCount: 3,
          percentage: 100,
          level: 'Intermediate',
          submittedAt: new Date(),
          scoringVersion: pinned,
        },
      });
      await expect(service.getLatestResult(7)).rejects.toThrow(
        /DIAGNOSTIC_SCORER_UNSUPPORTED/,
      );
      await expect(
        service.submitAssessment(7, 9, {}, undefined, 1),
      ).rejects.toThrow(/DIAGNOSTIC_SCORER_UNSUPPORTED/);
    },
  );
});
