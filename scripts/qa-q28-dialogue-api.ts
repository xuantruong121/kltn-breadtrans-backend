import './qa/qa-legacy-guard';
import 'dotenv/config';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaClient, Role } from '@prisma/client';

const prisma = new PrismaClient();
const apiBase = process.env.QA_API_BASE_URL ?? 'http://localhost:3001';

async function request(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json') ? JSON.parse(await response.text()) : null;
  return { status: response.status, body, headers: response.headers };
}

async function main() {
  const marker = randomUUID().replace(/-/g, '').slice(0, 12);
  const password = `Qa-${randomUUID()}-Aa1!`;
  const userIds: number[] = [];
  try {
    const createLearner = async (suffix: string) => {
      const user = await prisma.user.create({
        data: { email: `qa-q28-${marker}-${suffix}@breadtrans.local`, password: await bcrypt.hash(password, 10), role: Role.STUDENT, emailVerifiedAt: new Date(), profile: { create: { fullName: 'QA Q28 Dialogue' } } },
      });
      userIds.push(user.id);
      const login = await fetch(`${apiBase}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: user.email, password, deviceId: `${marker}-${suffix}` }) });
      const loginBody = await login.json();
      const token = (loginBody?.data ?? loginBody)?.access_token as string | undefined;
      if (login.status !== 200 || !token) throw new Error(`LOGIN_${suffix}_${login.status}`);
      return token;
    };
    const tokenA = await createLearner('a');
    const tokenB = await createLearner('b');
    const artifact = await prisma.listeningAudioArtifact.findFirstOrThrow({ where: { quizId: 28, version: 2, status: 'PUBLISHED' }, select: { id: true, version: true, checksumSha256: true, timeline: true } });
    const questions = await prisma.question.findMany({ where: { quizId: 28 }, orderBy: { order: 'asc' }, select: { id: true } });
    const quiz = await request('/quizzes/28', tokenA);
    const payload = quiz.body?.data ?? quiz.body;
    const safeQuestions = Array.isArray(payload?.questions) ? payload.questions : [];
    const preRevealLeaks = safeQuestions.filter((question: any) => ['transcriptSegments', 'correctAnswer', 'audioText', 'translation'].some((key) => question?.content?.[key] !== undefined));
    const query = new URLSearchParams({ artifactId: String(artifact.id), v: String(artifact.version), checksum: artifact.checksumSha256 ?? '' });
    const perQuestion = await Promise.all(questions.map((question) => request(`/quizzes/28/questions/${question.id}/audio?${query}`, tokenA)));
    const full = await request(`/quizzes/28/transcript/audio?${query}`, tokenA);
    const transcriptBeforeReveal = await request('/quizzes/28/transcript', tokenA);
    const repeatedBeforeReveal = await request('/quizzes/28/transcript', tokenA);
    const reveal = await request('/quizzes/28/transcript/reveal', tokenA, { method: 'POST' });
    const transcriptAfterReveal = await request('/quizzes/28/transcript', tokenA);
    const transcriptForOtherLearner = await request('/quizzes/28/transcript', tokenB);
    const transcriptItems = (transcriptAfterReveal.body?.data ?? transcriptAfterReveal.body)?.items ?? [];
    const validItems = transcriptItems.length === 4 && transcriptItems.every((item: any) => item.transcript && item.speaker && item.turnId && Number.isInteger(item.startMs) && Number.isInteger(item.endMs));
    if (quiz.status !== 200 || preRevealLeaks.length || transcriptBeforeReveal.status !== 403 || repeatedBeforeReveal.status !== 403 || reveal.status !== 200 || transcriptAfterReveal.status !== 200 || !validItems || transcriptForOtherLearner.status !== 403) {
      throw new Error(`Q28_DIALOGUE_CONTRACT_FAILED quiz=${quiz.status} leaks=${preRevealLeaks.length} before=${transcriptBeforeReveal.status}/${repeatedBeforeReveal.status} reveal=${reveal.status} after=${transcriptAfterReveal.status} items=${transcriptItems.length} other=${transcriptForOtherLearner.status}`);
    }
    console.log(JSON.stringify({
      quizStatus: quiz.status,
      questionCount: safeQuestions.length,
      artifactVersion: payload?.listeningAudioArtifact?.version ?? null,
      preRevealPayloadLeakCount: preRevealLeaks.length,
      perQuestionStatuses: perQuestion.map((result) => result.status),
      fullAudioStatus: full.status,
      transcriptBeforeRevealStatus: transcriptBeforeReveal.status,
      repeatedPreRevealTranscriptStatus: repeatedBeforeReveal.status,
      revealStatus: reveal.status,
      transcriptAfterRevealStatus: transcriptAfterReveal.status,
      transcriptAfterRevealItemCount: transcriptItems.length,
      otherLearnerTranscriptStatus: transcriptForOtherLearner.status,
      canonicalTimelineCount: Array.isArray(artifact.timeline) ? artifact.timeline.length : 0,
      Q28_PRE_REVEAL_TRANSCRIPT_HTTP_STATUS: 403,
      Q28_PRE_REVEAL_LEAK_COUNT: 0,
      Q28_PRE_REVEAL_PRIVACY_PASS: true,
      Q28_TRANSCRIPT_REVEAL_PASS: true,
      TRANSCRIPT_REVEAL_USER_ISOLATION_PASS: true,
    }));
  } finally {
    await Promise.all(userIds.map((id) => prisma.user.delete({ where: { id } }).catch(() => undefined)));
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
