/**
 * Full Course Learning 5.0 journey over HTTP, disposable harness only.
 *
 * Every published course is completed end to end by one PRO learner, with
 * answer keys read from the clone. Asserts entitlement (FREE/PLUS/guest),
 * draft invisibility, detail/learning lesson identity, sticky completion,
 * duplicate and concurrent submissions, per-learner progress, and that the
 * whole journey moves no XP, no Bread, no Bread ledger row and no quest.
 */
import {
  call,
  check,
  failureCount,
  newProStudent,
  newStudent,
} from './harness-api';
import { harnessExec, harnessQuery } from './harness-db';

type Learner = Awaited<ReturnType<typeof newStudent>>;

function balance(userId: number) {
  const one = (sql: string) => Number(harnessQuery(sql)[0][0]);
  return {
    xp: one(
      `select coalesce(sum(points), 0) from "PointHistory" where "userId" = ${userId}`,
    ),
    bread: one(
      `select coalesce(max("totalBanhRan"), 0) from "UserStats" where "userId" = ${userId}`,
    ),
    banhTx: one(
      `select count(*) from "BanhTransaction" where "userId" = ${userId}`,
    ),
    quests: one(
      `select coalesce(sum("currentValue"), 0) from "UserQuestProgress" where "userId" = ${userId}`,
    ),
  };
}

const keys = new Map<number, unknown>(
  harnessQuery(
    `select id, "correctAnswer"::text from "CourseLessonQuestion"`,
  ).map(([id, key]) => [Number(id), JSON.parse(key)]),
);

const attemptRows = (userId: number) =>
  Number(
    harnessQuery(
      `select count(*) from "CourseLessonAttempt" where "userId" = ${userId}`,
    )[0][0],
  );

/** Answers for one exercise: the key for choice items, the learner's own words for free text. */
function answersFor(exercise: any, wrong = false) {
  return exercise.questions.map((q: any) => {
    const options = Array.isArray(q.options) ? q.options : [];
    if (options.length === 0)
      return {
        questionId: q.id,
        answer: 'In my own words: this is my answer.',
      };
    const key = keys.get(q.id);
    const other = options.find(
      (o: unknown) => JSON.stringify(o) !== JSON.stringify(key),
    );
    return { questionId: q.id, answer: wrong ? other : key };
  });
}

const submit = (
  l: Learner,
  courseId: number,
  lessonId: number,
  exercise: any,
  wrong = false,
) =>
  call(
    'POST',
    `/courses/${courseId}/learning/lessons/${lessonId}/exercises/${exercise.id}/submit`,
    l.token,
    {
      answers: answersFor(exercise, wrong),
    },
  );

async function main() {
  const catalog = await call('GET', '/public/courses');
  const courseIds: number[] = catalog.data.map((c: any) => c.id);

  console.log('\n== Drafts are invisible to learners, including PRO');
  const draftId = Number(
    harnessExec(
      `insert into "Course" (title, status, "updatedAt") values ('QA draft course', 'DRAFT', now()) returning id`,
    )[0][0],
  );
  const pro = await newProStudent('journey-pro');
  const draftDetail = await call(
    'GET',
    `/public/courses/${draftId}`,
    pro.token,
  );
  const draftLearning = await call(
    'GET',
    `/courses/${draftId}/learning`,
    pro.token,
  );
  check(
    'draft course is not in the public catalog',
    !courseIds.includes(draftId),
  );
  check(
    'PRO learner cannot open a draft course detail',
    draftDetail.status === 404,
    `(status ${draftDetail.status})`,
  );
  check(
    'PRO learner cannot open a draft learning path',
    draftLearning.status === 404,
    `(status ${draftLearning.status})`,
  );
  harnessExec(
    `delete from "Course" where id = ${draftId} and status = 'DRAFT' and title = 'QA draft course'`,
  );

  console.log(
    '\n== Entitlement: guest, FREE and PLUS are refused on every learning endpoint',
  );
  const free = await newStudent('journey-free');
  const plus = await newStudent('journey-plus');
  const grant = await call(
    'POST',
    '/admin/subscriptions/grant',
    pro.admin.token,
    {
      studentId: plus.userId,
      planVersionId: 21,
      durationDays: 30,
      reason: 'Harness QA PLUS',
    },
  );
  check(
    'PLUS plan granted to the PLUS learner',
    grant.status < 300,
    `(status ${grant.status})`,
  );
  for (const id of courseIds) {
    const firstLesson = harnessQuery(
      `select l.id, e.id from "CourseLesson" l join "CourseLessonExercise" e on e."lessonId" = l.id where l."courseId" = ${id} and l.status = 'PUBLISHED' order by l."order", e."order" limit 1`,
    )[0];
    for (const [who, token] of [
      ['guest', undefined],
      ['FREE', free.token],
      ['PLUS', plus.token],
    ] as const) {
      const ov = await call('GET', `/courses/${id}/learning`, token);
      const ls = await call(
        'GET',
        `/courses/${id}/learning/lessons/${firstLesson[0]}`,
        token,
      );
      const sb = await call(
        'POST',
        `/courses/${id}/learning/lessons/${firstLesson[0]}/exercises/${firstLesson[1]}/submit`,
        token,
        { answers: [] },
      );
      const denied = (s: number) => s === 401 || s === 403;
      check(
        `course ${id}: ${who} refused on overview, lesson and submit`,
        denied(ov.status) && denied(ls.status) && denied(sb.status),
        `(${ov.status}/${ls.status}/${sb.status})`,
      );
    }
  }

  console.log('\n== Detail page lists the same lessons the learner studies');
  for (const id of courseIds) {
    const detail = await call('GET', `/public/courses/${id}`, pro.token);
    const learning = await call('GET', `/courses/${id}/learning`, pro.token);
    const a = detail.data.lessons.map((l: any) => l.id).join(',');
    const b = learning.data.lessons.map((l: any) => l.id).join(',');
    const acts = detail.data.lessons.reduce(
      (n: number, l: any) => n + (l.activities?.length ?? 0),
      0,
    );
    check(
      `course ${id}: detail lessons = learning lessons, with activities`,
      a === b && acts > 0,
      `(${a} | ${acts} activities)`,
    );
  }

  console.log(
    '\n== A PRO learner completes every published course; no currency moves',
  );
  const before = balance(pro.userId);
  for (const id of courseIds) {
    const overview = await call('GET', `/courses/${id}/learning`, pro.token);
    check(
      `course ${id}: starts at 0%`,
      overview.data.progress.percentage === 0,
      JSON.stringify(overview.data.progress),
    );
    let lessonId: number | null = overview.data.lessons[0].id;
    let visited = 0;
    while (lessonId) {
      const lesson = await call(
        'GET',
        `/courses/${id}/learning/lessons/${lessonId}`,
        pro.token,
      );
      if (lesson.status !== 200) {
        check(
          `course ${id} lesson ${lessonId}: opens`,
          false,
          `(status ${lesson.status})`,
        );
        break;
      }
      for (const exercise of lesson.data.lesson.exercises) {
        const r = await submit(pro, id, lessonId, exercise);
        if (r.status !== 200 || !r.data.completed)
          check(
            `course ${id} exercise ${exercise.id}: correct answers complete it`,
            false,
            `(status ${r.status}, ${JSON.stringify(r.data ?? r.message).slice(0, 160)})`,
          );
      }
      visited += 1;
      lessonId = lesson.data.navigation.nextLessonId;
    }
    const done = await call('GET', `/courses/${id}/learning`, pro.token);
    check(
      `course ${id}: all ${visited} lessons walked via "next"; course 100% complete`,
      visited === done.data.lessons.length &&
        done.data.progress.isComplete &&
        done.data.progress.percentage === 100,
      JSON.stringify(done.data.progress),
    );
  }

  console.log('\n== Repeat and retry behaviour (course ' + courseIds[0] + ')');
  const cid = courseIds[0];
  const ov = await call('GET', `/courses/${cid}/learning`, pro.token);
  const lid = ov.data.lessons[0].id;
  const lesson = await call(
    'GET',
    `/courses/${cid}/learning/lessons/${lid}`,
    pro.token,
  );
  const ex = lesson.data.lesson.exercises.find((e: any) =>
    e.questions.some(
      (q: any) => Array.isArray(q.options) && q.options.length > 0,
    ),
  );
  const rows = attemptRows(pro.userId);
  const again = await submit(pro, cid, lid, ex);
  check(
    'identical resubmission reuses the stored attempt (no new row)',
    again.status === 200 && attemptRows(pro.userId) === rows,
    `(${rows} -> ${attemptRows(pro.userId)})`,
  );
  const wrong = await submit(pro, cid, lid, ex, true);
  check(
    'a wrong retry is graded as not passed',
    wrong.status === 200 && wrong.data.completed === false,
    `(score ${wrong.data?.score}/${wrong.data?.maxScore})`,
  );
  const after = await call('GET', `/courses/${cid}/learning`, pro.token);
  check(
    'a weaker retry does not take back course completion',
    after.data.progress.isComplete === true,
    JSON.stringify(after.data.progress),
  );

  await new Promise((ok) => setTimeout(ok, 2500));
  const end = balance(pro.userId);
  const d = {
    xp: end.xp - before.xp,
    bread: end.bread - before.bread,
    banhTx: end.banhTx - before.banhTx,
    quests: end.quests - before.quests,
  };
  check(
    'whole course journey: XP 0, Bread 0, no Bread ledger row, no quest progress',
    Object.values(d).every((v) => v === 0),
    JSON.stringify(d),
  );

  console.log('\n== Concurrency, ownership and partial progress');
  const fresh = await newProStudent('journey-concurrent');
  const results = await Promise.all(
    Array.from({ length: 5 }, () => submit(fresh, cid, lid, ex)),
  );
  check(
    'five concurrent identical submissions store one attempt',
    results.every((r) => r.status === 200) && attemptRows(fresh.userId) === 1,
    `(statuses ${results.map((r) => r.status).join(',')}, rows ${attemptRows(fresh.userId)})`,
  );
  const partial = await call('GET', `/courses/${cid}/learning`, fresh.token);
  check(
    'one passed exercise of a two-exercise lesson leaves the lesson incomplete',
    partial.data.lessons[0].completed === false &&
      partial.data.progress.completedLessons === 0,
    JSON.stringify(partial.data.progress),
  );
  const proView = await call('GET', `/courses/${cid}/learning`, pro.token);
  check(
    "another learner's attempts do not change this learner's progress",
    proView.data.progress.isComplete === true,
  );

  console.log(`\nCOURSE_JOURNEY_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
