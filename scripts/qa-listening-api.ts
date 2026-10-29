import './qa/qa-legacy-guard';
import 'dotenv/config';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaClient, Role } from '@prisma/client';

const quizId = Number(process.argv[2]);
const prisma = new PrismaClient();
const apiBase = process.env.QA_API_BASE_URL ?? 'http://localhost:3001';

async function request(path: string, token?: string, init: RequestInit = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
  });
  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json') ? JSON.parse(await response.text()) : null;
  return { status: response.status, body, headers: response.headers };
}

async function main() {
  if (!Number.isInteger(quizId)) throw new Error('Usage: qa-listening-api.ts <quizId>');
  const marker = `qa-listening-${quizId}-${randomUUID()}`;
  const password = `Qa-${randomUUID()}-Aa1!`;
  let userId: number | undefined;
  try {
    const user = await prisma.user.create({ data: { email: `${marker}@breadtrans.local`, password: await bcrypt.hash(password, 10), role: Role.STUDENT, emailVerifiedAt: new Date(), profile: { create: { fullName: 'QA Listening' } } } });
    userId = user.id;
    const login = await request('/auth/login', undefined, { method: 'POST', body: JSON.stringify({ email: user.email, password, deviceId: marker }) });
    const token = (login.body?.data ?? login.body)?.access_token as string | undefined;
    if (login.status !== 200 || !token) throw new Error(`LOGIN=${login.status}`);
    const artifact = await prisma.listeningAudioArtifact.findFirst({ where: { quizId, status: 'PUBLISHED' }, select: { id: true, version: true, checksumSha256: true, durationMs: true, timeline: true } });
    if (!artifact && process.env.QA_EXPECT_FALLBACK === 'true') {
      const quiz = await request(`/quizzes/${quizId}`, token);
      const data = quiz.body?.data ?? quiz.body;
      const questions = Array.isArray(data?.questions) ? data.questions : [];
      const first = questions[0];
      const audio = first
        ? await request(`/quizzes/${quizId}/questions/${first.id}/audio`, token)
        : { status: 0 };
      if (quiz.status !== 200 || data?.listeningAudioArtifact || !first || audio.status !== 200) {
        throw new Error(`FALLBACK_INVALID quiz=${quiz.status} artifact=${Boolean(data?.listeningAudioArtifact)} audio=${audio.status}`);
      }
      console.log(JSON.stringify({ quizId, questionId: first.id, questionAudioStatus: audio.status, publishedArtifact: null, Q24_SAFE_FALLBACK_AFTER_PARK_PASS: true }));
      return;
    }
    if (!artifact) throw new Error('PUBLISHED_ARTIFACT_NOT_FOUND');
    const timeline = new Map((artifact.timeline as Array<{ turnId: string; startMs: number; endMs: number }>).map((turn) => [turn.turnId, turn]));
    const quiz = await request(`/quizzes/${quizId}`, token);
    const data = quiz.body?.data ?? quiz.body;
    const questions = Array.isArray(data?.questions) ? data.questions : [];
    const leaks = questions.filter((question: any) => ['transcriptSegments', 'correctAnswer', 'audioText', 'translation'].some((key) => question?.content?.[key] !== undefined));
    if (quiz.status !== 200 || leaks.length || !data?.listeningAudioArtifact || questions.length !== timeline.size) throw new Error(`PRE_REVEAL_INVALID status=${quiz.status} questions=${questions.length} leaks=${leaks.length}`);
    const mappingFailures = questions.filter((question: any) => { const expected = timeline.get(question?.content?.targetTurnId); const actual = question?.listeningSegment; return !expected || actual?.turnId !== question.content.targetTurnId || actual.startMs !== expected.startMs || actual.endMs !== expected.endMs; });
    if (mappingFailures.length || new Set(questions.map((question: any) => question.content?.targetTurnId)).size !== questions.length) throw new Error(`TIMELINE_MAPPING_FAILURES=${mappingFailures.length}`);
    const preTranscript = await request(`/quizzes/${quizId}/transcript`, token);
    if (preTranscript.status !== 403) throw new Error(`PRE_REVEAL_TRANSCRIPT=${preTranscript.status}`);
    const query = new URLSearchParams({ artifactId: String(artifact.id), v: String(artifact.version), checksum: artifact.checksumSha256 ?? '' });
    const audio = await Promise.all(questions.map(async (question: any) => ({ questionId: question.id, result: await request(`/quizzes/${quizId}/questions/${question.id}/audio?${query}`, token) })));
    if (audio.some((entry) => entry.result.status !== 200 || entry.result.headers.get('x-listening-audio-version') !== String(artifact.version))) throw new Error('QUESTION_AUDIO_CONTRACT_FAILED');
    const full = await request(`/quizzes/${quizId}/transcript/audio?${query}`, token);
    if (full.status !== 200 || full.headers.get('x-listening-audio-version') !== String(artifact.version)) throw new Error('FULL_AUDIO_CONTRACT_FAILED');
    const reveal = await request(`/quizzes/${quizId}/transcript/reveal`, token, { method: 'POST' });
    const transcript = await request(`/quizzes/${quizId}/transcript`, token);
    const items = (transcript.body?.data ?? transcript.body)?.items ?? [];
    const transcriptInvalid = items.some((item: any) => {
      const expected = timeline.get(item.turnId);
      return !item.transcript || !item.translation || !expected || item.startMs !== expected.startMs || item.endMs !== expected.endMs;
    });
    if (reveal.status !== 200 || transcript.status !== 200 || items.length !== timeline.size || transcriptInvalid) throw new Error(`REVEAL_CONTRACT_FAILED reveal=${reveal.status} transcript=${transcript.status} items=${items.length}`);
    console.log(JSON.stringify({ quizId, questionCount: questions.length, artifactVersion: artifact.version, preRevealLeakCount: leaks.length, timingMappings: `${questions.length}/${timeline.size}`, preRevealTranscriptStatus: preTranscript.status, questionAudioCount: audio.length, transcriptCount: items.length, API_RUNTIME_PASS: true }));
  } finally { if (userId) await prisma.user.delete({ where: { id: userId } }); await prisma.$disconnect(); }
}

void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
