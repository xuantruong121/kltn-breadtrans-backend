import './qa/qa-legacy-guard';
import 'dotenv/config';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaClient, Role, SubscriptionStatus } from '@prisma/client';

const prisma = new PrismaClient();
const apiBase = process.env.RECOVERY_API_BASE_URL ?? 'http://localhost:3001';
const marker = `qa-r2-access-${randomUUID()}`;

type Tier = 'FREE' | 'PLUS' | 'PRO';
type Session = { email: string; token: string; deviceId: string };

const countItems = (value: unknown): number | null => {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['items', 'data', 'courses', 'topics']) {
      const count = countItems(record[key]);
      if (count !== null) return count;
    }
  }
  return null;
};

async function request(path: string, token?: string) {
  const response = await fetch(`${apiBase}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

async function login(email: string, password: string): Promise<Session> {
  const response = await fetch(`${apiBase}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, deviceId: marker }),
  });
  const responseBody = (await response.json()) as {
    access_token?: string;
    deviceId?: string;
    data?: {
      access_token?: string;
      deviceId?: string;
    };
  };
  const body = responseBody.data ?? responseBody;
  if (!response.ok || !body.access_token || !body.deviceId) {
    throw new Error(`Login failed with HTTP ${response.status}`);
  }
  return { email, token: body.access_token, deviceId: body.deviceId };
}

async function main() {
  const password = `R2-${randomUUID()}-Aa1!`;
  const passwordHash = await bcrypt.hash(password, 10);
  const versions = await prisma.planVersion.findMany({
    where: { isCurrent: true, status: 'PUBLISHED', plan: { code: { in: ['PLUS', 'PRO'] } } },
    include: { plan: { select: { code: true } } },
  });
  const versionByCode = new Map(versions.map((item) => [item.plan.code, item]));
  if (!versionByCode.get('PLUS') || !versionByCode.get('PRO')) {
    throw new Error('Current PLUS/PRO versions are missing');
  }

  const users: Array<{ id: number; tier: Tier; email: string }> = [];
  const sessions: Session[] = [];
  try {
    for (const tier of ['FREE', 'PLUS', 'PRO'] as const) {
      const email = `${marker}-${tier.toLowerCase()}@breadtrans.local`;
      const user = await prisma.user.create({
        data: {
          email,
          password: passwordHash,
          role: Role.STUDENT,
          emailVerifiedAt: new Date(),
          profile: { create: { fullName: `QA ${tier}` } },
        },
      });
      users.push({ id: user.id, tier, email });
      if (tier !== 'FREE') {
        const version = versionByCode.get(tier)!;
        await prisma.subscription.create({
          data: {
            userId: user.id,
            planVersionId: version.id,
            status: SubscriptionStatus.ACTIVE,
            startsAt: new Date(Date.now() - 60_000),
            endsAt: new Date(Date.now() + 60 * 60_000),
          },
        });
      }
    }

    const evidence: Record<string, unknown> = {};
    for (const user of users) {
      const session = await login(user.email, password);
      sessions.push(session);
      const [subscription, topics, catalog, course] = await Promise.all([
        request('/subscriptions/me', session.token),
        request('/vocab/topics', session.token),
        request('/public/courses', session.token),
        request('/courses/1/learning', session.token),
      ]);
      evidence[user.tier] = {
        subscriptionStatus: subscription.status,
        effectivePlan:
          subscription.body && typeof subscription.body === 'object'
            ? (subscription.body as Record<string, unknown>).data ?? subscription.body
            : null,
        vocabTopicsStatus: topics.status,
        vocabTopicsCount: countItems(topics.body),
        courseCatalogStatus: catalog.status,
        courseCatalogCount: countItems(catalog.body),
        courseLearningStatus: course.status,
      };
    }
    console.log(JSON.stringify({ marker, evidence }, null, 2));
  } finally {
    await Promise.all(
      sessions.map((session) =>
        fetch(`${apiBase}/auth/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.token}` },
        }).catch(() => undefined),
      ),
    );
    const ids = users.map((user) => user.id);
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
