/**
 * CP60 acceptance (harness only): the CP60-DIAG cases the first probe left
 * open. Phases follow the grader the harness backend was started with:
 *
 *   mock         T11 genuine zero, T23 concurrent submit, rewards once,
 *                retake/abandon/resume, T25 plan-dependent advice, row-51 re-check
 *   failed       backend started with no grader: T13 failure is honest
 *                (writes the failed attempt to $STATE for the next phase)
 *   recover      backend back on mock: concurrent retry -> one enqueue -> graded
 *
 *   HARNESS_DB=diag_clone QA_WAV=<wav> STATE=<json> npx ts-node --transpile-only \
 *     scripts/qa/cp60-acc-gaps-api.ts <phase>
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { runCase } from './cp60diag-observed-api';
import {
  BE,
  call,
  check,
  failureCount,
  newAdmin,
  newProStudent,
  newStudent,
} from './harness-api';
import { harnessExec, harnessQuery } from './harness-db';

const DB = process.env.HARNESS_DB ?? 'diag_clone';
const q = (sql: string) => harnessQuery(sql, DB);
const r1 = (n: number) => Math.round(n * 10) / 10;
const STATE = process.env.STATE ?? 'cp60-acc-state.json';
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** Every reward ledger a diagnostic could touch, for one learner. */
function ledger(userId: number) {
  return q(
    `select
       (select count(*) || ':' || coalesce(sum(points),0) from "PointHistory" where "userId" = ${userId}),
       (select count(*) || ':' || coalesce(sum(amount),0) from "CurrencyTransaction" where "userId" = ${userId}),
       (select count(*) || ':' || coalesce(sum(amount),0) from "BanhTransaction" where "userId" = ${userId}),
       (select count(*) from "LearningActivity" where "userId" = ${userId}),
       (select coalesce(max("totalPoints"),0) || ':' || coalesce(max("weeklyExp"),0) from "Leaderboard" where "userId" = ${userId})`,
  )[0].join(' | ');
}

async function latest(token: string) {
  return (await call('GET', '/diagnostic/results/latest', token)).data;
}

async function settle(token: string) {
  let r: any = null;
  for (let i = 0; i < 60; i += 1) {
    r = await latest(token);
    if (r?.fourSkill && r.fourSkill.state !== 'PENDING_GRADING') return r;
    await sleep(500);
  }
  return r;
}

async function mockPhase() {
  console.log('\n== T11 a genuine zero is counted with its weight');
  {
    const run = await runCase('acc-t11', {
      listening: 6,
      reading: 8,
      speaking: ['skip', 'skip'],
      writing: ['full', 'short'],
    });
    // The mock grader never emits 0, so a graded 0 is set on the clone: a
    // valid, graded answer whose every criterion is 0.
    const row = q(
      `select id from "DiagnosticWritingResponse" where "attemptId" = ${run.attemptId} and status = 'GRADED' and score = 75`,
    )[0][0];
    harnessExec(
      `update "DiagnosticWritingResponse" set score = 0, "scoreMetadata" = jsonb_set("scoreMetadata", '{criteria}', '{"task_achievement":0,"organisation":0,"vocabulary":0,"grammar":0}') where id = ${row}`,
      DB,
    );
    const r = await latest(run.learner.token);
    const expected = r1(
      (0.35 * 60 + 0.35 * 80 + 0.075 * 0 + 0.075 * 60) / 0.85,
    );
    const stored = q(
      `select "overallScore" from "DiagnosticAttempt" where id = ${run.attemptId}`,
    )[0][0];
    check(
      `graded 0 stays in the denominator: observed ${expected} (not ${r1((0.35 * 60 + 0.35 * 80 + 0.075 * 60) / 0.775)})`,
      r?.fourSkill?.overall === expected &&
        r.fourSkill.observed.writing.graded === 2 &&
        Number(stored) === expected,
      `(api ${r?.fourSkill?.overall}, db ${stored})`,
    );
    check(
      'the zero task is shown as 0/100, not as skipped',
      r?.fourSkill?.observed?.writing?.tasks?.some(
        (t: any) => t.status === 'GRADED' && t.score === 0,
      ),
    );
  }

  console.log('\n== T23 concurrent submission + rewards exactly once');
  {
    const learner = await newStudent('acc-t23');
    const before = ledger(learner.userId);
    const run = await runCase(
      'acc-t23',
      {
        listening: 5,
        reading: 5,
        speaking: ['record', 'skip'],
        writing: ['full', 'skip'],
      },
      learner,
      3,
    );
    const afterSubmit = ledger(learner.userId);
    const attempts = q(
      `select count(*) from "DiagnosticAttempt" where "userId" = ${learner.userId} and status = 'COMPLETED'`,
    )[0][0];
    check(
      '3 concurrent submits: every response 2xx/409, exactly one COMPLETED attempt',
      run.submits.every((s: any) => s.status < 300 || s.status === 409) &&
        attempts === '1',
      `(${run.submits.map((s: any) => s.status).join('/')}, completed ${attempts})`,
    );
    await settle(learner.token);
    await sleep(2000);
    const afterGrading = ledger(learner.userId);
    const again = await call(
      'POST',
      `/diagnostic/${run.assessmentId}/attempts`,
      learner.token,
      {
        answers: run.answers,
        submissionToken: run.token,
        attemptId: run.attemptId,
      },
    );
    const afterDuplicate = ledger(learner.userId);
    console.log(`  ledger before   ${before}`);
    console.log(`  after submit    ${afterSubmit}`);
    console.log(`  after grading   ${afterGrading}`);
    console.log(`  after re-submit ${afterDuplicate} (status ${again.status})`);
    check(
      'async grading and a late duplicate submit add no reward rows',
      afterSubmit === afterGrading && afterGrading === afterDuplicate,
    );
  }

  console.log('\n== retake, abandon, resume');
  {
    const run = await runCase('acc-retake', {
      listening: 5,
      reading: 5,
      speaking: ['skip', 'skip'],
      writing: ['skip', 'skip'],
    });
    const st = await call(
      'POST',
      `/diagnostic/${run.assessmentId}/attempts/start`,
      run.learner.token,
      {},
    );
    check(
      'a completed learner cannot start a second official attempt',
      st.data?.status === 'COMPLETED' && st.data?.attemptId === run.attemptId,
      JSON.stringify(st.data),
    );

    const learner = await newStudent('acc-resume');
    const cur = (await call('GET', '/diagnostic/current', learner.token)).data;
    const first = (
      await call(
        'POST',
        `/diagnostic/${cur.id}/attempts/start`,
        learner.token,
        {},
      )
    ).data;
    const sq = cur.questions.find(
      (x: any) => x.taskType === 'SPEAKING_RESPONSE',
    );
    const form = new FormData();
    form.append(
      'audio',
      new Blob([readFileSync(process.env.QA_WAV!)], { type: 'audio/wav' }),
      'answer.wav',
    );
    form.append('durationMs', '10000');
    await fetch(
      `${BE}/diagnostic/${cur.id}/attempts/${first.attemptId}/speaking/${sq.id}/confirm`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${learner.token}` },
        body: form,
      },
    );
    const refreshed = (await call('GET', '/diagnostic/current', learner.token))
      .data;
    const resumed = await call(
      'POST',
      `/diagnostic/${cur.id}/attempts/start`,
      learner.token,
      {},
    );
    check(
      'refresh mid-test resumes the same attempt and keeps the confirmed recording',
      refreshed.inProgressAttempt?.id === first.attemptId &&
        refreshed.inProgressAttempt.speakingResponses.some(
          (r: any) => r.questionId === sq.id,
        ) &&
        resumed.data.attemptId === first.attemptId,
    );
    const ab = await call(
      'POST',
      `/diagnostic/${cur.id}/attempts/${first.attemptId}/abandon`,
      learner.token,
      {},
    );
    const fresh = await call(
      'POST',
      `/diagnostic/${cur.id}/attempts/start`,
      learner.token,
      {},
    );
    const old = q(
      `select status from "DiagnosticAttempt" where id = ${first.attemptId}`,
    )[0][0];
    check(
      'abandon then start gives a new attempt; the old one is ABANDONED, not deleted',
      ab.status < 300 &&
        fresh.data.attemptId !== first.attemptId &&
        old === 'ABANDONED',
      `(${ab.status}, new ${fresh.data.attemptId}, old ${old})`,
    );
  }

  console.log('\n== T25 advice by plan (FREE / PLUS / PRO)');
  {
    const plan = {
      listening: 3,
      reading: 3,
      speaking: ['skip', 'skip'] as Array<'skip'>,
      writing: ['skip', 'skip'] as Array<'skip'>,
    };
    const free = await runCase('acc-free', plan);
    const admin = await newAdmin('acc-plus-granter');
    const plusLearner = await newStudent('acc-plus');
    const grant = await call(
      'POST',
      '/admin/subscriptions/grant',
      admin.token,
      {
        studentId: plusLearner.userId,
        planVersionId: Number(
          q(
            `select pv.id from "PlanVersion" pv join "Plan" p on p.id = pv."planId" where p.code = 'PLUS' and pv.status = 'PUBLISHED' order by pv.id desc limit 1`,
          )[0][0],
        ),
        durationDays: 30,
        reason: 'Harness QA access',
      },
    );
    const plus = await runCase('acc-plus', plan, plusLearner);
    const pro = await runCase('acc-pro', plan, await newProStudent('acc-pro'));
    const resources = (r: any) =>
      [
        ...(r?.advice?.priorities ?? []),
        ...(r?.advice?.supplemental ?? []),
      ].flatMap((p: any) => p.resources ?? []);
    const summary = (label: string, r: any) => {
      const list = resources(r);
      const locked = list.filter((x: any) => x.access === 'LOCKED');
      console.log(
        `  ${label}: ${list.length} resources, locked ${locked.length} [${[...new Set(locked.map((x: any) => x.requirement))].join(', ')}]`,
      );
      return { list, locked };
    };
    const f = summary('FREE', free.result);
    const p = summary('PLUS', plus.result);
    const o = summary('PRO ', pro.result);
    check('PLUS grant accepted', grant.status < 300, `${grant.status}`);
    check(
      'advice exists for every plan and links real routes',
      [f, p, o].every(
        (x) =>
          x.list.length > 0 &&
          x.list.every(
            (r: any) => typeof r.route === 'string' && r.route.startsWith('/'),
          ),
      ),
    );
    check(
      'a higher plan never sees more locks; PRO sees none',
      f.locked.length >= p.locked.length &&
        p.locked.length >= o.locked.length &&
        o.locked.length === 0,
    );
    check(
      'every lock names its plan',
      [...f.locked, ...p.locked].every(
        (r: any) =>
          typeof r.requirement === 'string' && r.requirement.length > 0,
      ),
    );
    writeFileSync(
      `${STATE}.links.json`,
      JSON.stringify({
        FREE: { email: free.learner.email, password: free.learner.password },
        PRO: { email: pro.learner.email, password: pro.learner.password },
      }),
    );
  }

  console.log(
    '\n== row-51 re-check: weighting stored on every graded Speaking row',
  );
  {
    const ids: number[] = [];
    for (const n of [1, 2, 3]) {
      const run = await runCase(`acc-t10-${n}`, {
        listening: 10,
        reading: 10,
        speaking: ['record', 'record'],
        writing: ['full', 'full'],
      });
      ids.push(run.attemptId);
    }
    const rows = q(
      `select count(*), count(*) filter (where "scoreMetadata"->>'weightingVersion' = 'DIAG_RUBRIC_WEIGHTS_V1') from "DiagnosticSpeakingResponse" where status = 'GRADED' and "attemptId" in (${ids.join(',')})`,
    )[0];
    check(
      `3×T10 on one verified process: ${rows[1]}/${rows[0]} graded Speaking rows carry the weighting`,
      rows[0] === '6' && rows[1] === '6',
    );
  }
}

async function failedPhase() {
  console.log('\n== T13 no grader available: failures are honest');
  const run = await runCase('acc-t13', {
    listening: 6,
    reading: 8,
    speaking: ['record', 'skip'],
    writing: ['full', 'skip'],
  });
  const r = await settle(run.learner.token);
  const fs = r?.fourSkill;
  check(
    'grading failed: observed withheld (PRODUCTIVE_FAILED), objective core kept, nothing zeroed',
    fs?.state === 'GRADING_FAILED' &&
      fs.overall === null &&
      fs.observed?.observed?.withheldReason === 'PRODUCTIVE_FAILED' &&
      fs.observed?.objectiveCore === 70,
    `(state ${fs?.state}, overall ${fs?.overall}, reason ${fs?.observed?.observed?.withheldReason})`,
  );
  const rows = q(
    `select 'S', status, coalesce("audioKey",'') <> '' from "DiagnosticSpeakingResponse" where "attemptId" = ${run.attemptId} and status <> 'SKIPPED'
     union all select 'W', status::text, coalesce("responseText",'') <> '' from "DiagnosticWritingResponse" where "attemptId" = ${run.attemptId}`,
  );
  check(
    'both submissions are kept (audio key / text present) in GRADING_FAILED',
    rows.length === 2 &&
      rows.every((x) => x[1] === 'GRADING_FAILED' && x[2] === 't'),
    JSON.stringify(rows),
  );
  writeFileSync(
    STATE,
    JSON.stringify({
      token: run.learner.token,
      email: run.learner.email,
      password: run.learner.password,
      userId: run.learner.userId,
      attemptId: run.attemptId,
      assessmentId: run.assessmentId,
      ledger: ledger(run.learner.userId),
    }),
  );
}

async function recoverPhase() {
  console.log('\n== T13 recovery + T23 concurrent retry');
  const s = JSON.parse(readFileSync(STATE, 'utf8'));
  const ids = (taskType: string) =>
    q(
      `select id from "DiagnosticQuestion" where "assessmentId" = ${s.assessmentId} and "taskType" = '${taskType}' order by "order"`,
    ).map((x) => x[0]);
  const [spk] = ids('SPEAKING_RESPONSE');
  const [wrt] = ids('WRITING_RESPONSE');
  const base = `/diagnostic/${s.assessmentId}/attempts/${s.attemptId}`;
  const retries = await Promise.all([
    call('POST', `${base}/writing/${wrt}/retry`, s.token, {}),
    call('POST', `${base}/writing/${wrt}/retry`, s.token, {}),
  ]);
  const codes = retries.map((x) => x.status).sort();
  check(
    'two concurrent Writing retries: one queued, the other refused (409)',
    codes[0] < 300 && codes[1] === 409,
    codes.join('/'),
  );
  const spkRetry = await call(
    'POST',
    `${base}/speaking/${spk}/retry`,
    s.token,
    {},
  );
  check('Speaking retry accepted', spkRetry.status < 300, `${spkRetry.status}`);
  const r = await settle(s.token);
  const expected = r1((0.35 * 60 + 0.35 * 80 + 0.075 * 75 * 2) / 0.85);
  check(
    `after retry both tasks GRADED and the observed score appears (${expected})`,
    r?.fourSkill?.state === 'COMPLETE' && r.fourSkill.overall === expected,
    `(state ${r?.fourSkill?.state}, overall ${r?.fourSkill?.overall})`,
  );
  const runs = q(
    `select "gradingAttempts" from "DiagnosticWritingResponse" where "attemptId" = ${s.attemptId}`,
  )[0][0];
  check(
    'the concurrent retry ran grading once more, not twice',
    runs === '2',
    `gradingAttempts ${runs}`,
  );
  await sleep(2000);
  check(
    'retry and late grading add no reward rows',
    ledger(s.userId) === s.ledger,
    `${s.ledger} -> ${ledger(s.userId)}`,
  );
}

async function main() {
  const phase = process.argv[2];
  if (phase === 'mock') await mockPhase();
  else if (phase === 'failed') await failedPhase();
  else if (phase === 'recover') await recoverPhase();
  else throw new Error('phase: mock | failed | recover');
  console.log(
    `\nCP60_ACC_GAPS_${phase.toUpperCase()}_FAILURES=${failureCount()}`,
  );
  process.exit(failureCount() ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR', e);
  process.exit(2);
});
