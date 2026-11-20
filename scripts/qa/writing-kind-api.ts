/**
 * Writing CMS kinds and the picture-task data loss, over HTTP on the
 * disposable harness only (:3101), owner 2026-11-19/20:
 * - kind=PICTURE lists picture exercises without "Dịch câu", kind=TRANSLATION
 *   only "Dịch câu", and the four kinds add up to the whole list;
 * - editing a seeded PICTURE_SENTENCE task through the CMS keeps its rubric,
 *   scene and requirements, and writes requiredKeywords.
 */
import { call, check, failureCount, newAdmin } from './harness-api';
import { harnessQuery } from './harness-db';

const DB = process.env.HARNESS_DB ?? 'dev_qa';
const KINDS = ['TRANSLATION', 'PICTURE', 'SENTENCE', 'EMAIL'];

type Row = { id: number; writingKind?: string; practiceTopicId?: number };

async function main() {
  console.log('\n== Writing CMS kinds');
  const admin = await newAdmin('wcms');
  const list = async (kind?: string) => {
    const res = await call(
      'GET',
      `/admin/skill-content/writing?page=1&pageSize=200${kind ? `&kind=${kind}` : ''}`,
      admin.token,
    );
    return {
      status: res.status,
      items: (res.data?.items ?? []) as Row[],
      total: res.data?.total as number,
    };
  };

  const all = await list();
  check(
    'the writing list answers',
    all.status === 200,
    `(status ${all.status})`,
  );
  const translationTopic = harnessQuery(
    `select id from "PracticeTopic" where name = 'Sentence Translation' limit 1`,
    DB,
  )[0]?.[0];

  let sum = 0;
  for (const kind of KINDS) {
    const page = await list(kind);
    sum += page.total;
    check(
      `kind=${kind} returns only ${kind}`,
      page.status === 200 &&
        page.items.every((row) => row.writingKind === kind),
      `(status ${page.status}, ${page.total} rows)`,
    );
    if (kind === 'PICTURE' && translationTopic)
      check(
        'kind=PICTURE holds no "Dịch câu" exercise',
        page.items.every(
          (row) => String(row.practiceTopicId) !== translationTopic,
        ),
      );
  }
  check(
    'the four kinds add up to the whole list',
    sum === all.total,
    `(${sum} of ${all.total})`,
  );

  console.log('\n== Editing a seeded picture task keeps its rubric');
  const seeded = harnessQuery(
    `select q.id, q."quizId" from "Question" q join "Quiz" z on z.id = q."quizId"
     where q.content->>'taskType' = 'PICTURE_SENTENCE' and q.content ? 'rubric'
       and not exists (select 1 from "ToeicWritingSetItem" i where i."writingQuizId" = z.id)
     order by q.id limit 1`,
    DB,
  )[0];
  if (!seeded) {
    console.log(
      'NOT_RUN  no seeded PICTURE_SENTENCE task with a rubric in this clone',
    );
  } else {
    const [questionId, quizId] = seeded;
    const before = JSON.parse(
      harnessQuery(
        `select content::text from "Question" where id = ${questionId}`,
        DB,
      )[0][0],
    );
    const res = await call(
      'PATCH',
      `/admin/skill-content/writing/${quizId}/questions/${questionId}`,
      admin.token,
      {
        type: 'WRITING',
        prompt: `${before.prompt} (CMS)`,
        taskType: 'PICTURE_SENTENCE',
        imageUrl: before.imageUrl,
        keywords: before.requiredKeywords ?? before.keywords ?? [],
      },
    );
    check('the CMS save answers', res.status < 300, `(status ${res.status})`);
    const after = JSON.parse(
      harnessQuery(
        `select content::text from "Question" where id = ${questionId}`,
        DB,
      )[0][0],
    );
    check('the prompt changed', after.prompt === `${before.prompt} (CMS)`);
    check(
      'rubric kept',
      JSON.stringify(after.rubric) === JSON.stringify(before.rubric),
    );
    check(
      'scene, sample and requirements kept',
      after.sceneDescription === before.sceneDescription &&
        after.sampleResponse === before.sampleResponse &&
        JSON.stringify(after.requirements) ===
          JSON.stringify(before.requirements),
    );
    check(
      'word range kept',
      JSON.stringify(after.wordRange) === JSON.stringify(before.wordRange),
    );
    check(
      'requiredKeywords written for the grader',
      Array.isArray(after.requiredKeywords) &&
        after.requiredKeywords.length === 2,
      `(${JSON.stringify(after.requiredKeywords)})`,
    );
  }

  const old = await call(
    'GET',
    '/admin/skill-content/writing/pictures',
    admin.token,
  );
  check(
    'the old picture tab endpoint is gone',
    old.status >= 400,
    `(status ${old.status})`,
  );

  console.log(`\nwriting-kind failures: ${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

void main();
