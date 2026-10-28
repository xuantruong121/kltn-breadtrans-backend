import './qa/qa-legacy-guard';
import 'dotenv/config';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaClient, Role, SubscriptionStatus } from '@prisma/client';

const quizId = Number(process.argv[2]);
const prisma = new PrismaClient();
const apiBase = process.env.QA_API_BASE_URL ?? 'http://localhost:3001';

type Session = { tier: 'FREE' | 'PLUS' | 'PRO'; userId: number; token: string };

async function request(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json')
    ? JSON.parse(await response.text())
    : null;
  return { status: response.status, body, headers: response.headers };
}

async function createSession(tier: Session['tier'], marker: string): Promise<Session> {
  const password = `Qa-${randomUUID()}-Aa1!`;
  const email = `qa-${marker}-${tier.toLowerCase()}@breadtrans.local`;
  const user = await prisma.user.create({
    data: {
      email,
      password: await bcrypt.hash(password, 10),
      role: Role.STUDENT,
      emailVerifiedAt: new Date(),
      profile: { create: { fullName: `QA Listening ${tier}` } },
    },
  });
  try {
    if (tier !== 'FREE') {
      const version = await prisma.planVersion.findFirst({
      where: {
        isCurrent: true,
        status: 'PUBLISHED',
        plan: { code: tier, status: 'ACTIVE' },
      },
      select: { id: true },
    });
      if (!version) throw new Error(`CURRENT_${tier}_PLAN_VERSION_NOT_FOUND`);
      await prisma.subscription.create({
      data: {
        userId: user.id,
        planVersionId: version.id,
        status: SubscriptionStatus.ACTIVE,
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 60 * 60 * 1000),
      },
      });
    }
    const login = await fetch(`${apiBase}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, deviceId: marker }),
    });
    const body = await login.json();
    const token = (body?.data ?? body)?.access_token as string | undefined;
    if (login.status !== 200 || !token) {
      throw new Error(`${tier}_LOGIN_${login.status}:${JSON.stringify(body)}`);
    }
    return { tier, userId: user.id, token };
  } catch (error) {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    throw error;
  }
}

function isDenied(status: number) {
  return status === 401 || status === 403 || status === 404;
}

async function main() {
  if (!Number.isInteger(quizId)) throw new Error('Usage: qa-listening-premium-api.ts <quizId>');
  const marker = `${quizId}-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const sessions: Session[] = [];
  try {
    const [artifact, questions] = await Promise.all([
      prisma.listeningAudioArtifact.findFirstOrThrow({
        where: { quizId, status: 'PUBLISHED' },
        select: { id: true, version: true, checksumSha256: true, durationMs: true, timeline: true },
      }),
      prisma.question.findMany({
        where: { quizId }, orderBy: { order: 'asc' }, select: { id: true, content: true },
      }),
    ]);
    const canonicalTimeline = new Map(
      (artifact.timeline as Array<{ turnId: string; startMs: number; endMs: number }>).map((turn) => [turn.turnId, turn]),
    );
    if (questions.length !== 20 || canonicalTimeline.size !== 20) throw new Error('CANONICAL_Q25_SHAPE_INVALID');
    for (const tier of ['FREE', 'PLUS', 'PRO'] as const) sessions.push(await createSession(tier, marker));
    const query = new URLSearchParams({ artifactId: String(artifact.id), v: String(artifact.version), checksum: artifact.checksumSha256 ?? '' });
    const endpoints = (token: string) => [
      request(`/quizzes/${quizId}`, token),
      request(`/quizzes/${quizId}/questions/${questions[0].id}/audio?${query}`, token),
      request(`/quizzes/${quizId}/transcript/audio?${query}`, token),
      request(`/quizzes/${quizId}/transcript`, token),
      request(`/quizzes/${quizId}/transcript/reveal`, token, { method: 'POST' }),
    ];
    const free = sessions.find((session) => session.tier === 'FREE')!;
    const freeResults = await Promise.all(endpoints(free.token));
    if (!freeResults.every((result) => isDenied(result.status))) {
      throw new Error(`FREE_PREMIUM_BYPASS=${freeResults.map((result) => result.status).join(',')}`);
    }
    const entitledResults: Record<string, unknown> = {};
    for (const tier of ['PLUS', 'PRO'] as const) {
      const session = sessions.find((entry) => entry.tier === tier)!;
      const quiz = await request(`/quizzes/${quizId}`, session.token);
      const data = quiz.body?.data ?? quiz.body;
      const deliveredQuestions = Array.isArray(data?.questions) ? data.questions : [];
      const leaks = deliveredQuestions.filter((question: any) =>
        ['transcriptSegments', 'correctAnswer', 'audioText', 'translation'].some((key) => question?.content?.[key] !== undefined),
      );
      const mappings = deliveredQuestions.filter((question: any) => {
        const expected = canonicalTimeline.get(question?.content?.targetTurnId);
        const segment = question?.listeningSegment;
        return !expected || segment?.turnId !== question.content.targetTurnId || segment.startMs !== expected.startMs || segment.endMs !== expected.endMs;
      });
      if (quiz.status !== 200 || deliveredQuestions.length !== 20 || leaks.length || mappings.length) {
        throw new Error(`${tier}_PRE_REVEAL_INVALID status=${quiz.status} questions=${deliveredQuestions.length} leaks=${leaks.length} mappings=${mappings.length}`);
      }
      const preTranscript = await request(`/quizzes/${quizId}/transcript`, session.token);
      const perQuestion = await Promise.all(questions.map((question) => request(`/quizzes/${quizId}/questions/${question.id}/audio?${query}`, session.token)));
      const fullAudio = await request(`/quizzes/${quizId}/transcript/audio?${query}`, session.token);
      const reveal = await request(`/quizzes/${quizId}/transcript/reveal`, session.token, { method: 'POST' });
      const transcript = await request(`/quizzes/${quizId}/transcript`, session.token);
      const items = (transcript.body?.data ?? transcript.body)?.items ?? [];
      const invalidTranscript = items.some((item: any) => {
        const expected = canonicalTimeline.get(item.turnId);
        return !item.transcript || !item.translation || !expected || item.startMs !== expected.startMs || item.endMs !== expected.endMs;
      });
      if (
        preTranscript.status !== 403 ||
        perQuestion.some((result) => result.status !== 200 || result.headers.get('x-listening-audio-version') !== String(artifact.version)) ||
        fullAudio.status !== 200 ||
        fullAudio.headers.get('x-listening-audio-version') !== String(artifact.version) ||
        reveal.status !== 200 || transcript.status !== 200 || items.length !== 20 || invalidTranscript
      ) {
        throw new Error(`${tier}_DELIVERY_CONTRACT_FAILED pre=${preTranscript.status} full=${fullAudio.status} reveal=${reveal.status} transcript=${transcript.status} items=${items.length}`);
      }
      entitledResults[tier] = { quiz: quiz.status, preTranscript: preTranscript.status, questionAudio: perQuestion.length, fullAudio: fullAudio.status, reveal: reveal.status, transcript: transcript.status };
    }
    console.log(JSON.stringify({
      quizId,
      artifactVersion: artifact.version,
      freeEndpointStatuses: freeResults.map((result) => result.status),
      entitledResults,
      Q25_FREE_ACCESS_DENIED: true,
      Q25_PLUS_ACCESS_ALLOWED: true,
      Q25_PRO_ACCESS_ALLOWED: true,
      Q25_PREMIUM_GATE_PASS: true,
      Q25_PRE_REVEAL_LEAK_COUNT: 0,
      Q25_PRE_REVEAL_PRIVACY_PASS: true,
      Q25_TIMELINE_MAPPING_PASS: true,
    }));
  } finally {
    await Promise.all(sessions.map((session) => prisma.user.delete({ where: { id: session.userId } }).catch(() => undefined)));
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
