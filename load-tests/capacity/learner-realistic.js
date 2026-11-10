/**
 * 1000 learners online at a real pace (owner 2026-11-09). Each virtual learner
 * runs study sessions: a dashboard, then one activity. Moving around takes 3-8 s;
 * a question takes 15-40 s (hearing the clip or reading the passage, then
 * answering); a vocabulary card 4-10 s.
 *
 *   40% skill practice (half reading, half listening with its audio clips)
 *   25% a TOEIC exam: start, the Listening master audio, answers, submit, result
 *   20% dashboard, pet and profile
 *   15% vocabulary review
 *
 * MODE=ramp  (default) 0 -> 250 -> 500 -> 750 -> 1000, STEP_SECONDS each, then
 *            HOLD_SECONDS at 1000. Thresholds: errors < 1%, p95 < 1 s.
 * MODE=spike every learner prepares a submission, then all submit within 30 s.
 *
 * Writing (Gemini) and Speaking (Azure) grading are left out: they are bound by
 * the providers' quotas, not by the VPS.
 *
 * Env: BASE_URL, JWT_SECRET, DATA (path to out/capacity-data.json),
 *      STEP_SECONDS (180), HOLD_SECONDS (600), MAX_VUS (1000), LOGIN_SHARE (0.05).
 * Never point this at production, kltn_db or the owner's :3001.
 */
import http from 'k6/http';
import crypto from 'k6/crypto';
import encoding from 'k6/encoding';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Counter, Trend } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://host.docker.internal:3201';
const SECRET = __ENV.JWT_SECRET || 'capacity-isolated-jwt-secret';
const MODE = __ENV.MODE || 'ramp';
const STEP = Number(__ENV.STEP_SECONDS || 180);
const HOLD = Number(__ENV.HOLD_SECONDS || 600);
const MAX_VUS = Number(__ENV.MAX_VUS || 1000);
const LOGIN_SHARE = Number(__ENV.LOGIN_SHARE || 0.05);
// Object storage (R2 in production, the harness fake bucket here): not the VPS.
const STORAGE = __ENV.STORAGE_URL || 'http://host.docker.internal:9460';
const AUDIO_MODE = __ENV.AUDIO_MODE || 'url';

const data = new SharedArray('capacity', () => [
  JSON.parse(open(__ENV.DATA || './out/capacity-data.json')),
])[0];

const ENDPOINTS = [
  'login',
  'profile',
  'today',
  'balance',
  'pet',
  'ranking',
  'reading_list',
  'listening_list',
  'quiz_detail',
  'listening_attempt',
  'listening_save',
  'audio_url',
  'audio_storage',
  'audio_stream',
  'quiz_submit',
  'exam_list',
  'exam_briefing',
  'exam_start',
  'exam_begin',
  'exam_detail',
  'exam_master',
  'exam_audio',
  'exam_audio_storage',
  'exam_answers',
  'exam_submit',
  'exam_result',
  'vocab_topics',
  'vocab_topic',
  'vocab_review',
];
const latency = Object.fromEntries(
  ENDPOINTS.map((n) => [n, new Trend(`latency_${n}`, true)]),
);
const bytes = Object.fromEntries(
  ENDPOINTS.map((n) => [n, new Counter(`bytes_${n}`)]),
);
const errors = Object.fromEntries(
  ENDPOINTS.map((n) => [n, new Counter(`errors_${n}`)]),
);
const status5xx = new Counter('status_5xx');

export const options =
  MODE === 'spike'
    ? {
        scenarios: {
          spike: {
            executor: 'per-vu-iterations',
            vus: MAX_VUS,
            iterations: 1,
            maxDuration: '10m',
          },
        },
        thresholds: {
          http_req_failed: ['rate<0.01'],
          latency_quiz_submit: ['p(95)<1000'],
          latency_exam_submit: ['p(95)<1000'],
        },
        summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
      }
    : {
        scenarios: {
          learners: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
              { duration: `${STEP}s`, target: Math.round(MAX_VUS * 0.25) },
              { duration: `${STEP}s`, target: Math.round(MAX_VUS * 0.5) },
              { duration: `${STEP}s`, target: Math.round(MAX_VUS * 0.75) },
              { duration: `${STEP}s`, target: MAX_VUS },
              { duration: `${HOLD}s`, target: MAX_VUS },
              { duration: '60s', target: 0 },
            ],
            gracefulRampDown: '30s',
          },
        },
        thresholds: {
          http_req_failed: ['rate<0.01'],
          http_req_duration: ['p(95)<1000'],
        },
        summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
      };

const think = (min = 3, max = 8) => sleep(min + Math.random() * (max - min));
// Answering one question: listen to the clip or read the passage, then pick.
const answerPace = () => think(15, 40);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

function token(user) {
  const header = encoding.b64encode(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
    'rawurl',
  );
  const now = Math.floor(Date.now() / 1000);
  const body = encoding.b64encode(
    JSON.stringify({
      sub: user.id,
      email: user.email,
      role: 'STUDENT',
      deviceId: `capacity-${user.id}`,
      type: 'access',
      jti: `capacity-${user.id}-${__ITER}`,
      iat: now,
      exp: now + 6 * 3600,
    }),
    'rawurl',
  );
  return `${header}.${body}.${crypto.hmac('sha256', SECRET, `${header}.${body}`, 'base64rawurl')}`;
}

function req(name, method, path, tok, body, extra = {}) {
  const params = {
    // `name` groups every attempt's URL under its endpoint (k6 time series).
    tags: { endpoint: name, name },
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
      ...(extra.headers || {}),
    },
    ...(extra.binary ? { responseType: 'binary' } : {}),
    timeout: '30s',
  };
  const r = http.request(
    method,
    extra.absolute ? path : `${BASE}${path}`,
    body ? JSON.stringify(body) : null,
    params,
  );
  latency[name].add(r.timings.duration);
  const size =
    Number(r.headers['Content-Length']) ||
    (r.body ? (r.body.byteLength ?? r.body.length) : 0);
  bytes[name].add(size || 0);
  const ok = r.status >= 200 && r.status < 300;
  if (!ok) errors[name].add(1, { status: String(r.status) });
  if (r.status >= 500 || r.status === 0) status5xx.add(1, { endpoint: name });
  check(r, { [`${name} 2xx`]: () => ok });
  return r;
}

const json = (r) => {
  try {
    const j = r.json();
    return j && j.data !== undefined ? j.data : j;
  } catch (e) {
    return null;
  }
};
const firstOption = (q) => {
  const c = q && q.content;
  const opts = c && Array.isArray(c.options) ? c.options : [];
  return opts.length ? String(opts[0]) : 'A';
};

function signIn(user) {
  if (Math.random() < LOGIN_SHARE) {
    const r = req('login', 'POST', '/auth/login', null, {
      email: user.email,
      password: data.password,
      deviceId: `capacity-login-${user.id}`,
    });
    const d = json(r);
    const t = d && (d.accessToken || d.access_token);
    if (t) return t;
  }
  return token(user);
}

function dashboard(tok) {
  req('profile', 'GET', '/auth/profile', tok);
  req('today', 'GET', '/gamification/dashboard/today', tok);
  req('balance', 'GET', '/market/currency/balance', tok);
}

function reading(tok) {
  const list =
    json(req('reading_list', 'GET', '/reading/exercises', tok)) || [];
  const open = list.filter((x) => !x.isLocked && !x.isLevelLocked);
  if (!open.length) return;
  const quizId = pick(open).quizId;
  think(2, 4);
  const quiz = json(req('quiz_detail', 'GET', `/quizzes/${quizId}`, tok));
  const questions = (quiz && quiz.questions) || [];
  const answers = [];
  for (const q of questions) {
    answerPace();
    answers.push({ questionId: q.id, answer: firstOption(q) });
  }
  req('quiz_submit', 'POST', `/quizzes/${quizId}/submit`, tok, { answers });
}

function listening(tok) {
  const list =
    json(req('listening_list', 'GET', '/quizzes/listening-practice', tok)) ||
    [];
  const open = list.filter(
    (x) =>
      !x.isLocked &&
      !x.isLevelLocked &&
      data.listeningQuizIds.indexOf(x.id) >= 0,
  );
  if (!open.length) return;
  const quizId = pick(open).id;
  think(2, 4);
  const quiz = json(req('quiz_detail', 'GET', `/quizzes/${quizId}`, tok));
  const attempt = json(
    req(
      'listening_attempt',
      'POST',
      `/quizzes/${quizId}/listening-attempts`,
      tok,
    ),
  );
  const questions = (quiz && quiz.questions) || [];
  const answers = [];
  const saved = {};
  const fetched = {};
  for (const q of questions) {
    // The API says where the audio is; the browser streams it from storage and
    // keeps a dialogue's shared track in its cache.
    // AUDIO_MODE=stream replays the frontend before 2026-11-09: every question's
    // audio downloaded through the API (used to measure the old build).
    if (AUDIO_MODE === 'stream') {
      req(
        'audio_stream',
        'GET',
        `/quizzes/${quizId}/questions/${q.id}/audio`,
        tok,
        null,
        { binary: true },
      );
      answerPace();
      answers.push({ questionId: q.id, answer: firstOption(q) });
      saved[String(q.id)] = firstOption(q);
      if (attempt && attempt.id)
        req(
          'listening_save',
          'PATCH',
          `/quizzes/${quizId}/listening-attempts/${attempt.id}`,
          tok,
          { currentQuestionId: q.id, answers: saved },
        );
      continue;
    }
    const where = json(
      req(
        'audio_url',
        'GET',
        `/quizzes/${quizId}/questions/${q.id}/audio-url`,
        tok,
      ),
    );
    if (where && where.url && !fetched[where.url]) {
      fetched[where.url] = true;
      req(
        'audio_storage',
        'GET',
        where.url.replace(/^https?:\/\/[^/]+/, STORAGE),
        null,
        null,
        { binary: true, absolute: true },
      );
    }
    answerPace();
    answers.push({ questionId: q.id, answer: firstOption(q) });
    saved[String(q.id)] = firstOption(q);
    if (attempt && attempt.id)
      req(
        'listening_save',
        'PATCH',
        `/quizzes/${quizId}/listening-attempts/${attempt.id}`,
        tok,
        { currentQuestionId: q.id, answers: saved },
      );
  }
  req('quiz_submit', 'POST', `/quizzes/${quizId}/submit`, tok, {
    answers,
    ...(attempt && attempt.id ? { attemptId: attempt.id } : {}),
  });
}

function exam(tok, submitNow = true) {
  const examId = data.examId;
  req('exam_list', 'GET', '/toeic/exams', tok);
  req('exam_briefing', 'GET', `/toeic/exams/${examId}/briefing`, tok);
  think(2, 5);
  const started = json(
    req('exam_start', 'POST', `/toeic/exams/${examId}/attempts`, tok, {
      mode: 'PRACTICE',
    }),
  );
  if (!started || !started.id) return null;
  const id = started.id;
  req('exam_begin', 'POST', `/toeic/attempts/${id}/begin`, tok);
  const detail = json(req('exam_detail', 'GET', `/toeic/attempts/${id}`, tok));
  const master = json(
    req('exam_master', 'GET', `/toeic/attempts/${id}/listening/master`, tok),
  );
  // The browser streams the Listening master in ranges; the first megabyte
  // covers about two minutes at 64 kbps.
  // A signed URL plays from storage; otherwise the API streams it.
  if (master && master.url)
    req(
      'exam_audio_storage',
      'GET',
      master.url.replace(/^https?:\/\/[^/]+/, STORAGE),
      null,
      null,
      { binary: true, absolute: true, headers: { Range: 'bytes=0-1048575' } },
    );
  else if (master && master.path)
    req('exam_audio', 'GET', master.path, tok, null, {
      binary: true,
      headers: { Range: 'bytes=0-1048575' },
    });
  const questions = (
    (detail && detail.exam && detail.exam.groups) ||
    []
  ).reduce((all, g) => all.concat(g.questions || []), []);
  const answers = {};
  for (const q of questions.slice(0, 10)) {
    answerPace();
    answers[String(q.id)] = 0;
    if (Object.keys(answers).length % 2 === 0)
      req('exam_answers', 'PATCH', `/toeic/attempts/${id}/answers`, tok, {
        answers,
        currentQuestionId: q.id,
      });
  }
  if (!submitNow) return id;
  req('exam_submit', 'POST', `/toeic/attempts/${id}/submit`, tok);
  req('exam_result', 'GET', `/toeic/attempts/${id}/result`, tok);
  return id;
}

function browse(tok) {
  req('pet', 'GET', '/gamification/pet', tok);
  think(3, 6);
  req('ranking', 'GET', '/gamification/ranking', tok);
  think(3, 6);
  req('today', 'GET', '/gamification/dashboard/today', tok);
}

function vocab(tok) {
  const d = json(req('vocab_topics', 'GET', '/vocab/topics', tok));
  const topics = ((d && d.topics) || []).filter((t) => !t.isLocked);
  if (!topics.length) return;
  think(2, 4);
  const topic = json(
    req('vocab_topic', 'GET', `/vocab/topics/${pick(topics).id}`, tok),
  );
  for (const w of ((topic && topic.words) || []).slice(0, 8)) {
    think(4, 10);
    req('vocab_review', 'POST', `/vocab/words/${w.id}/review`, tok, {
      isCorrect: Math.random() < 0.7,
    });
  }
}

function spike(user) {
  // Everyone prepares over 90 s (not the measured part), then all submit
  // within the same 30 s.
  sleep(Math.random() * 90);
  const tok = token(user);
  const kind = __VU % 3;
  let submit;
  if (kind === 0) {
    const list = (
      json(req('reading_list', 'GET', '/reading/exercises', tok)) || []
    ).filter((x) => !x.isLocked && !x.isLevelLocked);
    const quizId = list.length ? pick(list).quizId : null;
    const quiz = quizId
      ? json(req('quiz_detail', 'GET', `/quizzes/${quizId}`, tok))
      : null;
    const answers = ((quiz && quiz.questions) || []).map((q) => ({
      questionId: q.id,
      answer: firstOption(q),
    }));
    submit = () =>
      quizId &&
      req('quiz_submit', 'POST', `/quizzes/${quizId}/submit`, tok, { answers });
  } else if (kind === 1) {
    const list = (
      json(req('listening_list', 'GET', '/quizzes/listening-practice', tok)) ||
      []
    ).filter(
      (x) =>
        !x.isLocked &&
        !x.isLevelLocked &&
        data.listeningQuizIds.indexOf(x.id) >= 0,
    );
    const quizId = list.length ? pick(list).id : null;
    const quiz = quizId
      ? json(req('quiz_detail', 'GET', `/quizzes/${quizId}`, tok))
      : null;
    const answers = ((quiz && quiz.questions) || []).map((q) => ({
      questionId: q.id,
      answer: firstOption(q),
    }));
    submit = () =>
      quizId &&
      req('quiz_submit', 'POST', `/quizzes/${quizId}/submit`, tok, { answers });
  } else {
    const examId = data.examId;
    const started = json(
      req('exam_start', 'POST', `/toeic/exams/${examId}/attempts`, tok, {
        mode: 'PRACTICE',
      }),
    );
    const id = started && started.id;
    if (id) req('exam_begin', 'POST', `/toeic/attempts/${id}/begin`, tok);
    submit = () =>
      id && req('exam_submit', 'POST', `/toeic/attempts/${id}/submit`, tok);
  }
  // All learners are ready by 150 s after the start; then a 30 s window.
  const wait =
    Number(__ENV.SPIKE_AT || 150) -
    (Date.now() - Number(__ENV.T0 || Date.now())) / 1000 +
    Math.random() * 30;
  if (wait > 0) sleep(wait);
  submit && submit();
}

export default function () {
  const user = data.users[(__VU - 1) % data.users.length];
  if (MODE === 'spike') return spike(user);
  const tok = signIn(user);
  dashboard(tok);
  think();
  const roll = Math.random();
  if (roll < 0.2) reading(tok);
  else if (roll < 0.4) listening(tok);
  else if (roll < 0.65) exam(tok);
  else if (roll < 0.85) browse(tok);
  else vocab(tok);
  think(5, 15);
}
