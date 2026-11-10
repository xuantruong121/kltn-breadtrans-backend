// CPU cost of each learner endpoint on the capacity API, measured from the
// container's cgroup (cpu.stat usage_usec) around a batch of requests, with
// nothing else running. Prints CPU ms per request and the share of the
// scenario's CPU each endpoint accounts for, given how often k6 called it.
//   node bench-endpoints.mjs [batch=40] [summary=out/<run>/summary.json]
import { createHmac } from 'node:crypto';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:3201';
const N = Number(process.argv[2] ?? 40);
const counts = process.argv[3]
  ? JSON.parse(readFileSync(process.argv[3], 'utf8')).metrics
  : null;
const data = JSON.parse(
  readFileSync(new URL('./out/capacity-data.json', import.meta.url), 'utf8'),
);
const API = execSync('docker ps --format "{{.Names}}"')
  .toString()
  .split('\n')
  .find((n) => n.includes('breadtrans-capacity-api-1'));
const cpuUsec = () =>
  Number(
    /usage_usec (\d+)/.exec(
      execSync(`docker exec ${API} cat /sys/fs/cgroup/cpu.stat`).toString(),
    )[1],
  );

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (u) => {
  const now = Math.floor(Date.now() / 1000);
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const p = b64({
    sub: u.id,
    email: u.email,
    role: 'STUDENT',
    deviceId: `bench-${u.id}`,
    type: 'access',
    jti: `bench-${u.id}`,
    iat: now,
    exp: now + 3600,
  });
  return `${h}.${p}.${createHmac('sha256', 'capacity-isolated-jwt-secret').update(`${h}.${p}`).digest('base64url')}`;
};
const users = data.users.slice(900, 1000);
const call = async (method, path, tok, body) => {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${tok}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const buf = Buffer.from(await r.arrayBuffer());
  let json = null;
  try {
    json = JSON.parse(buf.toString());
    json = json?.data ?? json;
  } catch {}
  return { status: r.status, json, bytes: buf.length };
};

// Fixtures the parameterised endpoints need.
const t0 = token(users[0]);
const reading = (await call('GET', '/reading/exercises', t0)).json.filter(
  (x) => !x.isLocked && !x.isLevelLocked,
)[0].quizId;
const listening = (
  await call('GET', '/quizzes/listening-practice', t0)
).json.filter(
  (x) =>
    !x.isLocked && !x.isLevelLocked && data.listeningQuizIds.includes(x.id),
);
const clipQuiz =
  listening.find((x) => x.mode !== 'DIALOGUE')?.id ?? listening[0].id;
const trackQuiz = listening.find((x) => x.mode === 'DIALOGUE')?.id;
const qOf = async (id) =>
  (await call('GET', `/quizzes/${id}`, t0)).json.questions;
const readingQs = await qOf(reading);
const clipQ = (await qOf(clipQuiz))[0].id;
const trackQ = trackQuiz ? (await qOf(trackQuiz))[0].id : null;
const topic = (await call('GET', '/vocab/topics', t0)).json.topics.find(
  (t) => !t.isLocked,
).id;
const word = (await call('GET', `/vocab/topics/${topic}`, t0)).json.words[0].id;
const exam = data.examId;
// One open listening attempt and one TOEIC attempt per bench learner.
const attempts = new Map();
for (const u of users) {
  const t = token(u);
  const la = (await call('POST', `/quizzes/${clipQuiz}/listening-attempts`, t))
    .json;
  const ea = (
    await call('POST', `/toeic/exams/${exam}/attempts`, t, { mode: 'PRACTICE' })
  ).json;
  if (ea?.id) await call('POST', `/toeic/attempts/${ea.id}/begin`, t);
  attempts.set(u.id, { listening: la?.id, exam: ea?.id });
}
const examQ = (
  await call('GET', `/toeic/attempts/${attempts.get(users[0].id).exam}`, t0)
).json.exam.groups.flatMap((g) => g.questions)[0].id;

const cases = [
  ['profile', 'GET', () => '/auth/profile'],
  ['today', 'GET', () => '/gamification/dashboard/today'],
  ['balance', 'GET', () => '/market/currency/balance'],
  ['pet', 'GET', () => '/gamification/pet'],
  ['ranking', 'GET', () => '/gamification/ranking'],
  ['reading_list', 'GET', () => '/reading/exercises'],
  ['listening_list', 'GET', () => '/quizzes/listening-practice'],
  ['quiz_detail', 'GET', () => `/quizzes/${reading}`],
  [
    'quiz_submit',
    'POST',
    () => `/quizzes/${reading}/submit`,
    () => ({
      answers: readingQs.map((q) => ({
        questionId: q.id,
        answer: String(q.content.options[0]),
      })),
    }),
  ],
  [
    'audio_url (clip)',
    'GET',
    () => `/quizzes/${clipQuiz}/questions/${clipQ}/audio-url`,
  ],
  ...(trackQ
    ? [
        [
          'audio_url (dialogue track)',
          'GET',
          () => `/quizzes/${trackQuiz}/questions/${trackQ}/audio-url`,
        ],
      ]
    : []),
  ['vocab_topics', 'GET', () => '/vocab/topics'],
  ['vocab_topic', 'GET', () => `/vocab/topics/${topic}`],
  [
    'vocab_review',
    'POST',
    () => `/vocab/words/${word}/review`,
    () => ({ isCorrect: true }),
  ],
  [
    'listening_save',
    'PATCH',
    (u) =>
      `/quizzes/${clipQuiz}/listening-attempts/${attempts.get(u.id).listening}`,
    () => ({ currentQuestionId: clipQ, answers: { [clipQ]: 'x' } }),
  ],
  [
    'exam_answers',
    'PATCH',
    (u) => `/toeic/attempts/${attempts.get(u.id).exam}/answers`,
    () => ({ answers: { [examQ]: 0 }, currentQuestionId: examQ }),
  ],
  ['exam_list', 'GET', () => '/toeic/exams'],
  ['exam_briefing', 'GET', () => `/toeic/exams/${exam}/briefing`],
];

console.log(
  `| endpoint | CPU ms / request | wall ms (4 at once) | bytes |${counts ? ' calls in run | share of CPU |' : ''}`,
);
console.log(`|---|---:|---:|---:|${counts ? '---:|---:|' : ''}`);
const rows = [];
for (const [name, method, path, body] of cases) {
  await call(method, path(users[0]), t0, body?.()); // warm
  const before = cpuUsec();
  const start = Date.now();
  let bytes = 0;
  let bad = 0;
  for (let i = 0; i < N; i += 4) {
    const batch = await Promise.all(
      [0, 1, 2, 3].map((k) => {
        const u = users[(i + k) % users.length];
        return call(method, path(u), token(u), body?.());
      }),
    );
    for (const r of batch) {
      bytes = r.bytes;
      if (r.status >= 300) bad += 1;
    }
  }
  const cpu = (cpuUsec() - before) / 1000 / N;
  const key = name.split(' ')[0];
  rows.push({
    name,
    key,
    cpu,
    wall: (Date.now() - start) / (N / 4),
    bytes,
    bad,
  });
}
const calls = (k) => counts?.[`latency_${k}`]?.count ?? 0;
const totalCpu = rows.reduce(
  (s, r) => s + (r.name.includes('dialogue track') ? 0 : r.cpu * calls(r.key)),
  0,
);
for (const r of rows) {
  const share =
    counts && !r.name.includes('dialogue track')
      ? `${calls(r.key)} | ${((r.cpu * calls(r.key) * 100) / totalCpu).toFixed(1)}% |`
      : counts
        ? ' | |'
        : '';
  console.log(
    `| ${r.name}${r.bad ? ` (${r.bad} errors)` : ''} | ${r.cpu.toFixed(1)} | ${r.wall.toFixed(0)} | ${r.bytes} |${counts ? ` ${share}` : ''}`,
  );
}
