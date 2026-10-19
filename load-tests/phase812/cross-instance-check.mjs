import crypto from 'node:crypto';

const baseUrl = process.env.LOAD_BASE_URL ?? 'http://localhost:3100';
const examId = Number(process.env.EXAM_ID ?? 1);
const userId = Number(process.env.USER_ID ?? 1);
const jwtSecret = process.env.LOAD_JWT_SECRET ?? 'phase8122-isolated-jwt-secret';

function base64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function tokenForUser(id) {
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64Url(
    JSON.stringify({
      sub: id,
      email: `qa-phase812-load-${String(id).padStart(4, '0')}@example.invalid`,
      role: 'STUDENT',
      deviceId: `phase8122-cross-instance-${id}`,
      type: 'access',
      jti: `phase8122-${id}`,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 86400,
    }),
  );
  const signature = crypto
    .createHmac('sha256', jwtSecret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

const token = tokenForUser(userId);

async function request(method, path, body, requestToken = token) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${requestToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return {
    status: response.status,
    upstream: response.headers.get('x-phase8122-upstream') ?? '',
    data: data?.data ?? data,
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function nodeOf(upstream) {
  if (upstream.includes(':3101')) return 'A';
  if (upstream.includes(':3102')) return 'B';
  return 'UNKNOWN';
}

function sameAttempt(first, second) {
  return first?.data?.id && first.data.id === second?.data?.id;
}

const evidence = { traffic: [], checks: {} };
const profileA = await request('GET', '/auth/profile');
const profileB = await request('GET', '/auth/profile');
evidence.traffic.push(nodeOf(profileA.upstream), nodeOf(profileB.upstream));
assert(profileA.status === 200 && profileB.status === 200, 'cross-instance auth failed');
assert(profileA.data?.id === userId && profileB.data?.id === userId, 'user identity changed');
assert(new Set(evidence.traffic).size === 2, 'auth requests did not cross instances');
evidence.checks.auth = { status: 'PASS', nodes: evidence.traffic };

const started = await request('POST', `/toeic/exams/${examId}/attempts`, { mode: 'PRACTICE' });
assert(started.status === 201, `attempt start failed: ${started.status}`);
const attemptId = started.data?.id;
assert(attemptId, 'attempt id missing');
const begun = await request('POST', `/toeic/attempts/${attemptId}/begin`);
assert(begun.status === 201, `attempt begin failed: ${begun.status}`);
const detail = await request('GET', `/toeic/attempts/${attemptId}`);
assert(detail.status === 200, `attempt detail failed: ${detail.status}`);
assert(detail.data?.id === attemptId && detail.data?.userId === userId, 'attempt identity changed');
evidence.traffic.push(nodeOf(started.upstream), nodeOf(begun.upstream), nodeOf(detail.upstream));
assert(new Set(evidence.traffic).size === 2, 'attempt did not cross instances');
evidence.checks.resume = { status: 'PASS', attemptId, nodes: evidence.traffic.slice(-3) };

const firstQuestion = detail.data?.exam?.groups?.[0]?.questions?.[0];
assert(firstQuestion?.id, 'question missing');
const saved = await request('PATCH', `/toeic/attempts/${attemptId}/answers`, {
  answers: { [String(firstQuestion.id)]: 0 },
  markedQuestionIds: [firstQuestion.id],
  currentQuestionId: firstQuestion.id,
});
const readAfterSave = await request('GET', `/toeic/attempts/${attemptId}`);
assert(saved.status === 200 && readAfterSave.status === 200, 'answer persistence request failed');
assert(readAfterSave.data?.answers?.some((answer) => answer.questionId === firstQuestion.id && answer.selectedIndex === 0), 'answer was not durable');
assert(readAfterSave.data?.currentQuestionId === firstQuestion.id, 'navigation was not durable');
evidence.checks.answerAndNavigation = {
  status: 'PASS',
  saveNode: nodeOf(saved.upstream),
  readNode: nodeOf(readAfterSave.upstream),
};

const startRace = await Promise.all([
  request('POST', `/toeic/exams/${examId}/attempts`, { mode: 'PRACTICE' }, tokenForUser(userId + 1)),
  request('POST', `/toeic/exams/${examId}/attempts`, { mode: 'PRACTICE' }, tokenForUser(userId + 1)),
]);
assert(startRace.every((result) => [201, 409].includes(result.status)), 'unexpected start race status');
const raceIds = startRace.map((result) => result.data?.id).filter(Boolean);
assert(raceIds.length > 0 && new Set(raceIds).size === 1, 'start race returned duplicate attempts');
evidence.checks.startRace = { status: 'PASS', statuses: startRace.map((result) => result.status), ids: raceIds, nodes: startRace.map((result) => nodeOf(result.upstream)) };

const submitRaceToken = tokenForUser(userId + 2);
const submitRaceAttempt = await request('POST', `/toeic/exams/${examId}/attempts`, { mode: 'PRACTICE' }, submitRaceToken);
assert(submitRaceAttempt.status === 201, 'submit race attempt start failed');
const submitAttemptId = submitRaceAttempt.data?.id;
assert(submitAttemptId, 'submit race attempt id missing');
const submitBegin = await request('POST', `/toeic/attempts/${submitAttemptId}/begin`, undefined, submitRaceToken);
assert(submitBegin.status === 201, 'submit race attempt begin failed');
const submitRace = await Promise.all([
  request('POST', `/toeic/attempts/${submitAttemptId}/submit`, undefined, submitRaceToken),
  request('POST', `/toeic/attempts/${submitAttemptId}/submit`, undefined, submitRaceToken),
]);
assert(submitRace.every((result) => [201, 409].includes(result.status)), 'unexpected submit race status');
const submitResult = await request('GET', `/toeic/attempts/${submitAttemptId}/result`, undefined, submitRaceToken);
assert(submitResult.status === 200, 'submit result was not readable');
evidence.checks.submitRace = {
  status: 'PASS',
  statuses: submitRace.map((result) => result.status),
  nodes: submitRace.map((result) => nodeOf(result.upstream)),
  resultStatus: submitResult.status,
};

console.log(JSON.stringify({ attemptId, submitAttemptId, ...evidence }));
