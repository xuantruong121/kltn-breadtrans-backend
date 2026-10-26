/**
 * TOEIC S&W (assessment 1) or 4 Skills (assessment 2) learner flow over HTTP
 * on the disposable harness (mock speaking evaluator, no Gemini, fake S3).
 *
 *   start attempt -> start Speaking -> 11 x (upload intent, PUT, finalize,
 *   poll to COMPLETED) -> complete Speaking -> start Writing -> submit one
 *   task (expects the honest "grader unavailable" refusal without Gemini)
 *   -> completing Writing is refused until all 8 tasks are graded.
 * Also: another learner cannot read or drive this attempt.
 *
 * Usage: npx ts-node --transpile-only scripts/qa/finalization-toeic-sw-api.ts <assessmentId> <answer.wav>
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { call, check, failureCount, newStudent } from './harness-api';

const assessmentId = Number(process.argv[2] ?? 1);
const wav = readFileSync(process.argv[3]);

async function main() {
  console.log(`\n== TOEIC assessment ${assessmentId} (S&W components) over HTTP`);
  const s = await newStudent('toeic-sw');
  const detail = await call('GET', `/toeic/assessments/${assessmentId}`, s.token);
  check('assessment detail is served to a FREE learner', detail.status === 200, `(${detail.status})`);
  const start = await call('POST', `/toeic/assessments/${assessmentId}/attempts`, s.token, { idempotencyKey: randomUUID() });
  check('attempt starts', start.status < 300, `(${start.status} ${JSON.stringify(start.data).slice(0, 120)})`);
  const attempt = start.data;
  const components: any[] = attempt?.components ?? [];
  const speaking = components.find((c) => c.kind === 'SPEAKING');
  const writing = components.find((c) => c.kind === 'WRITING');
  check('the attempt lists Speaking and Writing components', !!speaking && !!writing, `(${components.map((c) => c.kind).join(',')})`);
  const componentId = speaking.assessmentComponentId ?? speaking.id;
  const sc = await call('POST', `/toeic/assessments/attempts/${attempt.id}/components/${componentId}/start`, s.token);
  check('Speaking component starts', sc.status < 300, `(${sc.status} ${JSON.stringify(sc.data).slice(0, 160)})`);

  const ids: number[] = speaking.speakingExerciseIds ?? [];
  check('Speaking component exposes its 11 tasks', ids.length === 11, `(${ids.join(',')})`);

  const q = `?parentAttemptId=${attempt.id}&parentComponentId=${componentId}`;
  const submissionIds: number[] = [];
  for (const exerciseId of ids) {
    const intent = await call('POST', `/speaking/exercises/${exerciseId}/upload-intents${q}`, s.token, {
      contentType: 'audio/wav',
      sizeBytes: wav.length,
      durationMs: 34500,
      idempotencyKey: randomUUID(),
    });
    if (intent.status >= 300) {
      check(`upload intent for exercise ${exerciseId}`, false, `(${intent.status} ${JSON.stringify(intent.data).slice(0, 160)})`);
      break;
    }
    const put = await fetch(intent.data.uploadUrl, { method: 'PUT', headers: intent.data.signedHeaders ?? { 'Content-Type': 'audio/wav' }, body: wav });
    const fin = await call('POST', `/speaking/upload-intents/${intent.data.uploadIntentId}/finalize`, s.token, {});
    if (put.status >= 300 || fin.status >= 300) {
      check(`upload + finalize for exercise ${exerciseId}`, false, `(put ${put.status}, finalize ${fin.status} ${JSON.stringify(fin.data).slice(0, 160)})`);
      break;
    }
    submissionIds.push(fin.data.submissionId ?? fin.data.id);
  }
  check('all 11 recordings accepted', submissionIds.length === 11, `(${submissionIds.length})`);

  const until = Date.now() + 180_000;
  let statuses: string[] = [];
  while (Date.now() < until) {
    statuses = [];
    for (const id of submissionIds) statuses.push((await call('GET', `/speaking/submissions/${id}`, s.token)).data?.status);
    if (statuses.every((st) => st === 'COMPLETED' || st === 'FAILED')) break;
    await new Promise((r) => setTimeout(r, 8000));
  }
  check('all 11 speaking submissions are graded (mock evaluator)', statuses.every((st) => st === 'COMPLETED'), `(${statuses.join(',')})`);

  const other = await newStudent('toeic-sw-other');
  const foreign = await call('GET', `/toeic/assessments/attempts/${attempt.id}`, other.token);
  check('another learner cannot read this attempt', foreign.status === 403 || foreign.status === 404, `(${foreign.status})`);
  const foreignDone = await call('POST', `/toeic/assessments/attempts/${attempt.id}/components/${componentId}/complete`, other.token, { speakingSubmissionIds: submissionIds });
  check('another learner cannot complete this attempt', foreignDone.status === 403 || foreignDone.status === 404, `(${foreignDone.status})`);

  const done = await call('POST', `/toeic/assessments/attempts/${attempt.id}/components/${componentId}/complete`, s.token, { speakingSubmissionIds: submissionIds });
  const spkState = done.data?.components?.find((c: any) => c.kind === 'SPEAKING');
  check('Speaking component completes with 11 graded submissions', done.status < 300 && spkState?.status === 'COMPLETED', `(${done.status} ${spkState?.status} ${JSON.stringify(done.data).slice(0, 160)})`);

  const writingId = writing.assessmentComponentId ?? writing.id;
  const wc = await call('POST', `/toeic/assessments/attempts/${attempt.id}/components/${writingId}/start`, s.token);
  check('Writing component starts', wc.status < 300, `(${wc.status})`);
  const quizIds: number[] = writing.writingQuizIds ?? [];
  const firstQuiz = quizIds[0];
  check('Writing component exposes its 8 tasks', quizIds.length === 8, `(${quizIds.join(',')})`);
  const wq = `?parentAttemptId=${attempt.id}&parentComponentId=${writingId}`;
  const sub = await call('POST', `/writing/quizzes/${firstQuiz}/submit${wq}`, s.token, { answer: 'A woman is putting files into a cabinet.', clientAttemptId: randomUUID() });
  check('without Gemini a Writing task is refused honestly, not scored', sub.status === 503, `(${sub.status} ${JSON.stringify(sub.data).slice(0, 140)})`);
  const wdone = await call('POST', `/toeic/assessments/attempts/${attempt.id}/components/${writingId}/complete`, s.token, {});
  check('Writing cannot complete without 8 graded tasks', wdone.status === 400, `(${wdone.status} ${JSON.stringify(wdone.data).slice(0, 160)})`);
  const final = await call('GET', `/toeic/assessments/attempts/${attempt.id}`, s.token);
  check('the attempt stays IN_PROGRESS', final.data?.status === 'IN_PROGRESS', `(${final.data?.status})`);

  console.log(`\nTOEIC_SW_API_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}
main().catch((e) => {
  console.error('ERROR', e);
  process.exit(2);
});
