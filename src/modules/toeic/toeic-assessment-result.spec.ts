import { summarizeAssessmentSkills } from './toeic-assessment-result';

describe('TOEIC assessment per-skill results', () => {
  it('reports each skill from its own graded work and never invents a total', () => {
    const skills = summarizeAssessmentSkills([
      {
        assessmentComponent: { kind: 'LISTENING_READING' },
        status: 'COMPLETED',
        toeicAttempt: {
          status: 'SUBMITTED',
          listeningScore: 300,
          readingScore: 250,
          totalScore: 550,
          totalCorrect: 110,
        },
      },
      {
        assessmentComponent: { kind: 'SPEAKING' },
        status: 'COMPLETED',
        speakingSubmissions: [
          { speakingSubmission: { status: 'COMPLETED', overallScore: 8 } },
          { speakingSubmission: { status: 'COMPLETED', overallScore: 7.5 } },
          { speakingSubmission: { status: 'COMPLETED', overallScore: null } },
        ],
      },
      {
        assessmentComponent: { kind: 'WRITING' },
        status: 'COMPLETED',
        writingSubmissions: [
          { submission: { score: 3, aiFeedback: '{"maxScore":3}' } },
          { submission: { score: 2, aiFeedback: '{"maxScore":4}' } },
        ],
      },
    ]);
    expect(skills[0]).toMatchObject({ complete: true, totalScore: 550 });
    expect(skills[1]).toMatchObject({
      gradedCount: 2,
      noSpeechCount: 1,
      meanScore: 7.8,
    });
    expect(skills[2]).toMatchObject({
      points: 5,
      maxPoints: 7,
      gradedCount: 2,
    });
    expect(skills.some((s) => 'overall' in s)).toBe(false);
  });

  it('an unsubmitted L&R child shows no score', () => {
    const [lr] = summarizeAssessmentSkills([
      {
        assessmentComponent: { kind: 'LISTENING_READING' },
        status: 'IN_PROGRESS',
        toeicAttempt: {
          status: 'IN_PROGRESS',
          listeningScore: null,
          readingScore: null,
          totalScore: null,
          totalCorrect: null,
        },
      },
    ]);
    expect(lr).toMatchObject({ complete: false, totalScore: null });
  });
});
