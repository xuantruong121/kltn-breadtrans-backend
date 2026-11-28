import {
  getAttemptQuestionPermutation,
  isDiagnosticAnswerCorrect,
  buildSkillProfiles,
} from './diagnostic.logic';
import { DiagnosticService } from './diagnostic.service';

describe('Entry Diagnostic 2.0 UX & Data Integrity Repair Tests', () => {
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

      // A client-declared authored index is not accepted: the authored
      // identity of an option is the server's to derive, not the client's.
      expect(isDiagnosticAnswerCorrect(question, { originalIndex: 0 })).toBe(
        false,
      );
      // Text that two options share identifies neither of them.
      expect(isDiagnosticAnswerCorrect(question, 'At 8:00')).toBe(false);

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

  describe('One Official Attempt Enforcement in Service', () => {
    it('blocks retaking when a completed attempt already exists', async () => {
      const mockPrisma: any = {
        diagnosticAssessment: {
          findFirst: jest.fn().mockResolvedValue({
            id: 2,
            isActive: true,
            scoringVersion: 'FOUR_SKILL_PLACEMENT_V2',
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

      const service = new DiagnosticService(mockPrisma, {} as any);
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
            scoringVersion: 'FOUR_SKILL_PLACEMENT_V2',
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

      const service = new DiagnosticService(mockPrisma, {} as any);
      const res = await service.startAttempt(1, 2);
      expect(res.hasCompleted).toBe(false);
      expect(res.attemptId).toBe(55);
      expect(res.status).toBe('IN_PROGRESS');
    });
  });
});
