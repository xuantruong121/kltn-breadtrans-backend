/**
 * Checkpoint 58 owner-authorized live grading check: five picture-writing
 * answers graded by the REAL Gemini adapter through the normal API on the
 * harness (server: writing-live-budget-server.ts, budget 5). One synthetic PRO
 * learner, one task per case, so no case overwrites another. It prints each
 * graded result for review; it does not assert exact grades.
 * Usage: npx ts-node --transpile-only scripts/qa/cp58-picture-live-gemini.ts <out.json> [G|H]
 *   G: the first five cases (CP58). H: the three CP58-H rechecks (server budget 3).
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

import { call, newProStudent } from './harness-api';
import { harnessQuery } from './harness-db';

const out = process.argv[2];
const set = process.argv[3] === 'H' ? 'H' : 'G';
const quizId = (title: string) =>
  Number(
    harnessQuery(
      `select id from "Quiz" where title = '${title}' and "publicationStatus" = 'PUBLISHED'`,
    )[0]?.[0],
  );
const A2 = quizId('Viết câu theo tranh: đời sống và dịch vụ (A2)');
const B1 = quizId('Viết câu theo tranh: nơi làm việc (B1)');
const tasks = (quiz: number) =>
  harnessQuery(
    `select id, content->>'requiredKeywords' from "Question" where "quizId" = ${quiz} order by "order", id`,
  );

const CASES = [
  {
    id: 'G1',
    category: 'valid A2 (grocery-checkout: cashier / scan)',
    quiz: A2,
    task: 0,
    answer:
      'The cashier is scanning a jar of sauce while a woman pays by card.',
  },
  {
    id: 'G2',
    category: 'valid B1 (office-meeting: presentation / chart)',
    quiz: B1,
    task: 0,
    answer:
      'While a manager points at a chart during his presentation, two colleagues at the table take notes.',
  },
  {
    id: 'G3',
    category:
      'invalid B1 structure: two short sentences, no connector (folders-cabinet: file / shelf)',
    quiz: B1,
    task: 1,
    answer: 'A woman puts a file on the shelf. The shelf has many folders.',
  },
  {
    id: 'G4',
    category:
      'off-topic but grammatical, cue words + connector (construction-plan: plan / site)',
    quiz: B1,
    task: 2,
    answer:
      'Two children are drawing a plan for a sandcastle at the beach site because they want to win a prize.',
  },
  {
    id: 'G5',
    category:
      'relevant with clear grammar errors (ceiling-light: ladder / replace)',
    quiz: B1,
    task: 3,
    answer:
      'A worker stand on a yellow ladder because he want to replaced the ceiling light.',
  },
];

/** CP58-H rechecks after the scene-relevance fix (owner allowance: 3 calls). */
const H_CASES = [
  {
    id: 'H1',
    category: 'G4 again: off-topic, cue words + connector (construction-plan)',
    quiz: B1,
    task: 2,
    answer:
      'Two children are drawing a plan for a sandcastle at the beach site because they want to win a prize.',
  },
  {
    id: 'H2',
    category: 'valid B1 in new wording (bicycle-rack: bicycle / entrance)',
    quiz: B1,
    task: 4,
    answer:
      'Next to the entrance of the glass office building, a row of bicycles stands in a metal rack where staff can leave them during the day.',
  },
  {
    id: 'H3',
    category:
      'two correct sentences, no connector (ceiling-light: ladder / replace)',
    quiz: B1,
    task: 3,
    answer: 'A man is standing on a ladder. He is going to replace the light.',
  },
];

void (async () => {
  if (!(A2 > 0 && B1 > 0)) throw new Error('picture exercises not found');
  const learner = await newProStudent('cp58-live');
  const results: unknown[] = [];
  for (const c of set === 'H' ? H_CASES : CASES) {
    const [questionId, keywords] = tasks(c.quiz)[c.task];
    const res = await call(
      'POST',
      `/writing/quizzes/${c.quiz}/submit`,
      learner.token,
      {
        answer: c.answer,
        questionId: Number(questionId),
        clientAttemptId: randomUUID(),
      },
    );
    const entry = {
      ...c,
      questionId: Number(questionId),
      keywords,
      status: res.status,
      result: res.data ?? res,
    };
    results.push(entry);
    console.log(`\n### ${c.id} ${c.category} → HTTP ${res.status}`);
    console.log(JSON.stringify(res.data ?? res, null, 1).slice(0, 2500));
  }
  writeFileSync(
    out,
    JSON.stringify(
      {
        learner: {
          email: learner.email,
          password: learner.password,
          userId: learner.userId,
        },
        A2,
        B1,
        results,
      },
      null,
      2,
    ),
  );
})();
