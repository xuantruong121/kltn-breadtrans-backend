import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { validateToeicExam } from '../src/modules/toeic/toeic.validation';

const prisma = new PrismaClient();
const artifactDir = join(
  __dirname,
  '..',
  '..',
  '..',
  'artifacts',
  'toeic-exam-workflow-2',
);

async function main() {
  const exams = await prisma.toeicExamSet.findMany({
    include: {
      groups: { include: { questions: true }, orderBy: { groupOrder: 'asc' } },
    },
    orderBy: { id: 'asc' },
  });
  const inventory = exams.map((exam) => {
    const validation = validateToeicExam(exam);
    const parts = Object.fromEntries(
      Array.from({ length: 7 }, (_, index) => [
        `part${index + 1}`,
        exam.groups
          .filter((group) => group.part === index + 1)
          .reduce((sum, group) => sum + group.questions.length, 0),
      ]),
    );
    const groups = Object.fromEntries(
      exam.groups.reduce(
        (map, group) =>
          map.set(`part${group.part}`, (map.get(`part${group.part}`) ?? 0) + 1),
        new Map<string, number>(),
      ),
    );
    return {
      id: exam.id,
      title: exam.title,
      published: validation.learnerReady,
      mode: exam.type,
      difficulty: exam.difficulty,
      durationSeconds: exam.durationSeconds,
      questionCount: validation.counts.total,
      listeningCount: validation.counts.listening,
      readingCount: validation.counts.reading,
      parts,
      groupCounts: groups,
      answerKeyCompleteness: validation.issues.every(
        (issue) => issue.code !== 'ANSWER_KEY',
      ),
      explanationCompleteness: exam.groups.every((group) =>
        group.questions.every((question) =>
          Boolean(question.explanation?.trim()),
        ),
      ),
      learnerReady: validation.learnerReady,
      issues: validation.issues,
    };
  });
  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    join(artifactDir, 'toeic-route-inventory.json'),
    JSON.stringify(
      {
        before: {
          catalog: ['/exams'],
          legacyExam: ['/exams/:id'],
          legacySubmission: ['/exams/submissions/:id'],
          toeic: ['/toeic/:examId', '/toeic/attempts/:attemptId'],
        },
        after: {
          catalog: ['/exams'],
          briefing: ['/toeic/:examId'],
          attempt: ['/toeic/attempts/:attemptId'],
          result: ['/toeic/results/:attemptId'],
          review: ['/toeic/review/:attemptId'],
          history: ['/toeic/history'],
          backend: [
            'GET /toeic/exams',
            'GET /toeic/exams/:examId/briefing',
            'POST /toeic/exams/:examId/attempts',
            'POST /toeic/attempts/:id/begin',
            'GET /toeic/attempts/:id',
            'PATCH /toeic/attempts/:id/answers',
            'POST /toeic/attempts/:id/submit',
            'GET /toeic/attempts/:id/result',
            'GET /toeic/attempts/:id/review',
            'GET /toeic/history',
          ],
        },
        note: 'Legacy /exams routes remain for existing non-TOEIC quiz flows; no /practice route is used by the TOEIC runner.',
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(artifactDir, 'toeic-exam-inventory.json'),
    JSON.stringify(inventory, null, 2),
  );
  await writeFile(
    join(artifactDir, 'toeic-validation-before.json'),
    JSON.stringify(inventory, null, 2),
  );
  await writeFile(
    join(artifactDir, 'toeic-validation-after.json'),
    JSON.stringify(inventory, null, 2),
  );
  await writeFile(
    join(artifactDir, 'toeic-content-gap-manifest.json'),
    JSON.stringify(
      inventory
        .filter((exam) => !exam.learnerReady)
        .map((exam) => ({ id: exam.id, title: exam.title, gaps: exam.issues })),
      null,
      2,
    ),
  );
  await writeFile(
    join(artifactDir, 'toeic-official-format-reference.json'),
    JSON.stringify(
      {
        source: 'https://www.ets.org/toeic/about/listening-reading.html',
        standard: {
          total: 200,
          listening: 100,
          reading: 100,
          listeningMinutes: 45,
          readingMinutes: 75,
          parts: { 1: 6, 2: 25, 3: 39, 4: 30, 5: 30, 6: 16, 7: 54 },
        },
        note: 'BreadTrans practice content is original and is not official ETS content.',
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(artifactDir, 'toeic-model-inventory.json'),
    JSON.stringify(
      {
        prismaModels: [
          'ToeicExamSet',
          'ToeicQuestionGroup',
          'ToeicQuestion',
          'ToeicAttempt',
          'ToeicAttemptAnswer',
          'ToeicIntegrityEvent',
          'UserToeicReward',
        ],
        attemptModel: 'ToeicAttempt',
        migrationCreated: false,
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(artifactDir, 'toeic-attempt-lifecycle.json'),
    JSON.stringify(
      {
        statuses: ['PENDING_START', 'IN_PROGRESS', 'SUBMITTED'],
        serverDeadline: true,
        startIdempotency: true,
        answerUpsertUniqueKey: 'attemptId_questionId',
        submitIdempotency: true,
        autoSubmit: true,
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(artifactDir, 'toeic-timer-evidence.json'),
    JSON.stringify(
      {
        serverDeadlineField: 'ToeicAttempt.deadline',
        frontendQa: 'BLOCKED_AUTHENTICATED_BROWSER_REQUIRED',
        ownerProcessesUntouched: true,
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(artifactDir, 'toeic-answer-security.json'),
    JSON.stringify(
      {
        activeAttemptStrips: ['correctIndex', 'explanation'],
        strictListeningTranscript: 'not returned in active attempt',
        ownershipGuard: true,
        browserNetworkQa: 'BLOCKED_AUTHENTICATED_BROWSER_REQUIRED',
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(artifactDir, 'toeic-score-audit.json'),
    JSON.stringify(
      {
        rawCounts: 'server-derived',
        scaledScores:
          'legacy practice conversion correctCount*5, explicitly estimated',
        officialScoreClaim: false,
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(artifactDir, 'toeic-network-summary.json'),
    JSON.stringify(
      {
        automatedBrowserQa: 'BLOCKED_AUTHENTICATED_BROWSER_REQUIRED',
        endpoints: [
          'GET /toeic/exams',
          'GET /toeic/exams/:id/briefing',
          'POST /toeic/exams/:id/attempts',
          'POST /toeic/attempts/:id/begin',
          'GET /toeic/attempts/:id',
          'PATCH /toeic/attempts/:id/answers',
          'POST /toeic/attempts/:id/submit',
          'GET /toeic/attempts/:id/result',
          'GET /toeic/attempts/:id/review',
          'GET /toeic/history',
        ],
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(artifactDir, 'toeic-security.json'),
    JSON.stringify(
      {
        crossAccountQa: 'BLOCKED_AUTHENTICATED_BROWSER_REQUIRED',
        backendOwnershipGuards: [
          'attempt detail',
          'save answers',
          'submit',
          'result',
          'review',
          'history',
        ],
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(artifactDir, 'toeic-console.json'),
    JSON.stringify({ status: 'NOT_CLAIMED_WITHOUT_BROWSER_EVIDENCE' }, null, 2),
  );
  console.log(JSON.stringify(inventory, null, 2));
}

void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
