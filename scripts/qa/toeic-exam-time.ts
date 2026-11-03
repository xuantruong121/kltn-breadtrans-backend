/**
 * Exam length checks on the harness backend (:3101, disposable database):
 * the whole-exam clock of S&W (80 minutes) and 4 skills (200 minutes), late
 * Writing answers after the section's clock, and the length a new exam gets
 * from its product and type.
 *
 * Usage: HARNESS_DB=<db> npx ts-node --transpile-only scripts/qa/toeic-exam-time.ts
 */
import {
  call,
  check,
  failureCount,
  newAdmin,
  newProStudent,
} from './harness-api';
import { harnessExec, harnessQuery } from './harness-db';

const near = (value: unknown, expected: number, slack = 10) =>
  typeof value === 'number' && Math.abs(value - expected) <= slack;

function publishedAssessment(family: string): number | null {
  const rows = harnessQuery(
    `select id from "ToeicAssessment" where "productFamily" = '${family}' and "publicationStatus" = 'PUBLISHED' order by id limit 1`,
  );
  return rows[0]?.[0] ? Number(rows[0][0]) : null;
}

async function examClock() {
  const student = await newProStudent('time');

  const sw = publishedAssessment('TOEIC_SW');
  check('a published S&W exam exists', sw !== null);
  if (sw !== null) {
    const started = await call(
      'POST',
      `/toeic/assessments/${sw}/attempts`,
      student.token,
      {},
    );
    const attempt = started.data;
    check('S&W attempt starts', started.status < 300, String(started.status));
    check(
      'S&W lasts 80 minutes in all',
      attempt?.totalLimitSeconds === 4800,
      String(attempt?.totalLimitSeconds),
    );
    check(
      '80 minutes are left before a section opens',
      attempt?.totalRemainingSeconds === 4800,
      String(attempt?.totalRemainingSeconds),
    );

    const speaking = attempt.components.find((c: any) => c.kind === 'SPEAKING');
    const writing = attempt.components.find((c: any) => c.kind === 'WRITING');
    const open = await call(
      'POST',
      `/toeic/assessments/attempts/${attempt.id}/components/${speaking.assessmentComponentId}/start`,
      student.token,
    );
    check(
      'Speaking keeps its own 20 minutes',
      open.data?.components?.[0]?.timeLimitSeconds === 1200,
    );
    check(
      'with Speaking running, about 80 minutes are left',
      near(open.data?.totalRemainingSeconds, 4800),
      String(open.data?.totalRemainingSeconds),
    );

    // Speaking opened 5 minutes ago: 15 + 60 minutes left.
    harnessExec(
      `update "ToeicAssessmentAttemptComponent" set "startedAt" = now() - interval '5 minutes' where id = ${speaking.id}`,
    );
    const later = await call(
      'GET',
      `/toeic/assessments/attempts/${attempt.id}`,
      student.token,
    );
    check(
      '5 minutes into Speaking, 75 minutes are left of the exam',
      near(later.data?.totalRemainingSeconds, 75 * 60),
      String(later.data?.totalRemainingSeconds),
    );

    const closed = await call(
      'POST',
      `/toeic/assessments/attempts/${attempt.id}/components/${speaking.assessmentComponentId}/complete`,
      student.token,
      {},
    );
    check('Speaking closes', closed.status < 300, String(closed.status));
    await call(
      'POST',
      `/toeic/assessments/attempts/${attempt.id}/components/${writing.assessmentComponentId}/start`,
      student.token,
    );
    // Writing opened 61 minutes ago: its clock and the 30-second margin are gone.
    harnessExec(
      `update "ToeicAssessmentAttemptComponent" set "startedAt" = now() - interval '61 minutes' where id = ${writing.id}`,
    );
    const quizId = writing.writingQuizIds[0];
    const late = await call(
      'POST',
      `/toeic/assessments/attempts/${attempt.id}/components/${writing.assessmentComponentId}/complete`,
      student.token,
      { writingAnswers: [{ quizId, text: 'Sent after the time ran out' }] },
    );
    check(
      'a late Writing section still closes',
      late.status < 300,
      String(late.status),
    );
    const stored = harnessQuery(
      `select count(*) from "Submission" where "userId" = ${student.userId} and "clientAttemptId" like 'assessment-%'`,
    );
    check(
      'the late written answer is not stored',
      stored[0]?.[0] === '0',
      stored[0]?.[0],
    );
  }

  const four = publishedAssessment('TOEIC_4_SKILLS');
  check('a published 4-skill exam exists', four !== null);
  if (four !== null) {
    const started = await call(
      'POST',
      `/toeic/assessments/${four}/attempts`,
      student.token,
      {},
    );
    check(
      '4 skills last 200 minutes in all',
      started.data?.totalLimitSeconds === 12000,
      String(started.data?.totalLimitSeconds),
    );
    const lr = started.data?.components?.find(
      (c: any) => c.kind === 'LISTENING_READING',
    );
    check(
      'the L&R section reports its 120 minutes',
      lr?.timeLimitSeconds === 7200,
      String(lr?.timeLimitSeconds),
    );
  }
}

async function examLengths() {
  const admin = await newAdmin('time-admin');
  const create = async (
    variantCode: string,
    type: string,
    durationSeconds?: number,
  ) =>
    call('POST', '/admin/exams', admin.token, {
      title: `QA thời lượng ${variantCode} ${type} ${Date.now()}`,
      familyCode: 'TOEIC',
      variantCode,
      type,
      difficulty: 'medium',
      durationSeconds,
    });

  const lrFull = await create('TOEIC_LR', 'FULL_TEST', 2700);
  check(
    'an L&R full test gets 120 minutes whatever the form sends',
    lrFull.data?.durationSeconds === 7200,
    String(lrFull.data?.durationSeconds),
  );
  const swFull = await create('TOEIC_SW', 'FULL_TEST', 2700);
  check(
    'an S&W full test shows 80 minutes',
    swFull.data?.durationSeconds === 4800,
    String(swFull.data?.durationSeconds),
  );
  const fourFull = await create('TOEIC_4_SKILLS', 'FULL_TEST', 2700);
  check(
    'a 4-skill full test shows 200 minutes',
    fourFull.data?.durationSeconds === 12000,
    String(fourFull.data?.durationSeconds),
  );
  const practice = await create('TOEIC_LR', 'PRACTICE_BY_PART', 4500);
  check(
    'L&R part practice keeps the chosen 75 minutes',
    practice.data?.durationSeconds === 4500,
    String(practice.data?.durationSeconds),
  );
  const refused = await create('TOEIC_4_SKILLS', 'PRACTICE_BY_PART', 2700);
  check(
    'part practice outside L&R is refused',
    refused.status === 400,
    String(refused.status),
  );
}

async function main() {
  await examClock();
  await examLengths();
  console.log(`\nfailures: ${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

void main();
