/**
 * A TOEIC assessment from start to final result over HTTP, on the disposable
 * harness served by the deterministic writing grader
 * (scripts/qa/writing-deterministic-server.ts; mock Speaking evaluator).
 *
 *   start -> [4 Skills: L&R child attempt, 200 answers, submit, complete]
 *   -> Speaking: 11 recordings through the API upload, all graded -> complete
 *   -> Writing: 8 answers graded -> complete -> parent COMPLETED
 *   -> per-skill results, reload, no reward or link duplicated by a replay.
 *
 * Usage: npx ts-node --transpile-only scripts/qa/finalization-toeic-full-api.ts <assessmentId> <10s.wav> <34s.wav>
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { BE, call, check, failureCount, newStudent } from './harness-api';
import { harnessQuery } from './harness-db';

const assessmentId = Number(process.argv[2] ?? 1);
// A 10 s answer fits every task; the long clip checks the per-task limit.
const wav = readFileSync(process.argv[3]);
const longWav = readFileSync(process.argv[4] ?? process.argv[3]);
const WRITING_ANSWERS = [
  'A woman is putting a folder on the shelf.',
  'A worker will deliver the box this afternoon.',
  'The customer is going to pay at the counter.',
  'Passengers are checking the schedule on the board.',
  'Several people park their bicycle near the station.',
  'Hi Linh, Friday at 2 p.m. works for me. We could use meeting room B on the third floor. Should I tell the rest of the team, or will you send the new invitation?',
  'Dear Mr Davis, I am sorry that the desk lamp was missing from your order. We will send a replacement today by express delivery. Could you confirm your phone number for the courier?',
  'I believe online courses can be as effective as classroom lessons for learning English. First, learners can study at their own pace and repeat lessons as often as they need. Second, many online courses include speaking practice with teachers through video calls, so students still communicate in real time. For example, my cousin improved her speaking a lot after six months of online lessons because she could practise every evening after work. However, classroom lessons give more chances to talk with classmates. In conclusion, online courses are effective when learners are disciplined and use the interactive tools they offer.',
];

async function submitRecording(
  token: string,
  exerciseId: number,
  query: string,
  audio: Buffer = wav,
) {
  const form = new FormData();
  form.append(
    'audio',
    new Blob([new Uint8Array(audio)], { type: 'audio/wav' }),
    'a.wav',
  );
  const res = await fetch(
    `${BE}/speaking/exercises/${exerciseId}/submit${query}`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': randomUUID(),
      },
      body: form,
    },
  );
  const json: any = await res.json().catch(() => null);
  return {
    status: res.status,
    id: (json?.data ?? json)?.submissionId as number,
  };
}

async function login(email: string, password: string) {
  const r = await call('POST', '/auth/login', undefined, { email, password });
  return {
    token: r.data.accessToken ?? r.data.access_token,
    userId: r.data.user.id as number,
  };
}

async function main() {
  console.log(`\n== TOEIC assessment ${assessmentId}: start to final result`);
  // A browser test passes its own learner (TOEIC_FULL_EMAIL / _PASSWORD).
  const s = process.env.TOEIC_FULL_EMAIL
    ? await login(
        process.env.TOEIC_FULL_EMAIL,
        process.env.TOEIC_FULL_PASSWORD!,
      )
    : await newStudent(`toeic-full-${assessmentId}`);
  const start = await call(
    'POST',
    `/toeic/assessments/${assessmentId}/attempts`,
    s.token,
    {
      idempotencyKey: randomUUID(),
    },
  );
  check('attempt starts', start.status < 300, String(start.status));
  const attemptId = start.data.id as number;
  const components: any[] = start.data.components;
  const byKind = (k: string) => components.find((c) => c.kind === k);
  const path = (c: any, verb: string) =>
    `/toeic/assessments/attempts/${attemptId}/components/${c.assessmentComponentId}/${verb}`;

  // Listening & Reading (4 Skills only)
  const lr = byKind('LISTENING_READING');
  if (lr) {
    const started = await call('POST', path(lr, 'start'), s.token);
    const child = started.data.components.find(
      (c: any) => c.kind === 'LISTENING_READING',
    ).childAttemptId;
    check(
      'L&R starts a child attempt owned by the learner',
      !!child,
      String(child),
    );
    const again = await call('POST', path(lr, 'start'), s.token);
    check(
      'starting L&R again reuses the same child attempt',
      again.data.components.find((c: any) => c.kind === 'LISTENING_READING')
        .childAttemptId === child,
    );
    const early = await call('POST', path(lr, 'complete'), s.token, {});
    check(
      'L&R cannot complete before the child test is submitted',
      early.status === 400,
      String(early.status),
    );
    await call('POST', `/toeic/attempts/${child}/begin`, s.token, {});
    const view = await call('GET', `/toeic/attempts/${child}`, s.token);
    const groups: any[] = view.data.exam.groups;
    const questions = groups.flatMap((g: any) =>
      g.questions.map((q: any) => ({ ...q, part: g.part })),
    );
    check(
      'the child test serves 200 questions',
      questions.length === 200,
      String(questions.length),
    );
    const keys = new Map(
      harnessQuery(
        `select q.id, q."correctIndex" from "ToeicQuestion" q join "ToeicQuestionGroup" g on g.id = q."groupId" where g."examId" = ${view.data.exam.id}`,
      ).map(([id, k]) => [Number(id), Number(k)]),
    );
    // Half right: every even question gets its key.
    const pick = (list: any[]) =>
      Object.fromEntries(
        list.map((q: any) => {
          const key = keys.get(q.id)!;
          const i = questions.indexOf(q);
          return [
            String(q.id),
            i % 2 === 0 ? key : (key + 1) % q.options.length,
          ];
        }),
      );
    const listening = questions.filter((q: any) => q.part <= 4);
    const reading = questions.filter((q: any) => q.part > 4);
    const expectedCorrect = questions.filter(
      (_: any, i: number) => i % 2 === 0,
    ).length;
    // Full Test (owner decision 2026-10-27): one 120-minute paper, any
    // Part in any order; Reading answers are accepted before Listening ends.
    const rs = await call(
      'PATCH',
      `/toeic/attempts/${child}/answers`,
      s.token,
      { answers: pick(reading) },
    );
    check(
      'Reading answers saved straight away (no section lock)',
      rs.status < 300,
      `${rs.status} ${JSON.stringify(rs.data).slice(0, 100)}`,
    );
    const ls = await call(
      'PATCH',
      `/toeic/attempts/${child}/answers`,
      s.token,
      { answers: pick(listening) },
    );
    check(
      'Listening answers saved after Reading ones',
      ls.status < 300,
      `${ls.status} ${JSON.stringify(ls.data).slice(0, 100)}`,
    );
    const submit = await call(
      'POST',
      `/toeic/attempts/${child}/submit`,
      s.token,
      {},
    );
    check(
      'the child test is submitted',
      submit.data?.status === 'SUBMITTED',
      submit.data?.status,
    );
    check(
      'scored from the saved answers (half right)',
      submit.data?.totalCorrect === expectedCorrect,
      `${submit.data?.totalCorrect} vs ${expectedCorrect}`,
    );
    const done = await call('POST', path(lr, 'complete'), s.token, {});
    check(
      'L&R component completes after submission',
      done.status < 300,
      String(done.status),
    );
  }

  // Speaking
  const sp = byKind('SPEAKING');
  await call('POST', path(sp, 'start'), s.token);
  const q = `?parentAttemptId=${attemptId}&parentComponentId=${sp.assessmentComponentId}`;
  const ids: number[] = [];
  const tooLong = await submitRecording(
    s.token,
    sp.speakingExerciseIds[4],
    q,
    longWav,
  );
  check(
    'a 34.5 s answer to a 15 s question (Q5) is refused',
    tooLong.status === 400,
    String(tooLong.status),
  );
  for (const exerciseId of sp.speakingExerciseIds as number[]) {
    const r = await submitRecording(s.token, exerciseId, q);
    if (r.status >= 300)
      check(`recording for exercise ${exerciseId}`, false, String(r.status));
    else ids.push(r.id);
  }
  check(
    '11 recordings accepted through the API upload',
    ids.length === 11,
    String(ids.length),
  );
  for (let i = 0; i < 60; i += 1) {
    const st = await Promise.all(
      ids.map((id) => call('GET', `/speaking/submissions/${id}`, s.token)),
    );
    if (st.every((r) => r.data?.status === 'COMPLETED')) break;
    await new Promise((ok) => setTimeout(ok, 1500));
  }
  const keysPrivate = harnessQuery(
    `select count(*) from "SpeakingSubmission" where id in (${ids.join(',')}) and "audioKey" like 'premium/speaking/practice/%'`,
  )[0][0];
  check(
    'all 11 recordings are stored privately',
    Number(keysPrivate) === 11,
    keysPrivate,
  );
  const spDone = await call('POST', path(sp, 'complete'), s.token, {
    speakingSubmissionIds: ids,
  });
  check(
    'Speaking completes with 11 graded recordings',
    spDone.status < 300,
    String(spDone.status),
  );

  // Writing
  const wr = byKind('WRITING');
  await call('POST', path(wr, 'start'), s.token);
  const wq = `?parentAttemptId=${attemptId}&parentComponentId=${wr.assessmentComponentId}`;
  const writingIds: number[] = [];
  for (const [i, quizId] of (wr.writingQuizIds as number[]).entries()) {
    const r = await call(
      'POST',
      `/writing/quizzes/${quizId}/submit${wq}`,
      s.token,
      {
        answer: WRITING_ANSWERS[i],
        clientAttemptId: randomUUID(),
      },
    );
    if (r.status >= 300)
      check(
        `writing task ${i + 1}`,
        false,
        `${r.status} ${JSON.stringify(r.data).slice(0, 120)}`,
      );
    else writingIds.push(r.data.submissionId);
    if (i === 0)
      check(
        'task 1 is graded on the picture scale (0-3)',
        r.data?.maxScore === 3,
        String(r.data?.maxScore),
      );
    if (i === 5)
      check(
        'task 6 is graded on the request scale (0-4)',
        r.data?.maxScore === 4,
        String(r.data?.maxScore),
      );
    if (i === 7)
      check(
        'task 8 is graded on the essay scale (0-5)',
        r.data?.maxScore === 5,
        String(r.data?.maxScore),
      );
  }
  check(
    '8 writing tasks graded',
    writingIds.length === 8,
    String(writingIds.length),
  );
  const wrDone = await call('POST', path(wr, 'complete'), s.token, {});
  check(
    'Writing completes',
    wrDone.status < 300,
    `${wrDone.status} ${JSON.stringify(wrDone.data).slice(0, 120)}`,
  );

  const final = await call(
    'GET',
    `/toeic/assessments/attempts/${attemptId}`,
    s.token,
  );
  check(
    'the parent attempt is COMPLETED',
    final.data?.status === 'COMPLETED',
    final.data?.status,
  );
  const skills: any[] = final.data?.result?.skills ?? [];
  console.log('      skills', JSON.stringify(skills));
  check(
    'every skill is complete with its own result',
    skills.length === components.length && skills.every((x) => x.complete),
  );
  check(
    'Writing points use the per-task scales (max 5x3 + 2x4 + 5 = 28)',
    skills.find((x) => x.kind === 'WRITING')?.maxPoints === 28,
  );
  if (lr)
    check(
      'L&R result comes from the child attempt',
      typeof skills.find((x) => x.kind === 'LISTENING_READING')?.totalScore ===
        'number',
    );

  // Replays and reload change nothing.
  const replay = await call('POST', path(sp, 'complete'), s.token, {
    speakingSubmissionIds: ids,
  });
  const reload = await call(
    'GET',
    `/toeic/assessments/attempts/${attemptId}`,
    s.token,
  );
  check(
    'a replayed completion and a reload return the same result',
    replay.status < 300 &&
      JSON.stringify(reload.data.result) === JSON.stringify(final.data.result),
  );
  const links = harnessQuery(
    `select count(*) from "ToeicAssessmentSpeakingSubmission" l join "ToeicAssessmentAttemptComponent" c on c.id = l."attemptComponentId" where c."assessmentAttemptId" = ${attemptId}`,
  )[0][0];
  check(
    'speaking links are not duplicated by the replay',
    Number(links) === 11,
    links,
  );
  const other = await newStudent('toeic-other');
  const peek = await call(
    'GET',
    `/toeic/assessments/attempts/${attemptId}`,
    other.token,
  );
  check(
    'another learner cannot read the attempt',
    peek.status === 403 || peek.status === 404,
    String(peek.status),
  );
  console.log(`      ATTEMPT ${attemptId} USER ${s.userId}`);
  console.log(
    `\n${failureCount() ? 'FAILURES: ' + failureCount() : 'ALL PASS'}`,
  );
  process.exit(failureCount() ? 1 : 0);
}

void main();
