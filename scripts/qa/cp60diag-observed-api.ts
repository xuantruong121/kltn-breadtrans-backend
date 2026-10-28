/**
 * CP60-DIAG (harness only, mock graders): FOUR_SKILL_OBSERVED_V3 end to end
 * over HTTP. Each case is a fresh learner on the active four-skill
 * assessment; the expected scores are computed here independently of the
 * backend, from the policy text (35/35/7.5×4) and the mock grader's rubric
 * output (all criteria 3/4 -> 75; Writing below two thirds of the minimum
 * length -> task criterion 1/4 -> 60).
 *
 * Run (explicit isolated targets are required by the harness helpers):
 *   npx ts-node --transpile-only scripts/qa/cp60diag-observed-api.ts <answer.wav>
 */
import { readFileSync } from 'node:fs';

import { BE, call, check, failureCount, newStudent } from './harness-api';
import { harnessExec, harnessQuery } from './harness-db';

type Learner = Awaited<ReturnType<typeof newStudent>>;
const wav = () => readFileSync(process.env.QA_WAV ?? process.argv[2]);
const DB = process.env.QA_DB_NAME ?? 'diag_clone';
const q = (sql: string) => harnessQuery(sql, DB);

const r1 = (n: number) => Math.round(n * 10) / 10;
const observed = (l: number, r: number, tasks: number[]) =>
  r1(
    (0.35 * l + 0.35 * r + tasks.reduce((s, t) => s + 0.075 * t, 0)) /
      (0.7 + 0.075 * tasks.length),
  );

export type Plan = {
  listening: number; // correct out of 10
  reading: number; // correct out of 10
  speaking: Array<'record' | 'skip'>;
  writing: Array<'full' | 'short' | 'skip'>;
};

async function startAttempt(learner: Learner) {
  const cur = (await call('GET', '/diagnostic/current', learner.token)).data;
  const st = await call(
    'POST',
    `/diagnostic/${cur.id}/attempts/start`,
    learner.token,
    {},
  );
  return { cur, attemptId: st.data.attemptId, token: st.data.submissionToken };
}

function correctText(questionId: number): string {
  return q(
    `select options->'values'->>"correctIndex" from "DiagnosticQuestion" where id = ${questionId}`,
  )[0][0];
}

export async function runCase(
  label: string,
  plan: Plan,
  given?: Learner,
  // >1 sends the same submission concurrently (idempotency check).
  parallelSubmits = 1,
) {
  const learner = given ?? (await newStudent(`cp60diag-${label}`));
  const { cur, attemptId, token } = await startAttempt(learner);
  const questions: any[] = cur.questions;
  const answers: Record<string, unknown> = {};
  const seen = { LISTENING: 0, READING: 0 };
  for (const question of questions) {
    if (question.productive) continue;
    const section = question.section as string;
    const values: string[] = Array.isArray(question.options)
      ? question.options
      : (question.options?.values ?? []);
    const right = values.indexOf(correctText(question.id));
    const wantRight =
      section === 'LISTENING'
        ? seen.LISTENING++ < plan.listening
        : section === 'READING'
          ? seen.READING++ < plan.reading
          : true;
    answers[String(question.id)] = wantRight
      ? right
      : (right + 1) % values.length;
  }
  const speakingQs = questions.filter(
    (x) => x.taskType === 'SPEAKING_RESPONSE',
  );
  const writingQs = questions.filter((x) => x.taskType === 'WRITING_RESPONSE');
  for (const [i, sq] of speakingQs.entries()) {
    const path = `/diagnostic/${cur.id}/attempts/${attemptId}/speaking/${sq.id}`;
    if (plan.speaking[i] === 'record') {
      const form = new FormData();
      form.append(
        'audio',
        new Blob([wav()], { type: 'audio/wav' }),
        'answer.wav',
      );
      form.append('durationMs', '10000');
      const res = await fetch(`${BE}${path}/confirm`, {
        method: 'POST',
        headers: { authorization: `Bearer ${learner.token}` },
        body: form,
      });
      if (res.status >= 300)
        console.log('confirm', res.status, await res.text());
    } else {
      await call('POST', `${path}/skip`, learner.token, {});
    }
  }
  for (const [i, wq] of writingQs.entries()) {
    const min = wq.wordMin ?? 40;
    const words = (n: number) =>
      Array.from({ length: n }, (_, k) => `word${k % 7}`).join(' ');
    answers[String(wq.id)] =
      plan.writing[i] === 'full'
        ? `I think this is useful because ${words(min + 5)}.`
        : plan.writing[i] === 'short'
          ? `Short answer ${words(Math.max(1, Math.floor(min / 3)))}.`
          : '';
  }
  const submits = await Promise.all(
    Array.from({ length: parallelSubmits }, () =>
      call('POST', `/diagnostic/${cur.id}/attempts`, learner.token, {
        answers,
        submissionToken: token,
        attemptId,
      }),
    ),
  );
  const submit = submits[0];
  if (submit.status >= 300)
    console.log(
      'submit',
      submit.status,
      JSON.stringify(submit.data).slice(0, 200),
    );
  // Grading runs in-process; wait for it to settle.
  let result: any = null;
  for (let i = 0; i < 40; i += 1) {
    result = (await call('GET', '/diagnostic/results/latest', learner.token))
      .data;
    if (result?.fourSkill && result.fourSkill.state !== 'PENDING_GRADING')
      break;
    await new Promise((ok) => setTimeout(ok, 500));
  }
  return {
    learner,
    attemptId,
    assessmentId: cur.id,
    result,
    submit,
    submits,
    answers,
    token,
  };
}

async function main() {
  console.log(`\n== FOUR_SKILL_OBSERVED_V3 on ${DB}`);
  const cases: Array<[string, Plan, number[]]> = [
    [
      'T01',
      {
        listening: 6,
        reading: 8,
        speaking: ['skip', 'skip'],
        writing: ['skip', 'skip'],
      },
      [],
    ],
    [
      'T02',
      {
        listening: 6,
        reading: 8,
        speaking: ['record', 'skip'],
        writing: ['skip', 'skip'],
      },
      [75],
    ],
    [
      'T03',
      {
        listening: 6,
        reading: 8,
        speaking: ['skip', 'record'],
        writing: ['skip', 'skip'],
      },
      [75],
    ],
    [
      'T04',
      {
        listening: 6,
        reading: 8,
        speaking: ['record', 'record'],
        writing: ['skip', 'skip'],
      },
      [75, 75],
    ],
    [
      'T05',
      {
        listening: 6,
        reading: 8,
        speaking: ['skip', 'skip'],
        writing: ['full', 'skip'],
      },
      [75],
    ],
    [
      'T06',
      {
        listening: 6,
        reading: 8,
        speaking: ['skip', 'skip'],
        writing: ['skip', 'short'],
      },
      [60],
    ],
    [
      'T07',
      {
        listening: 6,
        reading: 8,
        speaking: ['skip', 'skip'],
        writing: ['full', 'short'],
      },
      [75, 60],
    ],
    [
      'T08',
      {
        listening: 5,
        reading: 5,
        speaking: ['record', 'skip'],
        writing: ['full', 'skip'],
      },
      [75, 75],
    ],
    [
      'T09',
      {
        listening: 5,
        reading: 5,
        speaking: ['record', 'record'],
        writing: ['short', 'skip'],
      },
      [75, 75, 60],
    ],
    [
      'T10',
      {
        listening: 10,
        reading: 10,
        speaking: ['record', 'record'],
        writing: ['full', 'full'],
      },
      [75, 75, 75, 75],
    ],
  ];
  const kept: Record<string, Awaited<ReturnType<typeof runCase>>> = {};
  for (const [label, plan, tasks] of cases) {
    const run = await runCase(label, plan);
    kept[label] = run;
    const fs = run.result?.fourSkill;
    const obs = fs?.observed;
    const expected = observed(plan.listening * 10, plan.reading * 10, tasks);
    const stored = q(
      `select "overallScore", answers->>'__resultPolicy' from "DiagnosticAttempt" where id = ${run.attemptId}`,
    )[0];
    const spk = plan.speaking.filter((x) => x === 'record').length;
    const wrt = plan.writing.filter((x) => x !== 'skip').length;
    check(
      `${label} observed ${expected} (denominator ${r1((0.7 + 0.075 * tasks.length) * 1000) / 1000}), core ${(plan.listening * 10 + plan.reading * 10) / 2}`,
      obs?.observed?.score === expected &&
        obs?.objectiveCore === (plan.listening * 10 + plan.reading * 10) / 2 &&
        Math.abs(obs?.observed?.denominator - (0.7 + 0.075 * tasks.length)) <
          1e-9 &&
        fs?.overall === expected,
      `(api ${obs?.observed?.score}/${obs?.observed?.denominator}, core ${obs?.objectiveCore}, state ${fs?.state})`,
    );
    check(
      `${label} coverage Speaking ${spk}/2, Writing ${wrt}/2; skipped tasks unassessed, not 0`,
      obs?.speaking?.graded === spk &&
        obs?.writing?.graded === wrt &&
        (spk === 0 ? fs?.skills?.SPEAKING?.score === null : true) &&
        (wrt === 0 ? fs?.skills?.WRITING?.score === null : true) &&
        obs?.speaking?.coverage ===
          (spk === 0 ? 'NONE' : spk === 2 ? 'FULL' : 'PARTIAL'),
      `(S ${obs?.speaking?.graded} ${obs?.speaking?.coverage}, W ${obs?.writing?.graded} ${obs?.writing?.coverage})`,
    );
    check(
      `${label} T28 database = API (overallScore, server-owned policy marker)`,
      Number(stored?.[0]) === expected &&
        stored?.[1] === 'FOUR_SKILL_OBSERVED_V3',
      `(db ${stored?.[0]} ${stored?.[1]})`,
    );
  }

  const t02 = kept.T02.result;
  check(
    'T20 partial Speaking: one task scored with rubric criteria and weighting facts, task 2 SKIPPED',
    t02?.fourSkill?.observed?.speaking?.tasks?.[1]?.status === 'SKIPPED' &&
      t02?.fourSkill?.skills?.SPEAKING?.itemsScored === 1 &&
      t02?.fourSkill?.skills?.SPEAKING?.itemsTotal === 2,
    JSON.stringify(t02?.fourSkill?.observed?.speaking?.tasks),
  );
  const meta = q(
    `select "scoreMetadata"->>'weightingVersion', "scoreMetadata"->>'limitedEvidence', score from "DiagnosticSpeakingResponse" where "attemptId" = ${kept.T02.attemptId} and status = 'GRADED'`,
  )[0];
  check(
    'graded Speaking task stores the weighting version, full acoustic evidence (mock) and score 75',
    meta?.[0] === 'DIAG_RUBRIC_WEIGHTS_V1' &&
      meta?.[1] === 'false' &&
      Number(meta?.[2]) === 75,
    JSON.stringify(meta),
  );
  const b = t02?.objectiveBreakdown;
  check(
    'objective breakdown: Listening/Reading by difficulty tier D1-D4 and subskill, totals 10',
    b?.LISTENING?.byDifficulty?.reduce(
      (s: number, g: any) => s + g.total,
      0,
    ) === 10 &&
      b?.READING?.bySubskill?.reduce((s: number, g: any) => s + g.total, 0) ===
        10 &&
      b?.LISTENING?.byDifficulty?.every((g: any) => /^D[1-4]$/.test(g.key)),
    JSON.stringify(b?.LISTENING?.byDifficulty),
  );
  check(
    'Language Use is reported with weight 0',
    t02?.fourSkill?.observed?.languageUse?.weight === 0 &&
      t02?.fourSkill?.observed?.languageUse?.total === 5,
  );

  console.log('\n== T21 refresh while grading is pending');
  {
    harnessExec(
      `update "DiagnosticWritingResponse" set status = 'QUEUED', score = null where "attemptId" = ${kept.T07.attemptId} and "questionId" = (select min("questionId") from "DiagnosticWritingResponse" where "attemptId" = ${kept.T07.attemptId})`,
      DB,
    );
    const r = (
      await call('GET', '/diagnostic/results/latest', kept.T07.learner.token)
    ).data;
    check(
      'a pending task withholds the observed score, keeps the objective core, not zero',
      r?.fourSkill?.state === 'PENDING_GRADING' &&
        r?.fourSkill?.overall === null &&
        r?.fourSkill?.observed?.objectiveCore === 70 &&
        r?.fourSkill?.observed?.observed?.withheldReason ===
          'PRODUCTIVE_PENDING',
      `(state ${r?.fourSkill?.state}, overall ${r?.fourSkill?.overall})`,
    );
    const stored = q(
      `select "overallScore", "resultState" from "DiagnosticAttempt" where id = ${kept.T07.attemptId}`,
    )[0];
    check(
      'the stored attempt follows (overallScore null, PENDING_GRADING)',
      stored?.[0] === '' && stored?.[1] === 'PENDING_GRADING',
      JSON.stringify(stored),
    );
  }

  console.log('\n== T22 historical attempt keeps its old policy');
  {
    harnessExec(
      `update "DiagnosticAttempt" set answers = answers - '__resultPolicy' where id = ${kept.T04.attemptId}`,
      DB,
    );
    const r = (
      await call('GET', '/diagnostic/results/latest', kept.T04.learner.token)
    ).data;
    check(
      'without the marker the V2 meaning is kept: no observed block, no overall (Writing never answered)',
      r?.fourSkill &&
        r.fourSkill.observed === undefined &&
        r.fourSkill.overall === null &&
        r.objectiveBreakdown === null,
      `(overall ${r?.fourSkill?.overall}, observed ${typeof r?.fourSkill?.observed})`,
    );
  }

  console.log('\n== T23 duplicate submission');
  {
    const run = kept.T01;
    const again = await call(
      'POST',
      `/diagnostic/${run.assessmentId}/attempts`,
      run.learner.token,
      {
        answers: run.answers,
        submissionToken: run.token,
        attemptId: run.attemptId,
      },
    );
    const count = q(
      `select count(*) from "DiagnosticAttempt" where "userId" = ${run.learner.userId}`,
    )[0][0];
    check(
      're-submitting the same token returns the same attempt; no second attempt',
      again.status < 300 && count === '1',
      `(${again.status}, attempts ${count})`,
    );
  }

  console.log('\n== T24 cross-learner access');
  {
    const other = await newStudent('cp60diag-other');
    const a = kept.T04;
    const list = await call(
      'GET',
      `/diagnostic/${a.assessmentId}/attempts/${a.attemptId}/speaking`,
      other.token,
    );
    const respId = q(
      `select id from "DiagnosticSpeakingResponse" where "attemptId" = ${a.attemptId} limit 1`,
    )[0][0];
    const audio = await call(
      'GET',
      `/diagnostic/speaking-responses/${respId}/audio`,
      other.token,
    );
    const retry = await call(
      'POST',
      `/diagnostic/${a.assessmentId}/attempts/${a.attemptId}/writing/${q(`select min(id) from "DiagnosticQuestion" where "assessmentId" = ${a.assessmentId} and "taskType" = 'WRITING_RESPONSE'`)[0][0]}/retry`,
      other.token,
      {},
    );
    const latest = (
      await call('GET', '/diagnostic/results/latest', other.token)
    ).data;
    check(
      "another learner cannot list, play or retry this attempt's tasks, and sees no result of it",
      [403, 404].includes(list.status) &&
        [403, 404].includes(audio.status) &&
        [403, 404].includes(retry.status) &&
        (latest === null || latest?.attemptId !== a.attemptId),
      `(${list.status}/${audio.status}/${retry.status})`,
    );
  }

  console.log(`\nCP60DIAG_OBSERVED_API_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

if (require.main === module)
  main().catch((e) => {
    console.error('ERROR', e);
    process.exit(2);
  });
