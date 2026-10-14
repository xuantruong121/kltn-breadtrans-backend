import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { PrismaClient, Role } from '@prisma/client';
import Redis from 'ioredis';

const prisma = new PrismaClient();
const baseUrl = process.env.PHASE5B_API_URL ?? 'http://127.0.0.1:3001';
const password = `Phase5b!${randomUUID()}`;
const runId = Date.now().toString();
const prefix = `qa-cms-phase5b-${runId}`;
const adminEmail = `${prefix}-admin@breadtrans.qa`;
const studentEmail = `${prefix}-student@breadtrans.qa`;
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  connectTimeout: 3000,
});

type Evidence = Record<string, unknown>;
const evidence: Evidence = {
  runId,
  model: process.env.GEMINI_MODEL_NAME ?? null,
};

function digest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function unwrap(payload: any) {
  return payload && typeof payload === 'object' && 'data' in payload
    ? payload.data
    : payload;
}

async function request(
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON errors are still recorded without exposing credentials.
  }
  return { status: response.status, body: unwrap(body) };
}

async function login(email: string) {
  const response = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (response.status !== 201 && response.status !== 200)
    throw new Error(`Login failed (${response.status})`);
  if (!response.body?.access_token)
    throw new Error('Login response has no token');
  return String(response.body.access_token);
}

async function domainSnapshot() {
  const [courses, quizzes, questions] = await Promise.all([
    prisma.course.findMany({
      where: { title: { not: { startsWith: 'qa-cms-phase5b-' } } },
      select: { id: true, title: true, status: true, updatedAt: true },
      orderBy: { id: 'asc' },
      take: 50,
    }),
    prisma.quiz.findMany({
      where: { title: { not: { startsWith: 'qa-cms-phase5b-' } } },
      select: {
        id: true,
        title: true,
        publicationStatus: true,
        createdAt: true,
      },
      orderBy: { id: 'asc' },
      take: 100,
    }),
    prisma.question.findMany({
      select: { id: true, quizId: true, type: true, order: true },
      orderBy: { id: 'asc' },
      take: 200,
    }),
  ]);
  return {
    hash: digest({ courses, quizzes, questions }),
    counts: {
      courses: courses.length,
      quizzes: quizzes.length,
      questions: questions.length,
    },
  };
}

async function telemetry() {
  try {
    if (redis.status === 'wait') await redis.connect();
    const keys = [
      'gemini:telemetry:total_requests',
      'gemini:telemetry:input_tokens',
      'gemini:telemetry:output_tokens',
      `gemini:daily_quota:${new Date().toISOString().slice(0, 10)}`,
    ];
    return Object.fromEntries(
      await Promise.all(keys.map(async (key) => [key, await redis.get(key)])),
    );
  } catch (error) {
    return { unavailable: error instanceof Error ? error.message : 'unknown' };
  }
}

async function cleanup() {
  await prisma.$transaction([
    prisma.quiz.deleteMany({
      where: { title: { startsWith: 'qa-cms-phase5b-' } },
    }),
    prisma.course.deleteMany({
      where: { title: { startsWith: 'qa-cms-phase5b-' } },
    }),
    prisma.user.deleteMany({
      where: { email: { startsWith: 'qa-cms-phase5b-' } },
    }),
  ]);
}

async function main() {
  await cleanup();
  const before = await domainSnapshot();
  const hash = await bcrypt.hash(password, 12);
  await prisma.user.createMany({
    data: [
      { email: adminEmail, password: hash, role: Role.ADMIN },
      { email: studentEmail, password: hash, role: Role.STUDENT },
    ],
  });
  const [adminToken, studentToken] = await Promise.all([
    login(adminEmail),
    login(studentEmail),
  ]);
  const telemetryBefore = await telemetry();

  const cases = [
    [
      'course',
      '/admin/courses/ai/suggest-curriculum',
      {
        courseTitle: 'QA Practical English A2',
        level: 'A2',
        description: 'Giao tiếp hằng ngày',
        targetLessonCount: 1,
      },
    ],
    [
      'listeningContent',
      '/admin/listening/ai/suggest-content',
      { mode: 'DIALOGUE', topic: 'Ordering coffee', level: 'A2' },
    ],
    [
      'listeningQuestions',
      '/admin/listening/ai/suggest-questions',
      {
        mode: 'DIALOGUE',
        sourceText: 'Barista: Hello.\nCustomer: A coffee, please.',
        level: 'A2',
        count: 1,
      },
    ],
    [
      'writing',
      '/admin/writing/ai/suggest-task',
      {
        taskType: 'EMAIL',
        topic: 'Requesting information',
        level: 'A2',
        wordMin: 50,
        wordMax: 80,
      },
    ],
  ] as const;

  const real: Record<string, unknown> = {};
  const denied: Record<string, number> = {};
  for (const [name, path, body] of cases) {
    const success = await request(
      path,
      { method: 'POST', body: JSON.stringify(body) },
      adminToken,
    );
    if (success.status !== 200 && success.status !== 201)
      throw new Error(`${name} Gemini call failed (${success.status})`);
    real[name] = {
      status: success.status,
      responseHash: digest(success.body),
      hasPayload: Boolean(success.body),
    };
    const student = await request(
      path,
      { method: 'POST', body: JSON.stringify(body) },
      studentToken,
    );
    denied[name] = student.status;
    if (student.status !== 403)
      throw new Error(
        `${name} student denial expected 403, got ${student.status}`,
      );
  }

  const after = await domainSnapshot();
  if (before.hash !== after.hash)
    throw new Error('AI suggestion endpoints changed domain snapshot');
  const telemetryAfter = await telemetry();
  evidence.realGemini = real;
  evidence.studentAuthorization = denied;
  evidence.snapshot = { before, after, unchanged: true };
  evidence.telemetry = { before: telemetryBefore, after: telemetryAfter };
  console.log(JSON.stringify(evidence, null, 2));
}

main()
  .catch((error) => {
    console.error(
      error instanceof Error ? (error.stack ?? error.message) : error,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    if (redis.status !== 'end') await redis.quit().catch(() => undefined);
    await prisma.$disconnect();
  });
