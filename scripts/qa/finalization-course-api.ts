/**
 * Course Learning workflows over HTTP, disposable harness only. Expected
 * results come from the clone's stored keys.
 */
import {
  call,
  check,
  failureCount,
  newProStudent,
  newStudent,
} from './harness-api';
import { harnessQuery } from './harness-db';

async function main() {
  console.log('\n== Courses: access');
  const free = await newStudent('course-free');
  const pro = await newProStudent('course-pro');
  const catalog = await call('GET', '/public/courses');
  check(
    'public catalog lists the published courses',
    catalog.status === 200 && catalog.data.length === 3,
    `(${catalog.data?.map((c: any) => c.id).join(',')})`,
  );
  for (const c of catalog.data) {
    const fs = await call('POST', `/courses/${c.id}/start`, free.token);
    check(
      `course ${c.id}: a learner without PRO is refused`,
      fs.status === 403,
      `(status ${fs.status})`,
    );
    const ps = await call('POST', `/courses/${c.id}/start`, pro.token);
    const ov = await call('GET', `/courses/${c.id}/learning`, pro.token);
    check(
      `course ${c.id}: a PRO learner can start it and open the learning path`,
      ps.status < 300 && ov.status === 200,
      `(start ${ps.status}, learning ${ov.status}, ${ov.data?.lessons?.length} lessons)`,
    );
  }

  console.log('\n== Courses: lesson and exercises (course 1, first lesson)');
  const overview = await call('GET', '/courses/1/learning', pro.token);
  const lessonId = overview.data.lessons[0].id;
  const lesson = await call(
    'GET',
    `/courses/1/learning/lessons/${lessonId}`,
    pro.token,
  );
  check(
    'lesson opens with sections and exercises',
    lesson.status === 200 &&
      lesson.data.lesson.sections?.length > 0 &&
      lesson.data.lesson.exercises?.length > 0,
  );
  check(
    'no answer key or explanation before submission',
    !/"(correctAnswer|explanation)"/.test(
      JSON.stringify(lesson.data.lesson.exercises),
    ),
  );
  const otherCourse = await call(
    'GET',
    `/courses/8/learning/lessons/${lessonId}`,
    pro.token,
  );
  check(
    'a lesson cannot be opened through another course id',
    otherCourse.status === 404,
    `(status ${otherCourse.status})`,
  );

  for (const ex of lesson.data.lesson.exercises.filter(
    (e: any) => e.required,
  )) {
    const keys = new Map(
      harnessQuery(
        `select id, "correctAnswer"::text from "CourseLessonQuestion" where "exerciseId" = ${ex.id}`,
      ).map(([id, key]) => [Number(id), JSON.parse(key)]),
    );
    const objective = ex.questions.filter(
      (q: any) => Array.isArray(q.options) && q.options.length > 0,
    );
    const open = ex.questions.filter(
      (q: any) => !Array.isArray(q.options) || q.options.length === 0,
    );

    const wrongOwnWords = await call(
      'POST',
      `/courses/1/learning/lessons/${lessonId}/exercises/${ex.id}/submit`,
      pro.token,
      {
        answers: ex.questions.map((q: any) => ({
          questionId: q.id,
          answer: open.includes(q) ? '' : keys.get(q.id),
        })),
      },
    );
    if (open.length)
      check(
        `exercise ${ex.id}: blank free-text answers are refused`,
        wrongOwnWords.status === 400,
        `(status ${wrongOwnWords.status})`,
      );

    const answers = ex.questions.map((q: any) => ({
      questionId: q.id,
      answer: open.includes(q)
        ? 'My own answer, written differently from the model.'
        : keys.get(q.id),
    }));
    const res = await call(
      'POST',
      `/courses/1/learning/lessons/${lessonId}/exercises/${ex.id}/submit`,
      pro.token,
      { answers },
    );
    check(
      `exercise ${ex.id}: correct objective answers + own-words free text completes it`,
      res.status < 300 &&
        res.data.completed === true &&
        res.data.score === objective.length &&
        res.data.maxScore === objective.length,
      `(score ${res.data?.score}/${res.data?.maxScore}, ${open.length} free-text, completed ${res.data?.completed})`,
    );
    check(
      `exercise ${ex.id}: free-text items come back with the model answer, not marked wrong`,
      open.every(
        (q: any) =>
          res.data.feedback.find((f: any) => f.questionId === q.id)
            ?.isCorrect === null,
      ),
    );
  }
  const after = await call('GET', '/courses/1/learning', pro.token);
  check(
    'lesson is completed and course progress advanced',
    after.data.lessons[0].completed === true &&
      after.data.progress.completedLessons === 1,
    `(${JSON.stringify(after.data.progress)})`,
  );

  const otherPro = await newProStudent('course-pro-b');
  const theirs = await call('GET', '/courses/1/learning', otherPro.token);
  check('progress is per learner', theirs.data.progress.completedLessons === 0);

  console.log(`\nCOURSE_API_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}
main().catch((e) => {
  console.error('ERROR', e);
  process.exit(2);
});
