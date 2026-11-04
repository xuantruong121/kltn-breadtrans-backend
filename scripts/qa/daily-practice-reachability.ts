/**
 * Every learner account on the harness clone:
 * today's daily practice plan,
 * and every item in it opens (its detail API answers 200) and is practice
 * that counts (reward-eligibility.ts). Harness :3101 only; tokens are minted
 * with the harness JWT secret, which only the harness backend accepts.
 *
 * Usage: HARNESS_DB=<db> npx ts-node --transpile-only scripts/qa/daily-practice-reachability.ts
 */
import { randomUUID } from 'node:crypto';
import { sign } from 'jsonwebtoken';

import { isRewardableQuiz } from '../../src/modules/gamification/reward-eligibility';
import { call, check, failureCount } from './harness-api';
import { harnessQuery } from './harness-db';

const SECRET = 'harness-only-jwt-secret';

const DETAIL: Record<string, (id: number) => string> = {
  LISTENING: (id) => `/quizzes/${id}`,
  READING: (id) => `/quizzes/${id}`,
  WRITING: (id) => `/writing/quizzes/${id}`,
  SPEAKING: (id) => `/speaking/exercises/${id}`,
};
const PAGE: Record<string, RegExp> = {
  LISTENING: /^\/listening\/\d+$/,
  READING: /^\/reading\/\d+$/,
  WRITING: /^\/writing\/\d+$/,
  SPEAKING: /^\/speaking\/\d+$/,
};

function counts(skill: string, id: number) {
  if (skill === 'SPEAKING') {
    const [row] = harnessQuery(
      `select e."publicationStatus", coalesce(s.scope::text, '') from "SpeakingExercise" e left join "SpeakingPracticeSet" s on s.id = e."practiceSetId" where e.id = ${id}`,
    );
    return row?.[0] === 'PUBLISHED' && row?.[1] !== 'EXAM_INTERNAL';
  }
  const [row] = harnessQuery(
    `select z.type, coalesce(z."practiceTopicId"::text, ''), exists (select 1 from "ToeicWritingSetItem" i where i."writingQuizId" = z.id) from "Quiz" z where z.id = ${id}`,
  );
  return Boolean(
    row &&
    isRewardableQuiz({
      type: row[0],
      practiceTopicId: row[1] ? Number(row[1]) : null,
      inToeicWritingSet: row[2] === 't',
    }),
  );
}

async function main() {
  const learners = harnessQuery(
    `select id, email, role from "User" where role = 'STUDENT' and coalesce("mustChangePassword", false) = false order by id`,
  );
  let items = 0;
  const failures: string[] = [];
  for (const [id, email, role] of learners) {
    const token = sign(
      {
        sub: Number(id),
        email,
        role,
        deviceId: 'harness-reachability',
        type: 'access',
        jti: randomUUID(),
      },
      SECRET,
      { expiresIn: '1h' },
    );
    const plan = await call('GET', '/users/me/daily-practice', token);
    if (plan.status !== 200) {
      failures.push(`user ${id}: plan ${plan.status}`);
      continue;
    }
    for (const item of plan.data?.items ?? []) {
      if (item.isLocked) continue;
      items += 1;
      const where = `user ${id} ${item.skill} ${item.route}`;
      if (!PAGE[item.skill]?.test(item.route))
        failures.push(`${where}: not a learner page`);
      const detail = await call(
        'GET',
        DETAIL[item.skill](item.exerciseId),
        token,
      );
      if (detail.status !== 200)
        failures.push(
          `${where}: detail ${detail.status} ${JSON.stringify(detail.message).slice(0, 80)}`,
        );
      if (!counts(item.skill, item.exerciseId))
        failures.push(`${where}: not practice that counts`);
    }
  }
  check(
    `every planned item of ${learners.length} learners opens and counts`,
    failures.length === 0 && items > 0,
    `${items} items; ${failures.slice(0, 12).join(' | ')}`,
  );
  console.log(`failures: ${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

void main();
