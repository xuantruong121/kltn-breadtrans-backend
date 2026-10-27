/**
 * Owner reward policy, measured on persisted balances (disposable harness,
 * deterministic writing grader + mock Speaking evaluator on :3101).
 *
 * XP   = sum of PointHistory.points for the learner
 * Bread = UserStats.totalBanhRan, plus the BanhTransaction count
 * Quest = UserQuestProgress rows advanced today
 *
 * Rewarded: standalone Listening, Reading, Speaking, Writing practice.
 * Not rewarded: Diagnostic, TOEIC L&R / S&W / 4 Skills, course-linked quiz,
 * grammar, lesson content, flashcard vocabulary.
 * Arena is rewarded in the arena gateway (not exercised here; see report).
 *
 * Usage: npx ts-node --transpile-only scripts/qa/finalization-reward-policy-api.ts <10s.wav> <34s.wav>
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  BE,
  call,
  check,
  failureCount,
  newProStudent,
  newStudent,
} from './harness-api';
import { harnessExec, harnessQuery } from './harness-db';

const wavPath = process.argv[2];
const longWavPath = process.argv[3] ?? wavPath;
const wav = readFileSync(wavPath);

type Learner = Awaited<ReturnType<typeof newStudent>>;

function balance(userId: number) {
  const xp = Number(
    harnessQuery(
      `select coalesce(sum(points), 0) from "PointHistory" where "userId" = ${userId}`,
    )[0][0],
  );
  const bread = Number(
    harnessQuery(
      `select coalesce(max("totalBanhRan"), 0) from "UserStats" where "userId" = ${userId}`,
    )[0][0],
  );
  const banhTx = Number(
    harnessQuery(
      `select count(*) from "BanhTransaction" where "userId" = ${userId}`,
    )[0][0],
  );
  const quests = Number(
    harnessQuery(
      `select coalesce(sum("currentValue"), 0) from "UserQuestProgress" where "userId" = ${userId}`,
    )[0][0],
  );
  return { xp, bread, banhTx, quests };
}

const settle = () => new Promise((ok) => setTimeout(ok, 2500));

async function expectDelta(
  label: string,
  rewarded: boolean,
  act: (l: Learner) => Promise<void>,
  pro = false,
) {
  const learner = await (pro ? newProStudent : newStudent)(
    `rw-${label.replace(/\W+/g, '').slice(0, 12)}`,
  );
  const before = balance(learner.userId);
  await act(learner);
  await settle();
  const after = balance(learner.userId);
  const d = {
    xp: after.xp - before.xp,
    bread: after.bread - before.bread,
    banhTx: after.banhTx - before.banhTx,
    quests: after.quests - before.quests,
  };
  if (rewarded)
    check(`${label}: rewarded (XP > 0)`, d.xp > 0, JSON.stringify(d));
  else
    check(
      `${label}: XP 0, Bread 0, no Bread ledger row, no quest progress`,
      d.xp === 0 && d.bread === 0 && d.banhTx === 0 && d.quests === 0,
      JSON.stringify(d),
    );
  return { learner, d };
}

function keyAnswers(quizId: number) {
  return harnessQuery(
    `select id, content::text from "Question" where "quizId" = ${quizId} order by "order", id`,
  ).map(([id, c]) => {
    const content = JSON.parse(c);
    const answer = Number.isInteger(content.correctIndex)
      ? content.options?.[content.correctIndex]
      : (content.correct ?? content.options?.[0] ?? 'A');
    return { questionId: Number(id), answer };
  });
}

async function submitQuiz(
  l: Learner,
  quizId: number,
  listening: boolean,
  clientAttemptId = randomUUID(),
) {
  const attemptId = listening
    ? (await call('POST', `/quizzes/${quizId}/listening-attempts`, l.token))
        .data?.id
    : undefined;
  const r = await call('POST', `/quizzes/${quizId}/submit`, l.token, {
    answers: keyAnswers(quizId),
    attemptId,
    clientAttemptId,
  });
  if (r.status >= 300)
    check(
      `quiz ${quizId} submit`,
      false,
      `${r.status} ${JSON.stringify(r.message)}`,
    );
  return r;
}

async function main() {
  const listeningQuiz = Number(
    harnessQuery(
      `select id from "Quiz" where type::text = 'LISTENING_PRACTICE' and "isPremiumContent" = false and "publicationStatus"::text = 'PUBLISHED' order by id limit 1`,
    )[0][0],
  );
  const courseQuiz = Number(
    harnessQuery(
      `select id from "Quiz" where type::text = 'LISTENING_PRACTICE' and "isPremiumContent" = false and "publicationStatus"::text = 'PUBLISHED' and id <> ${listeningQuiz} order by id limit 1`,
    )[0][0],
  );
  const readingQuiz = Number(
    harnessQuery(
      `select id from "Quiz" where type::text = 'BILINGUAL_READING' and "isPremiumContent" = false and "publicationStatus"::text = 'PUBLISHED' order by id limit 1`,
    )[0][0],
  );

  // Rewarded
  const listening = await expectDelta(
    'standalone Listening practice',
    true,
    async (l) => {
      await submitQuiz(l, listeningQuiz, true);
    },
  );
  check(
    'Listening practice advances the practice quest',
    listening.d.quests > 0,
    String(listening.d.quests),
  );
  await expectDelta('standalone Reading practice', true, async (l) => {
    await submitQuiz(l, readingQuiz, false);
  });
  await expectDelta('standalone Speaking practice', true, async (l) => {
    const form = new FormData();
    form.append(
      'audio',
      new Blob([new Uint8Array(wav)], { type: 'audio/wav' }),
      'a.wav',
    );
    const res = await fetch(`${BE}/speaking/exercises/1/submit`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${l.token}`,
        'idempotency-key': randomUUID(),
      },
      body: form,
    });
    const id = ((await res.json()).data ?? {}).submissionId;
    for (let i = 0; i < 30; i += 1) {
      const s = harnessQuery(
        `select "rewardStatus" from "SpeakingSubmission" where id = ${id}`,
      )[0]?.[0];
      if (s === 'COMPLETED') break;
      await new Promise((ok) => setTimeout(ok, 1000));
    }
  });
  await expectDelta(
    'standalone Writing practice (single-task quiz 7)',
    true,
    async (l) => {
      const r = await call('POST', '/writing/quizzes/7/submit', l.token, {
        answer:
          'Dear customer, we are sorry about the scratched chairs. We will replace all ten chairs this week and collect the damaged ones at no cost. Please tell us a convenient delivery time. Best regards, Customer Service',
        clientAttemptId: randomUUID(),
      });
      if (r.status >= 300)
        check(
          'writing practice submit',
          false,
          `${r.status} ${JSON.stringify(r.data).slice(0, 120)}`,
        );
    },
    true, // quiz 7 is PLUS content
  );

  // Replay: same listening quiz again -> no second payout.
  const replayLearner = listening.learner;
  const beforeReplay = balance(replayLearner.userId);
  await submitQuiz(replayLearner, listeningQuiz, true);
  await settle();
  const afterReplay = balance(replayLearner.userId);
  check(
    'a repeated Listening practice earns no second payout',
    afterReplay.xp === beforeReplay.xp &&
      afterReplay.bread === beforeReplay.bread,
    JSON.stringify({ beforeReplay, afterReplay }),
  );

  // Not rewarded
  await expectDelta('TOEIC L&R exam', false, async (l) => {
    const start = await call('POST', '/toeic/exams/1/attempts', l.token, {
      mode: 'FULL_TEST',
    });
    const id = start.data?.id;
    await call('POST', `/toeic/attempts/${id}/begin`, l.token, {});
    const sub = await call('POST', `/toeic/attempts/${id}/submit`, l.token, {});
    check(
      'TOEIC L&R still submits and scores',
      sub.data?.status === 'SUBMITTED',
      sub.data?.status,
    );
  });
  for (const assessment of [1, 2])
    await expectDelta(
      `TOEIC assessment ${assessment} (${assessment === 1 ? 'S&W' : '4 Skills'}) full lifecycle`,
      false,
      async (l) => {
        const out = execFileSync(
          'npx',
          [
            'ts-node',
            '--transpile-only',
            'scripts/qa/finalization-toeic-full-api.ts',
            String(assessment),
            wavPath,
            longWavPath,
          ],
          {
            env: {
              ...process.env,
              TOEIC_FULL_EMAIL: l.email,
              TOEIC_FULL_PASSWORD: l.password,
            },
            encoding: 'utf8',
            shell: true,
            timeout: 600_000,
          },
        );
        check(
          `TOEIC assessment ${assessment} still completes with results`,
          out.includes('ALL PASS'),
          out
            .split('\n')
            .filter((x) => x.startsWith('FAIL'))
            .join(' | '),
        );
      },
    );
  await expectDelta('course-linked Listening quiz', false, async (l) => {
    const lesson = harnessQuery(
      `select id, "courseId" from "Lesson" order by id limit 1`,
    )[0];
    harnessExec(
      `insert into "CourseActivity" ("courseId", "lessonId", "order", kind, "quizId", "updatedAt") values (${lesson[1]}, ${lesson[0]}, 9001, 'QUIZ', ${courseQuiz}, now())`,
    );
    try {
      await submitQuiz(l, courseQuiz, true);
    } finally {
      harnessExec(
        `delete from "CourseActivity" where "lessonId" = ${lesson[0]} and "order" = 9001 and "quizId" = ${courseQuiz}`,
      );
    }
  });
  await expectDelta('grammar topic', false, async (l) => {
    const topic = harnessQuery(
      `select t.id from "GrammarTopic" t where exists (select 1 from "GrammarQuestion" q where q."topicId" = t.id) order by t.id limit 1`,
    )[0]?.[0];
    const qs = harnessQuery(
      `select id from "GrammarQuestion" where "topicId" = ${topic}`,
    );
    const r = await call('POST', `/grammar/topics/${topic}/attempt`, l.token, {
      answers: Object.fromEntries(qs.map(([id]) => [id, 0])),
    });
    check(
      'grammar attempt still scores',
      r.status < 300 && typeof r.data?.score === 'number',
      `${r.status}`,
    );
  });
  await expectDelta('lesson content', false, async (l) => {
    const list = await call('GET', '/content-topics', l.token);
    const topic = (
      Array.isArray(list.data) ? list.data : (list.data?.items ?? [])
    )[0];
    const detail = await call(
      'GET',
      `/content-topics/${topic?.id ?? topic?.slug}`,
      l.token,
    );
    const exercises: any[] = detail.data?.exercises ?? [];
    const r = await call(
      'POST',
      `/content-topics/${topic?.id ?? topic?.slug}/attempts`,
      l.token,
      { answers: Object.fromEntries(exercises.map((e: any) => [e.id, 0])) },
    );
    check(
      'lesson content attempt still scores',
      r.status < 300,
      `${r.status} ${JSON.stringify(r.data).slice(0, 80)}`,
    );
  });
  await expectDelta(
    'flashcard vocabulary (mark mastered)',
    false,
    async (l) => {
      const word = harnessQuery(
        `select id from "VocabWord" order by id limit 1`,
      )[0]?.[0];
      const r = await call('POST', `/vocab/words/${word}/master`, l.token, {
        isMastered: true,
      });
      check(
        'vocabulary mastery is still recorded',
        r.status < 300,
        String(r.status),
      );
    },
  );
  await expectDelta('Entry Diagnostic submission', false, async (l) => {
    const start = await call('POST', '/diagnostic/5/attempts/start', l.token);
    const current = await call('GET', '/diagnostic/current', l.token);
    const answers: Record<string, number | string> = {};
    for (const q of current.data?.questions ?? []) {
      if (q.taskType === 'SPEAKING_RESPONSE')
        await call(
          'POST',
          `/diagnostic/5/attempts/${start.data?.attemptId}/speaking/${q.id}/skip`,
          l.token,
        );
      else if (q.taskType === 'WRITING_RESPONSE')
        answers[q.id] =
          'I usually study in the library because it is quiet and close to my home. '.repeat(
            8,
          );
      else answers[q.id] = 0;
    }
    const r = await call('POST', '/diagnostic/5/attempts', l.token, {
      answers,
      submissionToken: start.data?.submissionToken,
      attemptId: start.data?.attemptId,
    });
    check(
      'the diagnostic submission is accepted',
      r.status < 300,
      `${r.status} ${JSON.stringify(r.data).slice(0, 100)}`,
    );
  });

  console.log(
    `\n${failureCount() ? 'FAILURES: ' + failureCount() : 'ALL PASS'}`,
  );
  process.exit(failureCount() ? 1 : 0);
}

void main();
