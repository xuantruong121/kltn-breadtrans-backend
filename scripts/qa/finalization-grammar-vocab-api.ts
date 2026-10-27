/**
 * Grammar and Vocabulary workflows over HTTP, disposable harness only.
 * Grammar topics are DRAFT in the real database too, so this run publishes
 * them in the CLONE through the Admin API (which applies the readiness
 * checks) to exercise the learner flow. Nothing is published in kltn_db.
 */
import { call, check, failureCount, newAdmin, newStudent } from './harness-api';
import { harnessQuery } from './harness-db';

const KEY_FIELDS = /"(correctIndex|correctOption|explanation)"/;

async function grammar() {
  console.log('\n== Grammar');
  const admin = await newAdmin('grammar-admin');
  const a = await newStudent('grammar-a');

  const studentPublish = await call(
    'POST',
    '/grammar/topics/1/publish',
    a.token,
  );
  check(
    'a learner cannot publish a topic',
    studentPublish.status === 403,
    `(status ${studentPublish.status})`,
  );

  const ids = harnessQuery(`select id from "GrammarTopic" order by id`).map(
    ([id]) => Number(id),
  );
  const results: string[] = [];
  // A previous run on the same clone may have published topic 2; put it back
  // to DRAFT through the Admin API so the gating checks below are meaningful.
  await call('POST', '/grammar/topics/2/unpublish', admin.token);
  for (const id of ids) {
    if (id === 2) continue; // kept DRAFT to test gating
    const r = await call('POST', `/grammar/topics/${id}/publish`, admin.token);
    results.push(`${id}:${r.status}`);
  }
  check(
    'every existing topic passes the publish readiness checks (clone)',
    results.every((r) => /:2\d\d$/.test(r)),
    `(${results.join(' ')})`,
  );

  const list = await call('GET', '/grammar/topics', a.token);
  const listed: any[] = Array.isArray(list.data)
    ? list.data
    : (list.data?.items ?? []);
  check(
    'learner list shows published topics only',
    listed.length === ids.length - 1 && !listed.some((t) => t.id === 2),
    `(${listed.length})`,
  );
  const draft = await call('GET', '/grammar/topics/2', a.token);
  check(
    'a DRAFT topic is not served to learners',
    draft.status === 404,
    `(status ${draft.status})`,
  );

  const topic = await call('GET', '/grammar/topics/1', a.token);
  check('topic opens', topic.status === 200);
  check(
    'no answer key or explanation before submitting',
    !KEY_FIELDS.test(JSON.stringify(topic.data?.questions ?? topic.data)),
  );

  const keys = harnessQuery(
    `select id, "correctIndex", jsonb_array_length(options::jsonb) from "GrammarQuestion" where "topicId" = 1 order by id`,
  ).map(([id, correct, n]) => ({
    id: Number(id),
    correct: Number(correct),
    n: Number(n),
  }));
  const answers: Record<string, number> = {};
  keys.forEach((k, i) => {
    answers[String(k.id)] = i === 0 ? k.correct : (k.correct + 1) % k.n;
  });
  const expected = Math.round((1 / keys.length) * 100);
  const first = await call('POST', '/grammar/topics/1/attempt', a.token, {
    answers,
  });
  check(
    'attempt accepted',
    first.status < 300,
    `(status ${first.status} ${JSON.stringify(first.message)})`,
  );
  check(
    'score is computed from the stored keys',
    first.data?.score === expected && first.data?.correctCount === 1,
    `(api ${first.data?.score}, expected ${expected})`,
  );
  check(
    // Owner reward policy: Grammar is not reward-eligible.
    'first completion is recorded and grants no reward',
    first.data?.isFirstCompletion === true && first.data?.rewardBanh === 0,
    `(banh ${first.data?.rewardBanh})`,
  );
  const second = await call('POST', '/grammar/topics/1/attempt', a.token, {
    answers,
  });
  check(
    'a second attempt grants no reward',
    second.data?.isFirstCompletion === false && second.data?.rewardBanh === 0,
    `(banh ${second.data?.rewardBanh})`,
  );
  const foreignKeys = await call('POST', '/grammar/topics/1/attempt', a.token, {
    answers: { 999999: 0 },
  });
  check(
    'answers for questions outside the topic score nothing',
    foreignKeys.data?.correctCount === 0,
  );
  const draftAttempt = await call(
    'POST',
    '/grammar/topics/2/attempt',
    a.token,
    { answers: {} },
  );
  check(
    'a DRAFT topic cannot be attempted',
    draftAttempt.status === 404,
    `(status ${draftAttempt.status})`,
  );
  const mine = await call('GET', '/grammar/my-attempts', a.token);
  const mineList: any[] = Array.isArray(mine.data)
    ? mine.data
    : (mine.data?.items ?? []);
  check(
    "attempt history lists this learner's attempts",
    mine.status === 200 && mineList.length >= 3,
    `(${mineList.length})`,
  );
}

async function vocab() {
  console.log('\n== Vocabulary / Flashcard');
  const a = await newStudent('vocab-a');
  const b = await newStudent('vocab-b');
  const topics = await call('GET', '/vocab/topics', a.token);
  const all: any[] = (topics.data?.categories ?? []).flatMap(
    (c: any) => c.topics,
  );
  check(
    'topic catalog loads',
    topics.status === 200 && all.length > 0,
    `(${all.length})`,
  );
  const free = all.find((t) => !t.isLocked);
  const locked = all.find((t) => t.isLocked);
  const detail = await call('GET', `/vocab/topics/${free.id}`, a.token);
  const words: any[] = detail.data?.words ?? detail.data?.items ?? [];
  check(
    'free topic opens with words',
    detail.status === 200 && words.length > 0,
    `(${words.length})`,
  );
  // Owner policy: Vocabulary/Flashcard is free, so no topic may be locked.
  check(
    'no vocabulary topic is locked for a free learner',
    !locked,
    locked ? `(topic ${locked.id})` : '',
  );
  const w = words[0];
  const master = await call('POST', `/vocab/words/${w.id}/master`, a.token, {
    isMastered: true,
  });
  check(
    'mark a word as learned',
    master.status < 300,
    `(status ${master.status})`,
  );
  const star = await call('POST', `/vocab/words/${w.id}/star`, a.token, {
    isStarred: true,
  });
  check('star a word', star.status < 300, `(status ${star.status})`);
  const after = await call('GET', '/vocab/topics', a.token);
  const t2 = (after.data?.categories ?? [])
    .flatMap((c: any) => c.topics)
    .find((t: any) => t.id === free.id);
  check(
    'topic progress reflects the learned word',
    t2?.learnedCount === 1,
    `(learned ${t2?.learnedCount})`,
  );
  const other = await call('GET', '/vocab/topics', b.token);
  const t3 = (other.data?.categories ?? [])
    .flatMap((c: any) => c.topics)
    .find((t: any) => t.id === free.id);
  check(
    "another learner's progress is separate",
    t3?.learnedCount === 0,
    `(learned ${t3?.learnedCount})`,
  );

  const saved = await call('POST', '/vocab/saved', a.token, {
    word: 'appointment',
    meaning: 'cuộc hẹn',
  });
  check(
    'save a word from lookup',
    saved.status < 300,
    `(status ${saved.status} ${JSON.stringify(saved.message)})`,
  );
  const savedId = saved.data?.id;
  if (savedId) {
    const steal = await call('DELETE', `/vocab/saved/${savedId}`, b.token);
    const stillThere = (
      await call('GET', '/vocab/saved', a.token)
    ).data?.some?.((s: any) => s.id === savedId);
    check(
      'another learner cannot delete it',
      steal.status >= 400 || stillThere === true,
      `(status ${steal.status}, kept ${stillThere})`,
    );
    const del = await call('DELETE', `/vocab/saved/${savedId}`, a.token);
    check('the owner can delete it', del.status < 300);
  }
}

async function main() {
  await grammar();
  await vocab();
  console.log(`\nGRAMMAR_VOCAB_API_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}
main().catch((e) => {
  console.error('ERROR', e);
  process.exit(2);
});
