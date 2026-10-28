import './qa/qa-legacy-guard';
import 'dotenv/config';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient, Role, SubscriptionStatus } from '@prisma/client';

const prisma = new PrismaClient();
const apiBase = process.env.RECOVERY_API_BASE_URL ?? 'http://localhost:3001';
const marker = `qa-r2-crawl-${randomUUID()}`;
const learnerPrefixes = [
  '/subscriptions', '/vocab', '/grammar', '/quizzes', '/listening',
  '/speaking', '/reading', '/writing', '/courses', '/public/courses',
  '/toeic', '/plans', '/market', '/users', '/leaderboard', '/gamification',
  '/diagnostic', '/notifications', '/support', '/exams', '/flashcard',
];

type Tier = 'FREE' | 'PLUS' | 'PRO';
type Session = { tier: Tier; userId: number; token: string };

const unwrap = (body: unknown): unknown =>
  body && typeof body === 'object' && 'data' in body
    ? (body as { data: unknown }).data
    : body;

async function login(email: string, password: string): Promise<string> {
  const response = await fetch(`${apiBase}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, deviceId: marker }),
  });
  const body = unwrap(await response.json()) as { access_token?: string };
  if (!response.ok || !body?.access_token) throw new Error(`Login HTTP ${response.status}`);
  return body.access_token;
}

function responseShape(value: unknown): string {
  if (Array.isArray(value)) return `array:${value.length}`;
  if (value && typeof value === 'object') return `object:${Object.keys(value as object).sort().join(',')}`;
  return value === null ? 'null' : typeof value;
}

async function main() {
  const swaggerResponse = await fetch(`${apiBase}/api/docs-json`);
  if (!swaggerResponse.ok) throw new Error('Swagger document unavailable');
  const swagger = (await swaggerResponse.json()) as { paths: Record<string, Record<string, unknown>> };
  const staticPaths = Object.keys(swagger.paths)
    .filter((path) => !path.includes('{'))
    .filter((path) => learnerPrefixes.some((prefix) => path.startsWith(prefix)))
    .filter((path) => !path.startsWith('/admin/'))
    .filter((path) => Boolean(swagger.paths[path].get))
    .sort();
  const password = `Crawl-${randomUUID()}-Aa1!`;
  const sessions: Session[] = [];
  try {
    const paidVersions = await prisma.planVersion.findMany({
      where: { isCurrent: true, status: 'PUBLISHED', plan: { code: { in: ['PLUS', 'PRO'] } } },
      include: { plan: { select: { code: true } } },
    });
    const byCode = new Map(paidVersions.map((version) => [version.plan.code, version]));
    for (const tier of ['FREE', 'PLUS', 'PRO'] as const) {
      const user = await prisma.user.create({
        data: {
          email: `${marker}-${tier.toLowerCase()}@breadtrans.local`,
          password: await bcrypt.hash(password, 10), role: Role.STUDENT,
          emailVerifiedAt: new Date(), profile: { create: { fullName: `QA API ${tier}` } },
        },
      });
      if (tier !== 'FREE') {
        const version = byCode.get(tier);
        if (!version) throw new Error(`Missing ${tier} version`);
        await prisma.subscription.create({
          data: {
            userId: user.id, planVersionId: version.id, status: SubscriptionStatus.ACTIVE,
            startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 60 * 60_000),
          },
        });
      }
      sessions.push({ tier, userId: user.id, token: await login(user.email, password) });
    }
    const results: Array<{ tier: Tier; path: string; status: number; shape: string }> = [];
    for (const session of sessions) {
      for (const path of staticPaths) {
        const response = await fetch(`${apiBase}${path}`, {
          headers: { Authorization: `Bearer ${session.token}` },
        });
        const body = unwrap(await response.json().catch(() => null));
        results.push({ tier: session.tier, path, status: response.status, shape: responseShape(body) });
      }
    }
    const serverErrors = results.filter((result) => result.status >= 500);
    const artifact = {
      generatedAt: new Date().toISOString(),
      staticReadEndpointCount: staticPaths.length,
      requestCount: results.length,
      serverErrorCount: serverErrors.length,
      results,
      note: 'Only documented GET endpoints without path parameters were crawled; parameterized learner flows are verified separately by domain runtime harnesses.',
    };
    writeFileSync(join(__dirname, '..', 'artifacts', 'learner-api-crawl.json'), JSON.stringify(artifact, null, 2));
    if (serverErrors.length) throw new Error(`Learner GET crawl found ${serverErrors.length} HTTP 5xx responses`);
    console.log(
      JSON.stringify({
        LEARNER_API_CRAWL: 'PASS',
        staticReadEndpointCount: artifact.staticReadEndpointCount,
        requestCount: artifact.requestCount,
        serverErrorCount: artifact.serverErrorCount,
        artifact: 'artifacts/learner-api-crawl.json',
      }),
    );
  } finally {
    await Promise.all(sessions.map((session) => fetch(`${apiBase}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${session.token}` } }).catch(() => undefined)));
    const ids = sessions.map((session) => session.userId);
    if (ids.length) {
      await prisma.subscription.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
