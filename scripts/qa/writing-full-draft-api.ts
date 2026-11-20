/**
 * Writing AI full draft over HTTP on the disposable harness only (:3101),
 * owner 2026-11-19/20. The harness AI is the deterministic provider in
 * writing-deterministic-server.ts: its last task is broken on purpose.
 * - email and translation drafts return checked tasks and drop the bad one;
 * - a picture draft, a missing topic and a learner are refused.
 */
import { call, check, failureCount, newAdmin, newStudent } from './harness-api';

async function main() {
  console.log('\n== Writing AI full draft');
  const admin = await newAdmin('wdraft');
  const learner = await newStudent('wdraft-learner');
  const draft = (token: string, body: object) =>
    call('POST', '/admin/writing/ai/full-draft', token, body);

  const email = await draft(admin.token, {
    topic: 'Văn phòng',
    level: 'B1',
    kind: 'EMAIL',
    count: 3,
  });
  const emailTasks = (email.data?.tasks ?? []) as Array<{ taskType: string }>;
  check(
    'an email draft answers',
    email.status < 300,
    `(status ${email.status})`,
  );
  check(
    'it keeps the valid email tasks and drops the essay',
    emailTasks.length === 2 &&
      emailTasks.every((t) => t.taskType === 'REQUEST') &&
      email.data?.dropped === 1,
    `(${emailTasks.length} tasks, dropped ${email.data?.dropped})`,
  );

  const translation = await draft(admin.token, {
    topic: 'Đồ vật',
    level: 'A2',
    kind: 'TRANSLATION',
    count: 4,
  });
  const translationTasks = (translation.data?.tasks ?? []) as Array<{
    taskType: string;
    acceptedAnswers: string[];
  }>;
  check(
    'a translation draft keeps sentences with 2+ answers and drops the one without diacritics',
    translationTasks.length === 3 &&
      translationTasks.every(
        (t) =>
          t.taskType === 'SENTENCE_TRANSLATION' &&
          t.acceptedAnswers.length >= 2,
      ) &&
      translation.data?.dropped === 1,
    `(${translationTasks.length} tasks, dropped ${translation.data?.dropped})`,
  );

  const picture = await draft(admin.token, {
    topic: 'Ảnh',
    level: 'A2',
    kind: 'PICTURE',
  });
  check(
    'a picture draft is refused',
    picture.status === 400,
    `(status ${picture.status})`,
  );
  const noTopic = await draft(admin.token, { level: 'A2', kind: 'EMAIL' });
  check(
    'a missing topic is refused',
    noTopic.status === 400,
    `(status ${noTopic.status})`,
  );
  const asLearner = await draft(learner.token, {
    topic: 'x',
    level: 'A2',
    kind: 'EMAIL',
  });
  check(
    'a learner is refused',
    asLearner.status === 403,
    `(status ${asLearner.status})`,
  );

  console.log(`\nwriting-full-draft failures: ${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

void main();
