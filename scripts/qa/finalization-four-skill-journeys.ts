/**
 * Four-skill learner journeys per plan on the disposable harness (:3101):
 * open → (listening attempt) → submit → persisted result, for
 *   FREE: A1/A2 Listening, Reading, Writing, Speaking; B1+ refused on detail,
 *         submit, question audio and grading (direct API, no UI);
 *   PLUS: B1/B2 Listening and Reading; Speaking/Writing B1+ refused with PRO
 *         named (owner matrix 2026-10-28); Courses still refused;
 *   PRO:  B1-C1 in all four skills, the C1 Speaking set, all three courses.
 * Graders are MOCKS (deterministic writing grader, MOCK_AZURE_SPEECH); no
 * Gemini or Azure call is made, so scores prove persistence, not quality.
 * Expected objective scores come from the clone's answer keys, not the API.
 *
 * Usage: npx ts-node --transpile-only scripts/qa/finalization-four-skill-journeys.ts <10s.wav>
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { resolveReadingCorrectOption } from '../../src/modules/quiz/reading-content.validation';
import {
  BE,
  call,
  check,
  failureCount,
  newAdmin,
  newStudent,
} from './harness-api';
import { harnessQuery } from './harness-db';

const wav = readFileSync(process.argv[2]);
const one = (sql: string) => harnessQuery(sql)[0]?.[0];
type Acct = Awaited<ReturnType<typeof newStudent>>;

async function grant(admin: string, userId: number, code: 'PLUS' | 'PRO') {
  const planVersionId = Number(
    one(
      `select pv.id from "PlanVersion" pv join "Plan" p on p.id = pv."planId" where pv."isCurrent" and p.code = '${code}'`,
    ),
  );
  const r = await call('POST', '/admin/subscriptions/grant', admin, {
    studentId: userId,
    planVersionId,
    durationDays: 30,
    reason: 'Harness four-skill journeys',
  });
  if (r.status >= 300) throw new Error(`grant ${code} ${r.status}`);
}

function keyFor(quizType: string, questionId: number): string {
  const content = JSON.parse(
    one(`select content::text from "Question" where id = ${questionId}`),
  );
  if (quizType === 'BILINGUAL_READING') {
    const r = resolveReadingCorrectOption(content);
    if (r.status !== 'available') throw new Error(`no key for ${questionId}`);
    return r.answer;
  }
  if (Array.isArray(content.options) && Number.isInteger(content.correctIndex))
    return content.options[content.correctIndex];
  return content.correctAnswer ?? content.correct;
}

/** Answers every question with its key; returns the persisted Submission. */
async function objective(a: Acct, quizId: number) {
  const quiz = await call('GET', `/quizzes/${quizId}`, a.token);
  if (quiz.status !== 200) return { status: quiz.status };
  const type = one(`select type::text from "Quiz" where id = ${quizId}`);
  const questions: any[] = quiz.data.questions;
  const answers = questions.map((q) => ({
    questionId: q.id,
    answer: keyFor(type, q.id),
  }));
  let attemptId: number | undefined;
  if (type === 'LISTENING_PRACTICE') {
    const at = await call(
      'POST',
      `/quizzes/${quizId}/listening-attempts`,
      a.token,
    );
    attemptId = at.data?.id ?? at.data?.attemptId;
  }
  const sub = await call('POST', `/quizzes/${quizId}/submit`, a.token, {
    answers,
    ...(attemptId ? { attemptId } : {}),
    ...(type === 'BILINGUAL_READING' ? { clientAttemptId: randomUUID() } : {}),
  });
  const row = harnessQuery(
    `select id, score from "Submission" where "userId" = ${a.userId} and "quizId" = ${quizId} order by id desc limit 1`,
  )[0];
  return {
    status: sub.status,
    expected: questions.length,
    persistedScore: row ? Number(row[1]) : null,
    submissionId: row ? Number(row[0]) : null,
    activity: Number(
      one(
        `select count(*) from "LearningActivity" where "userId" = ${a.userId} and "sourceType" = 'QUIZ' and "sourceId" = '${quizId}'`,
      ),
    ),
  };
}

async function writing(a: Acct, quizId: number) {
  const r = await call('POST', `/writing/quizzes/${quizId}/submit`, a.token, {
    answer:
      'Dear Ms Tran, thank you for your message. I can attend the meeting on Thursday at ten. I will bring the updated budget and the delivery schedule, and I will send the slides by Wednesday evening. Best regards, Minh',
    clientAttemptId: randomUUID(),
  });
  const row = harnessQuery(
    `select id, score from "Submission" where "userId" = ${a.userId} and "quizId" = ${quizId} order by id desc limit 1`,
  )[0];
  return {
    status: r.status,
    apiStatus: r.data?.status,
    persisted: !!row && row[1] !== '',
  };
}

async function speaking(a: Acct, exerciseId: number) {
  const form = new FormData();
  form.append(
    'audio',
    new Blob([new Uint8Array(wav)], { type: 'audio/wav' }),
    'a.wav',
  );
  const res = await fetch(`${BE}/speaking/exercises/${exerciseId}/submit`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${a.token}`,
      'idempotency-key': randomUUID(),
    },
    body: form,
  });
  const id = (await res.json().catch(() => ({})))?.data?.submissionId;
  let final: string[] | undefined;
  for (let i = 0; id && i < 40; i += 1) {
    final = harnessQuery(
      `select status::text, "overallScore" from "SpeakingSubmission" where id = ${id} and "userId" = ${a.userId}`,
    )[0];
    if (final?.[0] === 'COMPLETED' || final?.[0] === 'FAILED') break;
    await new Promise((ok) => setTimeout(ok, 750));
  }
  return { status: res.status, final: final?.[0], score: final?.[1] };
}

const firstInSet = (set: string) =>
  Number(
    one(
      `select id from "SpeakingExercise" where "practiceSetId" = '${set}' order by "order" limit 1`,
    ),
  );

async function journeys(label: string, a: Acct, plan: any) {
  console.log(`\n== ${label} journeys`);
  for (const [name, id] of plan.objective as [string, number][]) {
    const r: any = await objective(a, id);
    check(
      `${label} ${name} (quiz ${id}): submit → persisted score = all keys`,
      r.status < 300 && r.persistedScore === r.expected && r.activity === 1,
      JSON.stringify(r),
    );
  }
  for (const [name, id] of plan.writing as [string, number][]) {
    const r = await writing(a, id);
    check(
      `${label} ${name} (quiz ${id}): submit → COMPLETED and persisted [MOCK grader]`,
      r.status < 300 && r.apiStatus === 'COMPLETED' && r.persisted,
      JSON.stringify(r),
    );
  }
  for (const [name, id] of plan.speaking as [string, number][]) {
    const r = await speaking(a, id);
    check(
      `${label} ${name} (exercise ${id}): submit → COMPLETED with score [MOCK Azure]`,
      r.status < 300 && r.final === 'COMPLETED' && r.score != null,
      JSON.stringify(r),
    );
  }
}

async function main() {
  const admin = await newAdmin('fsj-admin');
  const free = await newStudent('fsj-free');
  const plus = await newStudent('fsj-plus');
  const pro = await newStudent('fsj-pro');
  await grant(admin.token, plus.userId, 'PLUS');
  await grant(admin.token, pro.userId, 'PRO');
  const spk = {
    a1a2: firstInSet('practice-read-aloud-a1-a2'),
    a2: firstInSet('practice-question-response-a2'),
    b1: firstInSet('practice-pronunciation-b1'),
    b1b2: firstInSet('practice-information-response-b1-b2'),
    c1: firstInSet('practice-opinion-c1'),
  };

  await journeys('FREE', free, {
    objective: [
      ['Listening A1', 9],
      ['Listening A2 (private audio, signed)', 10],
      ['Dictation A2', 24],
      ['Reading A1–A2', 13],
    ],
    writing: [['Writing A2', 17]],
    speaking: [
      ['Speaking Read Aloud A1–A2', spk.a1a2],
      ['Speaking Question Response A2', spk.a2],
    ],
  });

  console.log('\n== FREE B1+ refused (direct API, media, grading)');
  for (const id of [11, 12, 27, 6, 16, 18]) {
    const d = await call('GET', `/quizzes/${id}`, free.token);
    check(`FREE detail quiz ${id} refused`, d.status === 403, `(${d.status})`);
  }
  for (const id of [11, 6]) {
    const qs = harnessQuery(
      `select id from "Question" where "quizId" = ${id} order by id`,
    ).map((r) => Number(r[0]));
    const type = one(`select type::text from "Quiz" where id = ${id}`);
    const s = await call('POST', `/quizzes/${id}/submit`, free.token, {
      answers: qs.map((q) => ({ questionId: q, answer: keyFor(type, q) })),
      ...(type === 'BILINGUAL_READING'
        ? { clientAttemptId: randomUUID() }
        : {}),
    });
    check(
      `FREE direct submit with correct keys to quiz ${id} refused, nothing stored`,
      s.status === 403 &&
        one(
          `select count(*) from "Submission" where "userId" = ${free.userId} and "quizId" = ${id}`,
        ) === '0',
      `(${s.status})`,
    );
  }
  const premiumQ = Number(
    one(
      `select x.id from "Question" x join "QuizAudioAsset" a on a."questionId" = x.id and a."isActive" where x."quizId" = 11 order by x.id limit 1`,
    ),
  );
  const media = await fetch(`${BE}/quizzes/11/questions/${premiumQ}/audio`, {
    headers: { authorization: `Bearer ${free.token}` },
    redirect: 'manual',
  });
  check(
    'FREE question audio stream for B1 quiz 11 refused',
    media.status === 403,
    `(${media.status})`,
  );
  const w = await writing(free, 18);
  check(
    'FREE B1 writing grading refused, nothing stored',
    w.status === 403 && !w.persisted,
    JSON.stringify(w),
  );
  for (const id of [spk.b1, spk.c1]) {
    const s = await speaking(free, id);
    check(
      `FREE speaking submit to B1+/C1 exercise ${id} refused, nothing stored`,
      s.status === 403 && !s.final,
      JSON.stringify(s),
    );
  }

  await journeys('PLUS', plus, {
    objective: [
      ['Listening B1', 11],
      ['Listening B2', 12],
      ['Conversation B1 (private audio)', 27],
      ['Reading B1', 6],
      ['Reading B2', 15],
    ],
    writing: [],
    speaking: [],
  });
  // Owner matrix 2026-10-28: Speaking and Writing B1+ need PRO.
  for (const id of [18, 7]) {
    const w = await writing(plus, id);
    check(
      `PLUS Writing quiz ${id} grading refused (PRO), nothing stored`,
      w.status === 403 && !w.persisted,
      JSON.stringify(w),
    );
  }
  for (const id of [spk.b1, spk.b1b2]) {
    const s = await speaking(plus, id);
    check(
      `PLUS Speaking exercise ${id} submit refused (PRO), nothing stored`,
      s.status === 403 && !s.final,
      JSON.stringify(s),
    );
  }
  const plusCourse = await call('GET', '/courses/1/learning', plus.token);
  check(
    'PLUS course learning refused',
    plusCourse.status === 403,
    `(${plusCourse.status})`,
  );

  await journeys('PRO', pro, {
    objective: [
      ['Listening A2', 1],
      ['Conversation B2', 28],
      ['Dictation B1', 25],
      ['Reading C1', 16],
    ],
    writing: [
      ['Writing B1', 18],
      ['Writing B2', 7],
      ['Writing B2–C1', 19],
    ],
    speaking: [
      ['Speaking Pronunciation B1', spk.b1],
      ['Speaking Information Response B1–B2', spk.b1b2],
      ['Speaking Opinion C1', spk.c1],
    ],
  });
  const c1Set = (await call('GET', '/speaking/exercises', pro.token))
    .data as any[];
  const c1 = c1Set.filter((e) => e.practiceSet?.key === 'practice-opinion-c1');
  check(
    'PRO sees the C1 set with five unlocked tasks',
    c1.length === 5 && c1.every((e) => !e.isLocked),
    `(${c1.length})`,
  );
  for (const id of harnessQuery(
    `select id from "Course" where status = 'PUBLISHED' order by id`,
  ).map((r) => Number(r[0]))) {
    const r = await call('GET', `/courses/${id}/learning`, pro.token);
    check(`PRO opens course ${id} learning`, r.status === 200, `(${r.status})`);
  }

  console.log('\n== FREE learning modules (actions persist)');
  const proTopic = Number(
    one(
      `select id from "VocabTopic" where "isPro" and "publicationStatus" = 'PUBLISHED' order by id limit 1`,
    ),
  );
  const word = Number(
    one(
      `select id from "VocabWord" where "topicId" = ${proTopic} order by id limit 1`,
    ),
  );
  const review = await call('POST', `/vocab/words/${word}/review`, free.token, {
    isCorrect: true,
  });
  const progress = harnessQuery(
    `select "reviewCount", "nextReviewAt" is not null from "UserVocabWordProgress" where "userId" = ${free.userId} and "wordId" = ${word}`,
  )[0];
  check(
    `FREE flashcard review on former PRO topic ${proTopic} persists SRS progress`,
    review.status < 300 && progress?.[0] === '1' && progress?.[1] === 't',
    `(${review.status} ${progress?.join('/')})`,
  );
  const master = await call('POST', `/vocab/words/${word}/master`, free.token, {
    isMastered: true,
  });
  check(
    'FREE marks the word mastered (persisted)',
    master.status < 300 &&
      one(
        `select "isMastered" from "UserVocabWordProgress" where "userId" = ${free.userId} and "wordId" = ${word}`,
      ) === 't',
    `(${master.status})`,
  );
  const grammarId = Number(
    one(
      `select t.id from "GrammarTopic" t where t."publicationStatus" = 'PUBLISHED' and exists (select 1 from "GrammarQuestion" q where q."topicId" = t.id) order by t.id desc limit 1`,
    ),
  );
  const keys = harnessQuery(
    `select id, "correctIndex" from "GrammarQuestion" where "topicId" = ${grammarId} order by id`,
  );
  const g = await call(
    'POST',
    `/grammar/topics/${grammarId}/attempt`,
    free.token,
    { answers: Object.fromEntries(keys.map(([id, c]) => [id, Number(c)])) },
  );
  check(
    `FREE grammar topic ${grammarId} attempt scores 100 and persists`,
    g.status < 300 &&
      g.data?.score === 100 &&
      Number(
        one(
          `select count(*) from "GrammarAttempt" where "userId" = ${free.userId} and "topicId" = ${grammarId}`,
        ),
      ) === 1,
    `(${g.status} score ${g.data?.score})`,
  );

  console.log(`\nFOUR_SKILL_JOURNEY_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
