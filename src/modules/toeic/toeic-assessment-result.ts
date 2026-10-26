/**
 * Per-skill results of a TOEIC assessment attempt (S&W or 4 Skills), from the
 * learner's own graded work. Pure: takes the attempt components as loaded by
 * ToeicAssessmentService.attemptInclude().
 *
 * BreadTrans practice indicators only. No overall score is invented:
 *  - Listening & Reading: the child L&R attempt's own result (the same
 *    numbers the L&R result page shows);
 *  - Speaking: the mean 0-10 practice score of the graded recordings;
 *  - Writing: points earned over points available, each task on its own
 *    scale (picture sentence 0-3, written request 0-4, opinion essay 0-5).
 * A skill with any ungraded required work reports `complete: false`.
 */
type Component = {
  assessmentComponent: { kind: string };
  status: string;
  toeicAttempt?: {
    status: string;
    listeningScore: number | null;
    readingScore: number | null;
    totalScore: number | null;
    totalCorrect: number | null;
  } | null;
  speakingSubmissions?: Array<{
    speakingSubmission: { status: string; overallScore: number | null };
  }>;
  writingSubmissions?: Array<{
    submission: { score: number | null; aiFeedback: string | null };
  }>;
};

function writingMax(aiFeedback: string | null): number | null {
  try {
    const max = Number(
      (JSON.parse(aiFeedback ?? '{}') as { maxScore?: unknown }).maxScore,
    );
    return Number.isFinite(max) && max > 0 ? max : null;
  } catch {
    return null;
  }
}

export function summarizeAssessmentSkills(components: Component[]) {
  return components.map((component) => {
    const kind = component.assessmentComponent.kind;
    if (kind === 'LISTENING_READING') {
      const child = component.toeicAttempt;
      const complete = child?.status === 'SUBMITTED';
      return {
        kind,
        complete,
        listeningScore: complete ? child.listeningScore : null,
        readingScore: complete ? child.readingScore : null,
        totalScore: complete ? child.totalScore : null,
        totalCorrect: complete ? child.totalCorrect : null,
      };
    }
    if (kind === 'SPEAKING') {
      const linked = component.speakingSubmissions ?? [];
      const graded = linked.filter(
        (l) =>
          l.speakingSubmission.status === 'COMPLETED' &&
          l.speakingSubmission.overallScore !== null,
      );
      return {
        kind,
        complete: component.status === 'COMPLETED' && linked.length > 0,
        taskCount: linked.length,
        gradedCount: graded.length,
        noSpeechCount: linked.filter(
          (l) =>
            l.speakingSubmission.status === 'COMPLETED' &&
            l.speakingSubmission.overallScore === null,
        ).length,
        meanScore: graded.length
          ? Math.round(
              (graded.reduce(
                (n, l) => n + (l.speakingSubmission.overallScore ?? 0),
                0,
              ) /
                graded.length) *
                10,
            ) / 10
          : null,
      };
    }
    const linked = component.writingSubmissions ?? [];
    const scored = linked
      .map((l) => ({
        score: l.submission.score,
        max: writingMax(l.submission.aiFeedback),
      }))
      .filter((s) => s.score !== null && s.max !== null);
    return {
      kind,
      complete: component.status === 'COMPLETED' && linked.length > 0,
      taskCount: linked.length,
      gradedCount: scored.length,
      points: scored.reduce((n, s) => n + (s.score ?? 0), 0),
      maxPoints: scored.reduce((n, s) => n + (s.max ?? 0), 0),
    };
  });
}
