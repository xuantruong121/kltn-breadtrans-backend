/**
 * CP60 live provider acceptance (owner-approved: at most 8 requests, estimate
 * <= 10,000 VND). Harness only: backend started in `live` mode through
 * writing-live-budget-server.ts (Gemini capped at 5 network requests, retries
 * included); Azure Speech runs once per Speaking task (single-attempt job,
 * evidence cached per submission), so at most 2 sessions.
 *
 * One learner: objective items answered, Speaking 1 and 2 from synthetic TTS
 * clips (Windows voice, not a person), Writing 1 on topic, Writing 2 fluent
 * but off topic. Reports stored = API = UI per task. No credentials printed.
 *
 *   HARNESS_DB=diag_clone LIVE_DIR=<dir with spk1.wav, spk2.wav> LIVE_LOG=<live-gemini.jsonl> \
 *     npx ts-node --transpile-only scripts/qa/cp60-acc-live-api.ts
 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

import { BE, call, check, failureCount, newStudent } from './harness-api';
import { FE } from './harness-browser';
import { harnessQuery } from './harness-db';

const DB = process.env.HARNESS_DB ?? 'diag_clone';
const q = (sql: string) => harnessQuery(sql, DB);
const DIR = process.env.LIVE_DIR!;
const LOG = process.env.LIVE_LOG!;

const ON_TOPIC =
  "Hi Lan, I'm really sorry but I can't come to our meeting tomorrow because my manager asked me to work an extra shift at the shop. Could we meet on Thursday afternoon instead, maybe at 3 pm in the library? I think we still have enough time to finish the slides. Also, could you send me the notes from last week's lecture? I need them for my part of the assignment. Thanks a lot, Minh";
const OFF_TOPIC =
  'My favourite food is pho, a Vietnamese noodle soup that my grandmother cooks every Sunday morning. She starts early, boiling beef bones for many hours with ginger, onion and star anise, so the whole house smells wonderful. When the soup is ready, we add fresh herbs, lime and a little chilli. Eating pho together is a family tradition, and it always makes me feel relaxed and happy before a busy week.';

async function main() {
  const learner = await newStudent('acc-live');
  const cur = (await call('GET', '/diagnostic/current', learner.token)).data;
  const st = (
    await call(
      'POST',
      `/diagnostic/${cur.id}/attempts/start`,
      learner.token,
      {},
    )
  ).data;
  const answers: Record<string, unknown> = {};
  for (const question of cur.questions) {
    if (question.productive) continue;
    const correct = q(
      `select options->'values'->>"correctIndex" from "DiagnosticQuestion" where id = ${question.id}`,
    )[0][0];
    answers[String(question.id)] = question.options.indexOf(correct);
  }
  const speaking = cur.questions.filter(
    (x: any) => x.taskType === 'SPEAKING_RESPONSE',
  );
  const writing = cur.questions.filter(
    (x: any) => x.taskType === 'WRITING_RESPONSE',
  );
  const clips = [
    ['spk1.wav', 23700],
    ['spk2.wav', 25500],
  ] as const;
  for (const [i, sq] of speaking.entries()) {
    const form = new FormData();
    form.append(
      'audio',
      new Blob([readFileSync(`${DIR}/${clips[i][0]}`)], { type: 'audio/wav' }),
      'answer.wav',
    );
    form.append('durationMs', String(clips[i][1]));
    const res = await fetch(
      `${BE}/diagnostic/${cur.id}/attempts/${st.attemptId}/speaking/${sq.id}/confirm`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${learner.token}` },
        body: form,
      },
    );
    console.log(`confirm speaking ${sq.id}: ${res.status}`);
  }
  answers[String(writing[0].id)] = ON_TOPIC;
  answers[String(writing[1].id)] = OFF_TOPIC;
  const submit = await call(
    'POST',
    `/diagnostic/${cur.id}/attempts`,
    learner.token,
    { answers, submissionToken: st.submissionToken, attemptId: st.attemptId },
  );
  console.log(`submit: ${submit.status}`);

  let r: any = null;
  for (let i = 0; i < 120; i += 1) {
    r = (await call('GET', '/diagnostic/results/latest', learner.token)).data;
    if (r?.fourSkill && r.fourSkill.state !== 'PENDING_GRADING') break;
    await new Promise((ok) => setTimeout(ok, 3000));
  }
  const fs = r?.fourSkill;
  console.log(
    `\nstate ${fs?.state}, observed ${fs?.overall}, core ${fs?.observed?.objectiveCore}, reason ${fs?.observed?.observed?.withheldReason}`,
  );

  const tasks = [
    ...(r?.speakingResponses ?? []).map((t: any) => ({ kind: 'S', ...t })),
    ...(r?.writingFeedback ?? []).map((t: any) => ({ kind: 'W', ...t })),
  ];
  for (const t of tasks) {
    const table =
      t.kind === 'S'
        ? 'DiagnosticSpeakingResponse'
        : 'DiagnosticWritingResponse';
    const [stored] = q(
      `select status::text, score, "scoreMetadata"->'speechEvidence'->'azure', "failureReason", provider from "${table}" where "attemptId" = ${st.attemptId} and "questionId" = ${t.questionId}`,
    );
    console.log(
      `\n${t.kind}${t.questionId} ${t.status} score ${t.score} (db ${stored?.[1]}) provider ${stored?.[4]}`,
    );
    console.log(
      `  criteria ${JSON.stringify(t.criteria)} unavailable ${JSON.stringify(t.unavailableCriteria)}`,
    );
    if (t.kind === 'S') {
      console.log(`  azure ${stored?.[2]}`);
      console.log(`  transcript: ${(t.transcript ?? '').slice(0, 160)}`);
    }
    console.log(
      `  feedback: ${(t.feedback ?? t.failureReason ?? '').slice(0, 220)}`,
    );
    check(
      `${t.kind}${t.questionId}: graded by the real provider, stored = API`,
      t.status === 'GRADED' &&
        stored?.[4] !== 'mock' &&
        Number(stored?.[1]) === t.score,
      `(${stored?.[0]}, ${stored?.[4]}, ${stored?.[3] ?? ''})`,
    );
    check(
      `${t.kind}${t.questionId}: Vietnamese feedback`,
      /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(
        t.feedback ?? '',
      ),
    );
    if (t.kind === 'S')
      check(
        `${t.kind}${t.questionId}: real acoustic evidence, so no criterion is unavailable`,
        stored?.[2] !== '' && (t.unavailableCriteria ?? []).length === 0,
      );
  }
  const [onTopic, offTopic] = (r?.writingFeedback ?? []) as any[];
  check(
    'live T16: the fluent off-topic answer scores below the on-topic one, with a low task criterion',
    typeof onTopic?.score === 'number' &&
      typeof offTopic?.score === 'number' &&
      offTopic.score < onTopic.score &&
      (offTopic.criteria?.task_achievement ?? 4) <= 1,
    `(on ${onTopic?.score}, off ${offTopic?.score}, task ${offTopic?.criteria?.task_achievement})`,
  );
  const expected =
    Math.round(
      ((0.35 * fs.skills.LISTENING.score +
        0.35 * fs.skills.READING.score +
        tasks
          .filter((t) => t.status === 'GRADED')
          .reduce((s, t) => s + 0.075 * t.score, 0)) /
        (0.7 + 0.075 * tasks.filter((t) => t.status === 'GRADED').length)) *
        10,
    ) / 10;
  check(
    `observed score follows the policy (${expected})`,
    fs?.overall === expected,
    `(${fs?.overall})`,
  );

  // UI shows the same task scores.
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1366, height: 900 },
  });
  await page.goto(`${FE}/login`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page.click('button[aria-controls="email-login-panel"]');
  await page.fill('input[name="email"]', learner.email);
  await page.fill('input[name="password"]', learner.password);
  await page.click('#email-login-panel button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), {
    waitUntil: 'commit',
  });
  await page.goto(`${FE}/diagnostic`, { waitUntil: 'networkidle' });
  await page.getByText('Điểm quan sát').first().waitFor({ timeout: 60_000 });
  const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  await page.screenshot({
    path: `${DIR}/live-result-1366.png`,
    fullPage: true,
  });
  await browser.close();
  check(
    'UI shows every task score and the observed score',
    tasks.every((t) => text.includes(`${Math.round(t.score)}/100`)) &&
      text.includes(`${String(fs?.overall).replace('.', ',')}/100`),
  );

  const log = readFileSync(LOG, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  const network = log.filter((e) => e.event === 'network').length;
  const blocked = log.filter((e) => /blocked/.test(e.event)).length;
  const usage = log
    .filter((e) => e.event === 'response' && e.usage)
    .reduce(
      (a, e) => ({
        input: a.input + (e.usage.promptTokenCount ?? 0),
        output:
          a.output +
          (e.usage.candidatesTokenCount ?? 0) +
          (e.usage.thoughtsTokenCount ?? 0),
      }),
      { input: 0, output: 0 },
    );
  const models = [...new Set(log.filter((e) => e.model).map((e) => e.model))];
  const azure = q(
    `select count(*) from "DiagnosticSpeakingResponse" where "attemptId" = ${st.attemptId} and "scoreMetadata"->'speechEvidence'->'azure' is not null`,
  )[0][0];
  const usd = (usage.input * 0.3 + usage.output * 2.5) / 1e6;
  console.log(
    `\nGemini: ${network} network requests (blocked ${blocked}), models ${models.join(',')}, tokens in ${usage.input} / out ${usage.output}, ~$${usd.toFixed(4)}`,
  );
  console.log(`Azure sessions with evidence: ${azure}`);
  check(
    'requests within the approved cap (Gemini <= 5, Azure <= 2, total <= 8)',
    network <= 5 && Number(azure) <= 2 && network + Number(azure) <= 8,
  );
  console.log(`\nCP60_ACC_LIVE_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR', e instanceof Error ? e.message : e);
  process.exit(2);
});
