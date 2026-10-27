/**
 * Bounded REAL-provider smoke of Entry Diagnostic V2 grading on the
 * disposable harness (backend started with HARNESS_REAL_GRADER=1; clone DB,
 * Redis 6392, fake S3). Never touches kltn_db, the shared Redis or R2.
 *
 *   - Speaking SPK_TASK_01: a SYNTHETIC answer read by the Windows "David"
 *     voice (not a person; labelled as such), uploaded as WAV;
 *   - Writing WRT_TASK_01: a synthetic learner-style message with two
 *     deliberate errors;
 *   - every other productive task is skipped, objective items answered.
 * Gemini requests are counted with the credential manager's own counter
 * (gemini:telemetry:total_requests, incremented for every outbound attempt).
 * Worst case by construction: 2 rubric attempts x 3 keys per grade x 2 grades
 * = 12 <= 16; Azure 2 sessions <= remaining 2.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

import { call, newStudent } from './harness-api';
import { harnessQuery } from './harness-db';

const BE = 'http://localhost:3101';
const WAV = process.argv[2];
const WRITING =
  "Hi Lan, I'm sorry but I can't come to our meeting tomorrow because my manager ask me to work an extra shift at the shop. Can we meet on Thursday afternoon instead, maybe at 3 pm in the library? I think we still have enough time to finish the slides before the deadline. Also, could you send me the article about online learning that you found last week? I need it for my part of the assignment. Thanks a lot, Minh";

const geminiRequests = () =>
  Number(
    execFileSync(
      'docker',
      [
        'exec',
        'harness-redis',
        'redis-cli',
        'get',
        'gemini:telemetry:total_requests',
      ],
      {
        encoding: 'utf8',
      },
    ).trim() || 0,
  );

async function main() {
  if (!WAV)
    throw new Error(
      'usage: diagnostic-v2-real-grading-smoke.ts <synthetic-answer.wav>',
    );
  const [active] = harnessQuery(
    `select id from "DiagnosticAssessment" where "isActive" = true`,
  );
  if (active?.[0] !== '5')
    throw new Error('REFUSED: the clone does not serve id 5');
  const before = geminiRequests();
  const s = await newStudent('real-smoke');
  const cur = await call('GET', '/diagnostic/current', s.token);
  const start = await call('POST', '/diagnostic/5/attempts/start', s.token);
  const attemptId = start.data.attemptId;
  const speaking = cur.data.questions.filter(
    (q: any) => q.taskType === 'SPEAKING_RESPONSE',
  );
  const writing = cur.data.questions.filter(
    (q: any) => q.taskType === 'WRITING_RESPONSE',
  );

  const form = new FormData();
  form.append(
    'audio',
    new Blob([readFileSync(WAV)], { type: 'audio/wav' }),
    'synthetic.wav',
  );
  form.append('durationMs', '34500');
  const confirm = await fetch(
    `${BE}/diagnostic/5/attempts/${attemptId}/speaking/${speaking[0].id}/confirm`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${s.token}` },
      body: form,
    },
  );
  console.log(
    'speaking confirm',
    confirm.status,
    (await confirm.text()).slice(0, 160),
  );
  await call(
    'POST',
    `/diagnostic/5/attempts/${attemptId}/speaking/${speaking[1].id}/skip`,
    s.token,
  );

  const answers: Record<string, number | string> = {};
  for (const q of cur.data.questions) {
    if (q.taskType === 'MCQ') answers[q.id] = 0;
  }
  answers[writing[0].id] = WRITING;
  answers[writing[1].id] = '';
  const submit = await call('POST', '/diagnostic/5/attempts', s.token, {
    answers,
    attemptId,
    submissionToken: start.data.submissionToken,
  });
  console.log('submit', submit.status);

  let res = await call('GET', '/diagnostic/results/latest', s.token);
  const settled = (r: any) => {
    const sp = r.data?.speakingResponses?.find(
      (x: any) => x.questionId === speaking[0].id,
    );
    const wr = r.data?.writingFeedback?.find(
      (x: any) => x.questionId === writing[0].id,
    );
    return (
      sp &&
      wr &&
      !['SUBMITTED', 'QUEUED', 'GRADING'].includes(sp.status) &&
      !['QUEUED', 'GRADING'].includes(wr.status)
    );
  };
  const until = Date.now() + 240_000;
  while (!settled(res) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 4000));
    res = await call('GET', '/diagnostic/results/latest', s.token);
  }
  const after = geminiRequests();
  const [sp] = harnessQuery(
    `select status, provider, score, "gradingAttempts", "failureReason", transcript from "DiagnosticSpeakingResponse" where "attemptId" = ${attemptId} and "questionId" = ${speaking[0].id}`,
  );
  const [wr] = harnessQuery(
    `select status, provider, score, "gradingAttempts", "failureReason", "wordCount" from "DiagnosticWritingResponse" where "attemptId" = ${attemptId} and "questionId" = ${writing[0].id}`,
  );
  const spApi = res.data?.speakingResponses?.find(
    (x: any) => x.questionId === speaking[0].id,
  );
  const wrApi = res.data?.writingFeedback?.find(
    (x: any) => x.questionId === writing[0].id,
  );
  const report = {
    attemptId,
    geminiRequests: after - before,
    speaking: {
      row: sp,
      criteria: spApi?.criteria,
      criterionFeedback: spApi?.criterionFeedback,
      feedback: spApi?.feedback,
      transcript: spApi?.transcript,
    },
    writing: {
      row: wr,
      criteria: wrApi?.criteria,
      criterionFeedback: wrApi?.criterionFeedback,
      feedback: wrApi?.feedback,
      suggestions: wrApi?.suggestions,
    },
    fourSkill: res.data?.fourSkill,
    advicePriorities: res.data?.advice?.priorities?.map(
      (p: any) => `${p.skill}:${p.areaKey} | ${p.evidence}`,
    ),
    adviceUnassessed: res.data?.advice?.unassessed,
    mockGraderEvidence: res.data?.advice?.mockGraderEvidence,
  };
  writeFileSync(
    'artifacts/finalization/evidence/diag-v2-real-grading-smoke.json',
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2).slice(0, 6000));
}
main().catch((e) => {
  console.error('ERROR', e);
  process.exit(2);
});
