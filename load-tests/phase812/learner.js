import http from 'k6/http';
import crypto from 'k6/crypto';
import encoding from 'k6/encoding';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const baseUrl = __ENV.LOAD_BASE_URL || 'http://host.docker.internal:3101';
const examId = __ENV.EXAM_ID || '1';
const password = __ENV.LOAD_PASSWORD || 'Phase812-load-password!';
const vuCount = Number(__ENV.VUS || 1);
const iterations = Number(__ENV.ITERATIONS || 1);
const thinkTime = Number(__ENV.THINK_TIME || 0.25);
const authMode = __ENV.AUTH_MODE || 'login';
const jwtSecret = __ENV.LOAD_JWT_SECRET || 'phase812-isolated-jwt-secret';
const userOffset = Number(__ENV.USER_OFFSET || 0);
const rampSeconds = Number(__ENV.RAMP_SECONDS || 0);
const steadySeconds = Number(__ENV.STEADY_SECONDS || 0);

const endpointNames = [
  'auth_profile',
  'auth_login',
  'exam_list',
  'exam_briefing',
  'attempt_start',
  'attempt_begin',
  'attempt_detail',
  'save_answers',
  'save_navigation',
  'remaining_time',
  'submit',
  'result',
  'history',
];
const endpointLatency = Object.fromEntries(
  endpointNames.map((name) => [name, new Trend(`latency_${name}`, true)]),
);
const endpointRequests = Object.fromEntries(
  endpointNames.map((name) => [name, new Counter(`requests_${name}`)]),
);
const endpointStatus = new Counter('endpoint_status_total');
const endpointNetworkErrors = new Counter('endpoint_network_errors');
const statusBuckets = [
  '2xx',
  '400',
  '401',
  '403',
  '404',
  '409',
  '429',
  '5xx',
  'other',
  'timeout',
  'connection_refused',
  'network_error',
];
const endpointStatusCounters = Object.fromEntries(
  endpointNames.map((endpoint) => [
    endpoint,
    Object.fromEntries(
      statusBuckets.map((bucket) => [
        bucket,
        new Counter(`status_${endpoint}_${bucket}`),
      ]),
    ),
  ]),
);

export const options = rampSeconds
  ? {
      scenarios: {
        learner: {
          executor: 'ramping-vus',
          startVUs: 0,
          stages: [
            { duration: `${rampSeconds}s`, target: vuCount },
            { duration: `${steadySeconds || rampSeconds}s`, target: vuCount },
          ],
          gracefulRampDown: '30s',
        },
      },
      thresholds: { http_req_failed: ['rate<0.05'] },
    }
  : {
      vus: vuCount,
      iterations,
      thresholds: { http_req_failed: ['rate<0.05'] },
    };

function request(method, path, token, body, name) {
  const params = {
    tags: { endpoint: name },
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
  const response = method === 'GET'
    ? http.get(`${baseUrl}${path}`, params)
    : http.request(method, `${baseUrl}${path}`, body ? JSON.stringify(body) : null, params);
  const rawError = String(response.error || '').toLowerCase();
  const status = response.status === 0 ? 'network_error' : String(response.status);
  const bucket =
    response.status === 0
      ? rawError.includes('timeout')
        ? 'timeout'
        : rawError.includes('refused')
          ? 'connection_refused'
          : 'network_error'
      : response.status >= 200 && response.status < 300
        ? '2xx'
        : response.status >= 500
          ? '5xx'
          : statusBuckets.includes(String(response.status))
            ? String(response.status)
            : 'other';
  endpointRequests[name]?.add(1);
  endpointLatency[name]?.add(response.timings.duration);
  endpointStatus.add(1, { endpoint: name, status });
  endpointStatusCounters[name]?.[bucket]?.add(1);
  if (status === 'network_error') endpointNetworkErrors.add(1, { endpoint: name });
  return response;
}

function payload(response) {
  try {
    const json = response.json();
    return json?.data ?? json;
  } catch {
    return null;
  }
}

function must(response, name, expected = 200) {
  return check(response, {
    [`${name} status ${expected}`]: (r) => r.status === expected,
  });
}

function syntheticAccessToken(userNumber) {
  const header = encoding.b64encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }), 'rawurl');
  const now = Math.floor(Date.now() / 1000);
  const body = encoding.b64encode(
    JSON.stringify({
      sub: userNumber,
      email: `qa-phase812-load-${String(userNumber).padStart(4, '0')}@example.invalid`,
      role: 'STUDENT',
      deviceId: `phase812-preauth-${userNumber}`,
      type: 'access',
      jti: `phase812-${userNumber}`,
      iat: now,
      exp: now + 86400,
    }),
    'rawurl',
  );
  const signature = crypto.hmac('sha256', jwtSecret, `${header}.${body}`, 'base64rawurl');
  return `${header}.${body}.${signature}`;
}

export default function () {
  const userNumber = userOffset + (((__VU - 1) % 1000) + 1);
  const email = `qa-phase812-load-${String(userNumber).padStart(4, '0')}@example.invalid`;

  let token;
  if (authMode === 'preauth') {
    token = syntheticAccessToken(userNumber);
    const profile = request('GET', '/auth/profile', token, null, 'auth_profile');
    if (!must(profile, 'auth_profile')) return;
  } else {
    const login = request(
      'POST',
      '/auth/login',
      null,
      { email, password, deviceId: `phase812-vu-${userNumber}` },
      'auth_login',
    );
    if (!must(login, 'auth_login')) return;
    const loginData = payload(login);
    token = loginData?.access_token;
    if (!token) return;
  }

  sleep(thinkTime);

  const exams = request('GET', '/toeic/exams', token, null, 'exam_list');
  if (!must(exams, 'exam_list')) return;

  const briefing = request(
    'GET',
    `/toeic/exams/${examId}/briefing`,
    token,
    null,
    'exam_briefing',
  );
  if (!must(briefing, 'exam_briefing')) return;

  sleep(thinkTime * 2);

  const started = request(
    'POST',
    `/toeic/exams/${examId}/attempts`,
    token,
    { mode: 'PRACTICE' },
    'attempt_start',
  );
  if (!must(started, 'attempt_start', 201)) return;
  const attempt = payload(started);
  const attemptId = attempt?.id;
  if (!attemptId) return;

  const begun = request(
    'POST',
    `/toeic/attempts/${attemptId}/begin`,
    token,
    null,
    'attempt_begin',
  );
  if (!must(begun, 'attempt_begin', 201)) return;

  const detail = request(
    'GET',
    `/toeic/attempts/${attemptId}`,
    token,
    null,
    'attempt_detail',
  );
  if (!must(detail, 'attempt_detail')) return;
  const detailData = payload(detail);
  const questions = detailData?.exam?.groups?.flatMap((group) => group.questions ?? []) ?? [];
  const firstQuestion = questions[0];
  if (!firstQuestion) return;

  const answers = {};
  questions.slice(0, 3).forEach((question) => {
    answers[String(question.id)] = 0;
  });
  const saveBody = {
    answers,
    markedQuestionIds: [firstQuestion.id],
    currentQuestionId: firstQuestion.id,
  };

  sleep(thinkTime);

  const saved = request(
    'PATCH',
    `/toeic/attempts/${attemptId}/answers`,
    token,
    saveBody,
    'save_answers',
  );
  if (!must(saved, 'save_answers')) return;

  const navigation = request(
    'PATCH',
    `/toeic/attempts/${attemptId}/answers`,
    token,
    { answers: {}, currentQuestionId: firstQuestion.id },
    'save_navigation',
  );
  if (!must(navigation, 'save_navigation')) return;

  const remaining = request(
    'GET',
    `/toeic/attempts/${attemptId}/remaining-time`,
    token,
    null,
    'remaining_time',
  );
  if (!must(remaining, 'remaining_time')) return;

  const submitted = request(
    'POST',
    `/toeic/attempts/${attemptId}/submit`,
    token,
    null,
    'submit',
  );
  if (!must(submitted, 'submit', 201)) return;

  const result = request(
    'GET',
    `/toeic/attempts/${attemptId}/result`,
    token,
    null,
    'result',
  );
  must(result, 'result');

  const history = request('GET', '/toeic/history', token, null, 'history');
  must(history, 'history');
}
