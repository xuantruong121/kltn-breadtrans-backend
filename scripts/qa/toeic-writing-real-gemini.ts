/**
 * ONE real-Gemini TOEIC Writing section (8 tasks of assessment 1) on the
 * disposable harness started with HARNESS_REAL_GRADER=1. Eight grading
 * requests (one per task; key rotation on a provider error may add some,
 * which the provider-usage ledger records as a range). Some answers carry
 * a known flaw so grounding can be checked:
 *   Q2 omits the keyword "deliver"; Q6 confirms a time but suggests no room
 *   and asks no question; the others are sound.
 *
 * Usage: npx ts-node --transpile-only scripts/qa/toeic-writing-real-gemini.ts
 */
import { randomUUID } from 'node:crypto';

import { call, check, failureCount, newStudent } from './harness-api';

const ANSWERS = [
  'A woman is putting a folder on the shelf.',
  'A worker is carrying a large box to the truck.',
  'The customer is going to pay at the counter.',
  'Passengers are checking the schedule on the board.',
  'Several people park their bicycle near the station.',
  'Hi Linh, Friday at 2 p.m. is fine for me. See you then.',
  'Dear Mr Davis, I am sorry that the desk lamp was missing from your order. We will send a replacement today by express delivery. Could you confirm your phone number for the courier?',
  'I believe online courses can be as effective as classroom lessons for learning English. First, learners can study at their own pace and repeat lessons as often as they need. Second, many online courses include speaking practice with teachers through video calls, so students still communicate in real time. For example, my cousin improved her speaking a lot after six months of online lessons because she could practise every evening after work. However, classroom lessons give more chances to talk with classmates. In conclusion, online courses are effective when learners are disciplined and use the interactive tools they offer.',
];

async function main() {
  const s = await newStudent('toeic-gemini');
  const start = await call('POST', '/toeic/assessments/1/attempts', s.token, {
    idempotencyKey: randomUUID(),
  });
  const writing = start.data.components.find((c: any) => c.kind === 'WRITING');
  const base = `/toeic/assessments/attempts/${start.data.id}/components/${writing.assessmentComponentId}`;
  await call('POST', `${base}/start`, s.token);
  const q = `?parentAttemptId=${start.data.id}&parentComponentId=${writing.assessmentComponentId}`;
  let requests = 0;
  const results: any[] = [];
  for (const [i, quizId] of (writing.writingQuizIds as number[]).entries()) {
    requests += 1;
    const r = await call(
      'POST',
      `/writing/quizzes/${quizId}/submit${q}`,
      s.token,
      {
        answer: ANSWERS[i],
        clientAttemptId: randomUUID(),
      },
    );
    results.push(r.data);
    console.log(
      `Q${i + 1} ${r.status} ${r.data?.score}/${r.data?.maxScore} :: ${String(r.data?.feedback ?? JSON.stringify(r.data)).slice(0, 400)}`,
    );
    if (r.status >= 300) break;
  }
  check(
    'all 8 tasks graded by Gemini',
    results.length === 8 && results.every((r) => typeof r?.score === 'number'),
  );
  check(
    'Q2 (keyword "deliver" omitted) is below full marks',
    results[1]?.score < 3,
    String(results[1]?.score),
  );
  check(
    'Q6 (no room, no question) is below full marks',
    results[5]?.score < 4,
    String(results[5]?.score),
  );
  const done = await call('POST', `${base}/complete`, s.token, {});
  check(
    'Writing completes after 8 real grades',
    done.status < 300,
    String(done.status),
  );
  console.log(`grading requests sent by this script: ${requests}`);
  console.log(
    `\n${failureCount() ? 'FAILURES: ' + failureCount() : 'ALL PASS'}`,
  );
  process.exit(failureCount() ? 1 : 0);
}

void main();
