import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  CANONICAL_DIAGNOSTIC_BLUEPRINT,
  getAttemptQuestionPermutation,
  isDiagnosticAnswerCorrect,
  buildPracticeRecommendations,
  buildStrengthsAndWeaknesses,
  buildSkillProfiles,
  resolvePlacementLevel,
  resolveEstimatedLevel,
} from './diagnostic.logic';
import { DiagnosticService } from './diagnostic.service';

describe('Entry Diagnostic 2.0 UX & Data Integrity Repair Tests', () => {
  describe('Canonical Blueprint Invariants', () => {
    it('defines 52 total items, 48 objective, and 4 productive items across 5 sections', () => {
      expect(CANONICAL_DIAGNOSTIC_BLUEPRINT.totalItems).toBe(52);
      expect(CANONICAL_DIAGNOSTIC_BLUEPRINT.objectiveCount).toBe(48);
      expect(CANONICAL_DIAGNOSTIC_BLUEPRINT.productiveCount).toBe(4);
      expect(CANONICAL_DIAGNOSTIC_BLUEPRINT.sections.LANGUAGE_USE.total).toBe(
        16,
      );
      expect(CANONICAL_DIAGNOSTIC_BLUEPRINT.sections.READING.total).toBe(16);
      expect(CANONICAL_DIAGNOSTIC_BLUEPRINT.sections.LISTENING.total).toBe(16);
      expect(CANONICAL_DIAGNOSTIC_BLUEPRINT.sections.SPEAKING.total).toBe(2);
      expect(CANONICAL_DIAGNOSTIC_BLUEPRINT.sections.WRITING.total).toBe(2);
    });

    it('enforces exact 8 Grammar + 8 Vocabulary in Language Use blueprint', () => {
      const lu = CANONICAL_DIAGNOSTIC_BLUEPRINT.sections.LANGUAGE_USE;
      expect(lu.grammarTotal).toBe(8);
      expect(lu.vocabularyTotal).toBe(8);
      expect(lu.grammarTotal + lu.vocabularyTotal).toBe(16);
      expect(lu.total).toBe(16);
    });
  });

  describe('Result Arithmetic Invariant', () => {
    it('guarantees overallObjectiveCorrect == sum(skillCorrect) with permutations', () => {
      const mockQuestions = [
        {
          id: 2001,
          skill: 'Grammar',
          question: 'Q1',
          options: ['A', 'B', 'C', 'D'],
          correctIndex: 1,
          explanation: null,
          order: 1,
        },
        {
          id: 2002,
          skill: 'Grammar',
          question: 'Q2',
          options: ['A', 'B', 'C', 'D'],
          correctIndex: 0,
          explanation: null,
          order: 2,
        },
        {
          id: 2003,
          skill: 'Vocabulary',
          question: 'Q3',
          options: ['A', 'B', 'C', 'D'],
          correctIndex: 2,
          explanation: null,
          order: 3,
        },
        {
          id: 2004,
          skill: 'Vocabulary',
          question: 'Q4',
          options: ['A', 'B', 'C', 'D'],
          correctIndex: 3,
          explanation: null,
          order: 4,
        },
        {
          id: 2017,
          skill: 'Reading',
          question: 'Q5',
          options: ['A', 'B', 'C', 'D'],
          correctIndex: 0,
          explanation: null,
          order: 5,
        },
        {
          id: 2033,
          skill: 'Listening',
          question: 'Q6',
          options: ['A', 'B', 'C', 'D'],
          correctIndex: 1,
          explanation: null,
          order: 6,
        },
      ];

      const attemptId = 999;
      const permutations: Record<number, number[]> = {};
      for (const q of mockQuestions) {
        permutations[q.id] = getAttemptQuestionPermutation(
          attemptId,
          q.id,
          q.options.length,
        );
      }

      // User selects displayed index that in Q1 and Q3 maps to correct, others wrong
      // perm: displayedIndex -> originalIndex
      // For Q1 (correctIndex=1): find displayed index where perm[idx] === 1
      const q1CorrectDisplayed = permutations[2001].indexOf(1);
      // For Q3 (correctIndex=2): find displayed index where perm[idx] === 2
      const q3CorrectDisplayed = permutations[2003].indexOf(2);

      const answers: Record<string, number> = {
        '2001': q1CorrectDisplayed, // Correct Grammar
        '2002': (permutations[2002].indexOf(0) + 1) % 4, // Wrong Grammar
        '2003': q3CorrectDisplayed, // Correct Vocab
        '2004': (permutations[2004].indexOf(3) + 1) % 4, // Wrong Vocab
        '2017': (permutations[2017].indexOf(0) + 1) % 4, // Wrong Reading
        '2033': (permutations[2033].indexOf(1) + 1) % 4, // Wrong Listening
      };

      const profiles = buildSkillProfiles(mockQuestions, answers, permutations);
      const sumSkillCorrect = profiles.reduce(
        (sum, p) => sum + p.correctCount,
        0,
      );

      const evaluatedCorrectCount = mockQuestions.filter((q) =>
        isDiagnosticAnswerCorrect(q, answers[String(q.id)], permutations[q.id]),
      ).length;

      expect(sumSkillCorrect).toBe(2);
      expect(evaluatedCorrectCount).toBe(2);
      expect(sumSkillCorrect).toBe(evaluatedCorrectCount);

      const grammarProfile = profiles.find((p) => p.skill === 'Grammar');
      const vocabProfile = profiles.find((p) => p.skill === 'Vocabulary');
      const readingProfile = profiles.find((p) => p.skill === 'Reading');
      const listeningProfile = profiles.find((p) => p.skill === 'Listening');

      expect(grammarProfile?.correctCount).toBe(1);
      expect(vocabProfile?.correctCount).toBe(1);
      expect(readingProfile?.correctCount).toBe(0);
      expect(listeningProfile?.correctCount).toBe(0);
    });
  });

  describe('Option Randomization & Evaluation', () => {
    it('generates deterministic stable permutation for a given attempt and question', () => {
      const perm1 = getAttemptQuestionPermutation(101, 2017, 4);
      const perm2 = getAttemptQuestionPermutation(101, 2017, 4);
      expect(perm1).toEqual(perm2);
      expect(perm1.length).toBe(4);
      expect(new Set(perm1).size).toBe(4);
    });

    it('generates different permutations across different attempts', () => {
      const permutationsA = [1, 2, 3, 4, 5].map((q) =>
        getAttemptQuestionPermutation(101, q, 4),
      );
      const permutationsB = [1, 2, 3, 4, 5].map((q) =>
        getAttemptQuestionPermutation(202, q, 4),
      );
      expect(JSON.stringify(permutationsA)).not.toEqual(
        JSON.stringify(permutationsB),
      );
    });

    it('evaluates correctness by stable option identity and handles duplicate option text safely', () => {
      const question = {
        id: 1,
        skill: 'Reading',
        question: 'What time does the library open?',
        options: ['At 8:00', 'At 9:00', 'At 8:00', 'At 11:00'], // Note: intentional duplicate text for regression testing
        correctIndex: 0,
        explanation: 'Opens at 8:00',
        order: 1,
      };

      // By stable originalIndex object
      expect(isDiagnosticAnswerCorrect(question, { originalIndex: 0 })).toBe(
        true,
      );
      expect(isDiagnosticAnswerCorrect(question, { originalIndex: 2 })).toBe(
        false,
      );

      // By permutation mapped index
      const permutation = [2, 0, 1, 3]; // position 1 maps to original 0 (correct)
      expect(isDiagnosticAnswerCorrect(question, 1, permutation)).toBe(true);
      expect(isDiagnosticAnswerCorrect(question, 0, permutation)).toBe(false);

      // Changing display position does not change correctness
      const otherPermutation = [3, 1, 0, 2]; // position 2 maps to original 0
      expect(isDiagnosticAnswerCorrect(question, 2, otherPermutation)).toBe(
        true,
      );
      expect(isDiagnosticAnswerCorrect(question, 1, otherPermutation)).toBe(
        false,
      );
    });
  });

  describe('Strength Logic & Level Wording', () => {
    it('produces empty strengths when all scores are low (no false positive strength)', () => {
      const lowProfiles = [
        {
          skill: 'Grammar',
          correctCount: 2,
          totalCount: 8,
          percentage: 25,
          evidence: 'SUFFICIENT' as const,
        },
        {
          skill: 'Vocabulary',
          correctCount: 2,
          totalCount: 8,
          percentage: 25,
          evidence: 'SUFFICIENT' as const,
        },
        {
          skill: 'Reading',
          correctCount: 4,
          totalCount: 16,
          percentage: 25,
          evidence: 'SUFFICIENT' as const,
        },
        {
          skill: 'Listening',
          correctCount: 4,
          totalCount: 16,
          percentage: 25,
          evidence: 'SUFFICIENT' as const,
        },
      ];
      const result = buildStrengthsAndWeaknesses(lowProfiles);
      expect(result.strengths).toEqual([]);
      expect(result.weaknesses.length).toBe(4);
    });

    it('correctly identifies single strong skill and sorts weaknesses from weakest to strongest', () => {
      const mixedProfiles = [
        {
          skill: 'Grammar',
          correctCount: 7,
          totalCount: 8,
          percentage: 88,
          evidence: 'SUFFICIENT' as const,
        },
        {
          skill: 'Vocabulary',
          correctCount: 1,
          totalCount: 8,
          percentage: 13,
          evidence: 'SUFFICIENT' as const,
        },
        {
          skill: 'Reading',
          correctCount: 8,
          totalCount: 16,
          percentage: 50,
          evidence: 'SUFFICIENT' as const,
        },
      ];
      const result = buildStrengthsAndWeaknesses(mixedProfiles);
      expect(result.strengths).toEqual(['Grammar']);
      // Weaknesses sorted ascending: Vocabulary (13%) before Reading (50%)
      expect(result.weaknesses).toEqual(['Vocabulary', 'Reading']);
    });

    it('returns natural Vietnamese wording for CEFR placement levels', () => {
      expect(resolvePlacementLevel({}, {})).toBe(
        'Pre-A1 – Cần củng cố nền tảng',
      );
      expect(
        resolvePlacementLevel({ CORE: 75 }, { A1: 85, A2: 80, B1: 75, B2: 70 }),
      ).toBe('B2 – Trung cấp trên');
      expect(
        resolvePlacementLevel({ CORE: 70 }, { A1: 85, A2: 80, B1: 75, B2: 50 }),
      ).toBe('B1 – Trung cấp');
      expect(resolveEstimatedLevel(80)).toBe('Intermediate');
      expect(resolveEstimatedLevel(50)).toBe('Foundation');
      expect(resolveEstimatedLevel(20)).toBe('Starter');
    });
  });

  describe('Practice Recommendations & Concrete Mapping', () => {
    it('maps wrong questions to concrete BreadTrans practice topics and routes', () => {
      const wrongQuestions = [
        {
          id: 2002,
          skill: 'Grammar',
          question: 'Every morning, Sam ___ coffee before work.',
          options: {
            values: ['drink', 'drinks', 'drinking', 'drank'],
            construct: 'basic present',
            intendedLevel: 'A1',
          },
          correctIndex: 1,
          explanation: null,
          order: 2,
        },
        {
          id: 2004,
          skill: 'Vocabulary',
          question: 'The keys are ___ the drawer.',
          options: {
            values: ['at', 'in', 'on', 'to'],
            construct: 'basic prepositions',
            intendedLevel: 'A1',
          },
          correctIndex: 1,
          explanation: null,
          order: 4,
        },
        {
          id: 2017,
          skill: 'Reading',
          question: 'What time is the library open?',
          options: {
            values: ['8:00', '9:00', '10:00', '11:00'],
            intendedLevel: 'A2',
          },
          correctIndex: 0,
          explanation: null,
          order: 17,
        },
      ];

      const recs = buildPracticeRecommendations(
        'Pre-A1 – Cần củng cố nền tảng',
        ['Grammar', 'Vocabulary', 'Reading'],
        wrongQuestions,
      );

      expect(recs.length).toBeGreaterThanOrEqual(3);
      expect(
        recs.some((r) => r.route === '/reading?category=grammar&topicId=1'),
      ).toBe(true);
      expect(recs.some((r) => r.route === '/vocabulary/study?topicId=1')).toBe(
        true,
      );
      expect(recs.some((r) => r.route === '/reading/2')).toBe(true);
      // Real routes only, no courses
      expect(recs.every((r) => !r.route.includes('/courses'))).toBe(true);
      // Check deduplication
      const ids = recs.map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('falls back safely when no specific construct matches', () => {
      const recs = buildPracticeRecommendations('A1 – Sơ cấp', [
        'Speaking',
        'Writing',
      ]);
      expect(recs.length).toBeGreaterThanOrEqual(2);
      expect(
        recs.some((r) => r.route === '/speaking/pronunciation-foundations'),
      ).toBe(true);
      expect(recs.some((r) => r.route === '/writing/3')).toBe(true);
    });
  });

  describe('One Official Attempt Enforcement in Service', () => {
    it('blocks retaking when a completed attempt already exists', async () => {
      const mockPrisma: any = {
        diagnosticAssessment: {
          findFirst: jest.fn().mockResolvedValue({
            id: 2,
            isActive: true,
            questions: [
              {
                id: 1,
                skill: 'Grammar',
                question: 'Q1',
                options: ['a', 'b'],
                correctIndex: 0,
                explanation: null,
                order: 1,
              },
            ],
          }),
        },
        diagnosticAttempt: {
          findFirst: jest.fn().mockImplementation(({ where }) => {
            if (where.status === 'COMPLETED') {
              return Promise.resolve({
                id: 99,
                userId: 1,
                assessmentId: 2,
                status: 'COMPLETED',
                submissionToken: 'token-99',
              });
            }
            return Promise.resolve(null);
          }),
        },
      };

      const service = new DiagnosticService(mockPrisma);
      const res = await service.startAttempt(1, 2);
      expect(res.hasCompleted).toBe(true);
      expect(res.attemptId).toBe(99);
      expect(res.status).toBe('COMPLETED');
    });

    it('resumes IN_PROGRESS attempt without creating a new one', async () => {
      const mockPrisma: any = {
        diagnosticAssessment: {
          findFirst: jest.fn().mockResolvedValue({
            id: 2,
            isActive: true,
            questions: [
              {
                id: 1,
                skill: 'Grammar',
                question: 'Q1',
                options: ['a', 'b'],
                correctIndex: 0,
                explanation: null,
                order: 1,
              },
            ],
          }),
        },
        diagnosticAttempt: {
          findFirst: jest.fn().mockImplementation(({ where }) => {
            if (where.status === 'COMPLETED') return Promise.resolve(null);
            if (where.status === 'IN_PROGRESS') {
              return Promise.resolve({
                id: 55,
                userId: 1,
                assessmentId: 2,
                status: 'IN_PROGRESS',
                submissionToken: 'token-55',
              });
            }
            return Promise.resolve(null);
          }),
        },
      };

      const service = new DiagnosticService(mockPrisma);
      const res = await service.startAttempt(1, 2);
      expect(res.hasCompleted).toBe(false);
      expect(res.attemptId).toBe(55);
      expect(res.status).toBe('IN_PROGRESS');
    });
  });

  describe('Language Use Semantic Blueprint & Balance Validation', () => {
    function getArtifactPath(subPath: string) {
      const p1 = join(process.cwd(), '..', '..', 'artifacts', subPath);
      if (existsSync(p1)) return p1;
      const p2 = join(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        '..',
        'artifacts',
        subPath,
      );
      if (existsSync(p2)) return p2;
      return p1;
    }

    interface SemanticMatrixItem {
      id: number;
      order: number;
      stableKey: string;
      stem: string;
      construct: string;
      skill: string;
      cefr?: string;
      CEFR?: string;
      activeInForm: boolean;
      activeSource: string;
    }

    interface BankAuditQuestion {
      questionId?: number;
      id?: number;
      order: number;
      stableKey: string;
      stem?: string;
      prompt?: string;
      skill: string;
      cefr?: string;
      intendedLevel?: string;
      currentDifficulty?: string;
      questionType?: string;
      correctAnswer?: number;
      options: unknown[];
      active?: boolean;
    }

    const artifactPath = getArtifactPath(
      join(
        'entry-diagnostic-semantic-blueprint',
        'final-language-use-matrix.json',
      ),
    );
    const bankAuditPath = getArtifactPath(
      join('entry-diagnostic-2', 'entry-diagnostic-question-audit-after.json'),
    );

    it('enforces exact 8 Grammar + 8 Vocabulary parity with 2 per CEFR band in Language Use', () => {
      expect(existsSync(artifactPath)).toBe(true);
      const matrix = JSON.parse(
        readFileSync(artifactPath, 'utf8'),
      ) as SemanticMatrixItem[];

      expect(matrix).toHaveLength(16);

      const grammarItems = matrix.filter(
        (item: SemanticMatrixItem) => item.skill === 'Grammar',
      );
      const vocabItems = matrix.filter(
        (item: SemanticMatrixItem) => item.skill === 'Vocabulary',
      );

      expect(grammarItems).toHaveLength(8);
      expect(vocabItems).toHaveLength(8);

      const bands = ['A1', 'A2', 'B1', 'B2'];
      for (const band of bands) {
        const bandGrammar = grammarItems.filter(
          (i: SemanticMatrixItem) => (i.cefr || i.CEFR) === band,
        );
        const bandVocab = vocabItems.filter(
          (i: SemanticMatrixItem) => (i.cefr || i.CEFR) === band,
        );
        expect(bandGrammar).toHaveLength(2);
        expect(bandVocab).toHaveLength(2);
      }
    });

    it('validates CEFR metadata, option correctness, and guarantees no duplicate keys or collisions', () => {
      expect(existsSync(artifactPath)).toBe(true);
      expect(existsSync(bankAuditPath)).toBe(true);
      const matrix = JSON.parse(
        readFileSync(artifactPath, 'utf8'),
      ) as SemanticMatrixItem[];
      const bank = JSON.parse(
        readFileSync(bankAuditPath, 'utf8'),
      ) as BankAuditQuestion[];

      const validBands = new Set(['A1', 'A2', 'B1', 'B2']);
      for (const item of matrix) {
        const band = item.cefr || item.CEFR;
        expect(band && validBands.has(band)).toBe(true);
      }

      // Exactly one correct answer per question in bank
      for (const q of bank) {
        if (q.questionType === 'MCQ') {
          expect(Number.isInteger(q.correctAnswer)).toBe(true);
          expect(q.correctAnswer).toBeGreaterThanOrEqual(0);
          expect(q.correctAnswer).toBeLessThan(q.options.length);
        }
      }

      // No duplicate stable key in active Language Use
      const keys = matrix.map((i: SemanticMatrixItem) => i.stableKey);
      expect(new Set(keys).size).toBe(keys.length);

      // No duplicate stem in active Language Use
      const stems = matrix.map((i: SemanticMatrixItem) => i.stem.trim());
      expect(new Set(stems).size).toBe(stems.length);

      // No active/reserve collision
      const activeKeys = new Set(
        bank
          .filter((q: BankAuditQuestion) => q.active !== false)
          .map((q: BankAuditQuestion) => q.stableKey),
      );
      const reserveKeys = new Set(
        bank
          .filter((q: BankAuditQuestion) => q.active === false)
          .map((q: BankAuditQuestion) => q.stableKey),
      );
      for (const k of activeKeys) {
        expect(reserveKeys.has(k)).toBe(false);
      }

      // Verify specific active and reserve status
      expect(activeKeys.has('lu-a1-daily-object')).toBe(true); // A1 Vocab Q2061
      expect(activeKeys.has('lu-a1-school-object')).toBe(true); // new A1 Vocab Q2063
      expect(activeKeys.has('lu-b1-phrasal-postpone')).toBe(true); // B1 Vocab Q2062
      expect(activeKeys.has('reserve-lu-a2-01')).toBe(true); // Q2050 activated
      expect(reserveKeys.has('lu-a1-article')).toBe(true); // Q2003 reserved
      expect(reserveKeys.has('lu-a2-modal')).toBe(true); // Q2007 reserved
      expect(reserveKeys.has('lu-b1-relative')).toBe(true); // Q2010 reserved
      expect(reserveKeys.has('reserve-lu-a1-01')).toBe(true); // Q2049 reserved
      expect(reserveKeys.has('lu-a1-preposition')).toBe(true); // Q2004 reserved

      // Verify Q2004 skill is Grammar and Q2063 is Vocabulary A1
      const q2004 = bank.find(
        (q: BankAuditQuestion) => q.stableKey === 'lu-a1-preposition',
      );
      expect(q2004?.active).toBe(false);
      expect(q2004?.skill).toBe('Grammar');

      const q2063 = bank.find(
        (q: BankAuditQuestion) => q.stableKey === 'lu-a1-school-object',
      );
      expect(q2063?.active).toBe(true);
      expect(q2063?.skill).toBe('Vocabulary');
      expect(q2063?.intendedLevel || q2063?.cefr).toBe('A1');
    });
  });
});
