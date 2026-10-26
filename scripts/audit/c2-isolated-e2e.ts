/**
 * Phase C2 isolated HTTP end-to-end run of the productive pipeline.
 *
 * REAL: DiagnosticController over HTTP (supertest), DiagnosticService,
 * DiagnosticSpeakingService, DiagnosticWritingService, BullMQ queues and
 * workers, DiagnosticSpeakingAudioNormalizer with ffmpeg-static on encoded
 * audio, Prisma on PostgreSQL 15.
 * FAKE: object storage (in memory, nothing reaches R2), the rubric grader (no
 * Azure, no Gemini), gamification, and authentication - a guard confined to
 * this testing module that reads the learner id from a header. No JWT is
 * created and the running application is never contacted.
 *
 * Targets: a disposable PostgreSQL clone and a disposable Redis. Both are
 * verified before anything runs; the protected clusters and the shared Redis
 * on 6379 - where the running application's workers listen on the same queue
 * names - are refused.
 *
 * Usage: C2_DB_URL=... C2_REDIS_URL=redis://localhost:6390 npx ts-node --transpile-only scripts/audit/c2-isolated-e2e.ts
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CanActivate,
  ExecutionContext,
  INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import ffmpegPath from 'ffmpeg-static';
import IORedis from 'ioredis';
import request from 'supertest';

const PROTECTED = ['7674533776495505443', '7699757546958700579'];
const DB_URL = process.env.C2_DB_URL ?? '';
const REDIS_URL = process.env.C2_REDIS_URL ?? '';

let failures = 0;
const ok = (name: string, cond: boolean, detail = '') => {
  console.log(
    `${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`,
  );
  if (!cond) failures += 1;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(
  fn: () => Promise<T>,
  done: (v: T) => boolean,
  ms = 30_000,
) {
  const until = Date.now() + ms;
  let v = await fn();
  while (!done(v) && Date.now() < until) {
    await sleep(200);
    v = await fn();
  }
  return v;
}

async function guardTargets() {
  const probe = new PrismaClient({ datasources: { db: { url: DB_URL } } });
  const [id] = await probe.$queryRawUnsafe<any[]>(
    `SELECT current_database() AS db, (SELECT system_identifier::text FROM pg_control_system()) AS sysid`,
  );
  await probe.$disconnect();
  if (
    PROTECTED.includes(id.sysid) ||
    ['kltn_db', 'kltn_shadow'].includes(id.db)
  )
    throw new Error('REFUSED: protected database');
  const port = new URL(REDIS_URL).port;
  if (!port || port === '6379')
    throw new Error(
      'REFUSED: the shared Redis on 6379 is used by the running application',
    );
  const redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: 1 });
  const keys = await redis.dbsize();
  await redis.quit();
  console.log(
    `targets: db=${id.db} sysid=${id.sysid}  redis port=${port} keys=${keys}`,
  );
}

function tone(dir: string, name: string, seconds: number) {
  const out = join(dir, name);
  execFileSync(ffmpegPath as string, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=330:sample_rate=48000:duration=${seconds}`,
    '-ac',
    '1',
    '-c:a',
    'libopus',
    '-b:a',
    '32k',
    out,
  ]);
  return readFileSync(out);
}

async function main() {
  if (!DB_URL || !REDIS_URL)
    throw new Error('C2_DB_URL and C2_REDIS_URL are required');
  await guardTargets();
  // The services read these when constructed and initialised.
  process.env.DATABASE_URL = DB_URL;
  process.env.REDIS_URL = REDIS_URL;

  /* eslint-disable @typescript-eslint/no-require-imports */
  const { PrismaService } = require('../../src/prisma/prisma.service');
  const {
    DiagnosticController,
  } = require('../../src/modules/diagnostic/diagnostic.controller');
  const {
    DiagnosticService,
  } = require('../../src/modules/diagnostic/diagnostic.service');
  const {
    DiagnosticSpeakingService,
  } = require('../../src/modules/diagnostic/diagnostic-speaking.service');
  const {
    DiagnosticWritingService,
  } = require('../../src/modules/diagnostic/diagnostic-writing.service');
  const {
    DiagnosticSpeakingAudioNormalizer,
  } = require('../../src/modules/diagnostic/diagnostic-speaking-audio-normalizer');
  const {
    DIAGNOSTIC_RUBRIC_GRADER,
  } = require('../../src/modules/diagnostic/diagnostic-productive');
  const { UploadService } = require('../../src/modules/upload/upload.service');
  const { AiService } = require('../../src/modules/ai/ai.service');
  const {
    GamificationService,
  } = require('../../src/modules/gamification/gamification.service');
  const {
    JwtAuthGuard,
  } = require('../../src/modules/auth/guards/jwt-auth.guard');
  /* eslint-enable @typescript-eslint/no-require-imports */

  // Typed as the client it extends: the require() above yields `any`.
  const prisma: PrismaClient = new PrismaService();

  // ------------------------------------------- synthetic runnable assessment
  // Built from the approved Speaking and Writing rows of the imported DRAFT,
  // inside the disposable clone only. The clone's legacy form is archived so
  // the single-active constraint admits this one; kltn_db is not involved.
  const draftRows = await prisma.diagnosticQuestion.findMany({
    where: {
      assessmentId: 5,
      taskType: { in: ['SPEAKING_RESPONSE', 'WRITING_RESPONSE'] },
    },
    orderBy: { order: 'asc' },
  });
  // Re-runnable: archive whatever is active in the clone before creating.
  await prisma.diagnosticAssessment.updateMany({
    where: { isActive: true },
    data: { isActive: false, status: 'ARCHIVED' },
  });
  const synthetic = await prisma.diagnosticAssessment.create({
    data: {
      title: 'C2 synthetic productive form',
      isActive: true,
      status: 'ACTIVE',
      scoringVersion: 'OBJECTIVE_POOLED_V1',
      blueprintVersion: 'C2_SYNTHETIC',
      sourceKey: `C2_SYNTHETIC_${Date.now()}`,
      questions: {
        create: [
          ...[1, 2].map((n) => ({
            skill: 'Grammar',
            question: `Synthetic objective ${n}`,
            options: {
              values: ['alpha', 'beta', 'gamma', 'delta'],
              questionType: 'MCQ',
              section: 'LANGUAGE_USE',
              stableKey: `C2_MCQ_${n}`,
            },
            correctIndex: 1,
            order: n,
            taskType: 'MCQ' as const,
          })),
          ...draftRows.map((q, i) => ({
            skill: q.skill,
            question: q.question,
            instructions: q.instructions,
            options: q.options as object,
            correctIndex: q.correctIndex,
            order: 10 + i,
            taskType: q.taskType,
            skillCode: q.skillCode,
            prepSeconds: q.prepSeconds,
            responseSeconds: q.responseSeconds,
            wordMin: q.wordMin,
            wordMax: q.wordMax,
            rubricId: q.rubricId,
          })),
        ],
      },
    },
    include: { questions: { orderBy: { order: 'asc' } } },
  });
  const SID = synthetic.id;
  const byType = (t: string) =>
    synthetic.questions.filter((q: any) => q.taskType === t);
  const [spk1, spk2] = byType('SPEAKING_RESPONSE');
  const [wrt1, wrt2] = byType('WRITING_RESPONSE');
  const mcqs = byType('MCQ');
  console.log(
    `synthetic assessment ${SID}: speaking ${spk1.responseSeconds}s/${spk2.responseSeconds}s, writing ${wrt1.wordMin}-${wrt1.wordMax}/${wrt2.wordMin}-${wrt2.wordMax}`,
  );

  // ------------------------------------------------------------ fakes
  const objects = new Map<string, Buffer>();
  const upload = {
    putPrivateObjectAtKey: (k: string, b: Buffer) => (
      objects.set(k, b),
      Promise.resolve()
    ),
    deleteFile: (k: string) => (objects.delete(k), Promise.resolve()),
    downloadPrivateFileBuffer: (k: string) =>
      objects.has(k)
        ? Promise.resolve(objects.get(k))
        : Promise.reject(new Error('no object')),
    getPrivatePresignedDownloadUrl: (k: string) =>
      Promise.resolve(`memory://${k}`),
  };
  const graderCalls: Array<{ skill: string; ref: string }> = [];
  const failRefs = new Set<string>();
  const grader = {
    provider: 'c2-fake',
    providerVersion: 'c2-fake-1',
    grade: (req: any) => {
      graderCalls.push({ skill: req.skill, ref: req.submissionRef });
      if ([...failRefs].some((f) => req.submissionRef.startsWith(f)))
        return Promise.reject(new Error('provider down'));
      const keys = req.rubric.criteria.map((c: any) => c.key);
      return Promise.resolve({
        submissionRef: req.submissionRef,
        criteria: Object.fromEntries(
          keys.map((k: string, i: number) => [k, (i % 3) + 2]),
        ),
        feedback: `Fake ${req.skill} feedback.`,
        suggestions: ['Fake suggestion.'],
        transcript: req.skill === 'SPEAKING' ? 'fake transcript' : undefined,
      });
    },
  };
  class HeaderTestGuard implements CanActivate {
    canActivate(ctx: ExecutionContext) {
      const req = ctx.switchToHttp().getRequest();
      const id = Number(req.headers['x-c2-test-user']);
      if (!Number.isInteger(id) || id <= 0) return false;
      req.user = { id };
      return true;
    }
  }

  const moduleRef = await Test.createTestingModule({
    controllers: [DiagnosticController],
    providers: [
      DiagnosticService,
      DiagnosticSpeakingService,
      DiagnosticWritingService,
      DiagnosticSpeakingAudioNormalizer,
      { provide: PrismaService, useValue: prisma },
      { provide: UploadService, useValue: upload },
      { provide: AiService, useValue: {} },
      {
        provide: GamificationService,
        useValue: { awardBanh: () => Promise.resolve({ granted: 50 }) },
      },
      { provide: DIAGNOSTIC_RUBRIC_GRADER, useValue: grader },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useClass(HeaderTestGuard)
    .compile();
  const app: INestApplication = moduleRef.createNestApplication({
    logger: ['error'],
  });
  await app.init();
  const http = () => request(app.getHttpServer());
  const students = await prisma.user.findMany({
    where: { role: 'STUDENT' },
    orderBy: { id: 'asc' },
    take: 2,
  });
  const [A, B] = students.map((s: any) => String(s.id));

  const dir = mkdtempSync(join(tmpdir(), 'c2-e2e-'));
  try {
    const audio44 = tone(dir, 'a44.webm', 44.5);
    const audio50 = tone(dir, 'a50.webm', 50);
    const audio59 = tone(dir, 'a59.webm', 59);
    const audio58 = tone(dir, 'a58.webm', 58);
    const confirm = (
      user: string,
      aid: number,
      qid: number,
      buf: Buffer,
      ms: number,
    ) =>
      http()
        .post(`/diagnostic/${SID}/attempts/${aid}/speaking/${qid}/confirm`)
        .set('x-c2-test-user', user)
        .field('durationMs', String(ms))
        .attach('audio', buf, {
          filename: 'r.webm',
          contentType: 'audio/webm',
        });

    // ------------------------------------------------ delivery and start
    const current = await http()
      .get('/diagnostic/current')
      .set('x-c2-test-user', A);
    ok(
      'HTTP: unauthenticated request is refused',
      (await http().get('/diagnostic/current')).status === 403,
    );
    ok(
      'HTTP: current assessment is the synthetic runnable form',
      current.status === 200 && current.body.id === SID,
      `(status=${current.status} id=${current.body.id})`,
    );
    const served = (qid: number) =>
      current.body.questions.find((q: any) => q.id === qid);
    ok(
      'delivery: Speaking tasks carry their own response limits',
      served(spk1.id)?.responseSeconds === 45 &&
        served(spk2.id)?.responseSeconds === 60 &&
        served(spk1.id)?.prepSeconds === 15,
    );
    ok(
      'delivery: Writing tasks carry their word guidance',
      served(wrt1.id)?.wordMin === 60 && served(wrt2.id)?.wordMax === 130,
    );
    const start = await http()
      .post(`/diagnostic/${SID}/attempts/start`)
      .set('x-c2-test-user', A);
    const AID = start.body.attemptId;
    ok(
      'start creates an IN_PROGRESS attempt',
      start.status === 201 && start.body.status === 'IN_PROGRESS',
      `(attempt=${AID})`,
    );

    // ---------------------------------------------------- speaking upload
    const tooLong = await confirm(A, AID, spk1.id, audio50, 50_000);
    ok(
      'a real 50 s recording is refused on the 45 s task',
      tooLong.status === 400,
      `(${tooLong.body.message})`,
    );
    const lying = await confirm(A, AID, spk1.id, audio50, 44_000);
    ok(
      'a real 50 s recording claiming 44 s is still refused',
      lying.status === 400,
    );
    const s1 = await confirm(A, AID, spk1.id, audio44, 44_500);
    ok(
      'a real 44.5 s recording is accepted on the 45 s task',
      s1.status === 202 && s1.body.status === 'QUEUED',
      `(measured=${s1.body.durationMs} ms)`,
    );
    ok(
      'the decoded duration is what was stored',
      Math.abs(s1.body.durationMs - 44_500) <= 50,
    );
    const foreign = await confirm(B, AID, spk1.id, audio44, 44_500);
    ok(
      'another learner cannot upload into this attempt',
      foreign.status === 403,
    );
    const malformed = await http()
      .post(`/diagnostic/${SID}/attempts/${AID}/speaking/${spk2.id}/confirm`)
      .set('x-c2-test-user', A)
      .field('durationMs', '1000')
      .attach('audio', Buffer.from('not audio at all'), {
        filename: 'x.webm',
        contentType: 'audio/webm',
      });
    ok(
      'malformed media is refused',
      malformed.status === 400,
      `(${malformed.body.message})`,
    );
    const s2a = await confirm(A, AID, spk2.id, audio59, 59_000);
    const s2b = await confirm(A, AID, spk2.id, audio58, 58_000);
    ok(
      'a 59 s and then a re-recorded 58 s answer are accepted on the 60 s task',
      s2a.status === 202 && s2b.status === 202,
    );

    const speakingList = () =>
      http()
        .get(`/diagnostic/${SID}/attempts/${AID}/speaking`)
        .set('x-c2-test-user', A)
        .then((r) => r.body);
    const graded = await waitFor(
      speakingList,
      (rows: any[]) =>
        rows.length === 2 && rows.every((r) => r.status === 'GRADED'),
    );
    ok(
      'both Speaking tasks reach GRADED through the real queue and worker',
      graded.every((r: any) => r.status === 'GRADED'),
      `(${graded.map((r: any) => r.status).join('/')})`,
    );
    // Whether the first task-2 recording was graded before the re-recording
    // replaced it depends on worker timing, so the count is 2 or 3. What must
    // hold either way: the persisted row is the re-recording (checked below).
    // The late-stale-job case is asserted deterministically in the unit spec.
    const speakingCalls = graderCalls.filter(
      (c) => c.skill === 'SPEAKING',
    ).length;
    ok(
      'speaking grader calls bounded by accepted uploads (2 or 3)',
      speakingCalls === 2 || speakingCalls === 3,
      `(calls=${speakingCalls})`,
    );
    ok(
      'only the latest recording object is kept',
      objects.size === 2,
      `(objects=${objects.size})`,
    );
    const rowS2 = graded.find((r: any) => r.questionId === spk2.id);
    ok(
      'the graded task-2 response is the re-recording',
      Math.abs(rowS2.durationMs - 58_000) <= 50,
      `(${rowS2.durationMs})`,
    );
    ok(
      'speaking results carry rubric version, criteria and feedback',
      graded.every(
        (r: any) =>
          r.rubricVersion === 'SPK_RUBRIC_V3' && r.criteria && r.feedback,
      ),
    );
    ok(
      'no storage key in any learner payload',
      !JSON.stringify(graded).includes('premium/speaking'),
    );
    const otherAudio = await http()
      .get(`/diagnostic/speaking-responses/${graded[0].id}/audio`)
      .set('x-c2-test-user', B);
    const ownAudio = await http()
      .get(`/diagnostic/speaking-responses/${graded[0].id}/audio`)
      .set('x-c2-test-user', A);
    ok(
      "another learner cannot fetch this learner's audio",
      otherAudio.status === 403,
    );
    ok(
      'the owner gets a short-lived audio URL',
      ownAudio.status === 200 &&
        String(ownAudio.body.url).startsWith('memory://'),
    );

    // ------------------------------------------------------- submission
    failRefs.add('writing:');
    const answers: Record<string, unknown> = {
      [mcqs[0].id]: served(mcqs[0].id).options.indexOf('beta'),
      [mcqs[1].id]: served(mcqs[1].id).options.indexOf('alpha'),
      [wrt1.id]: Array.from({ length: 70 }, (_, i) => `w${i}`).join(' '),
      [wrt2.id]: Array.from({ length: 100 }, (_, i) => `v${i}`).join(' '),
    };
    const submit = await http()
      .post(`/diagnostic/${SID}/attempts`)
      .set('x-c2-test-user', A)
      .send({ answers, attemptId: AID });
    ok(
      'submission is accepted over HTTP',
      submit.status === 201,
      `(status=${submit.status} ${submit.body.message ?? ''})`,
    );
    ok(
      'objective grade stays correct: 1 of 2',
      submit.body.correctCount === 1,
      `(${submit.body.correctCount})`,
    );
    ok(
      'right after submission Writing is pending, and pending is not a zero',
      submit.body.productivePending === true &&
        submit.body.writingFeedback.every(
          (w: any) =>
            ['QUEUED', 'GRADING'].includes(w.status) && w.score === null,
        ),
    );
    ok(
      'speaking score is reported from GRADED tasks only',
      typeof submit.body.speakingScore === 'number',
    );

    const latest = () =>
      http()
        .get('/diagnostic/results/latest')
        .set('x-c2-test-user', A)
        .then((r) => r.body);
    const afterFail = await waitFor(latest, (b: any) =>
      b?.writingFeedback?.every((w: any) => w.status === 'GRADING_FAILED'),
    );
    ok(
      'a provider outage leaves both Writing tasks GRADING_FAILED, not zero',
      afterFail.writingFeedback.every(
        (w: any) => w.status === 'GRADING_FAILED' && w.score === null,
      ),
      `(${afterFail.writingFeedback.map((w: any) => w.status).join('/')})`,
    );
    ok(
      'the failed state is not reported as pending',
      afterFail.productivePending === false,
    );

    failRefs.clear();
    const foreignRetry = await http()
      .post(`/diagnostic/${SID}/attempts/${AID}/writing/${wrt1.id}/retry`)
      .set('x-c2-test-user', B);
    ok(
      "another learner cannot retry this learner's writing",
      foreignRetry.status === 403,
    );
    const retries = await Promise.all([
      http()
        .post(`/diagnostic/${SID}/attempts/${AID}/writing/${wrt1.id}/retry`)
        .set('x-c2-test-user', A),
      http()
        .post(`/diagnostic/${SID}/attempts/${AID}/writing/${wrt1.id}/retry`)
        .set('x-c2-test-user', A),
    ]);
    ok(
      'two concurrent retries: one accepted, one refused',
      retries
        .map((r) => r.status)
        .sort()
        .join(',') === '202,409',
      `(${retries.map((r) => r.status).join(',')})`,
    );
    await http()
      .post(`/diagnostic/${SID}/attempts/${AID}/writing/${wrt2.id}/retry`)
      .set('x-c2-test-user', A);
    const done = await waitFor(latest, (b: any) =>
      b?.writingFeedback?.every((w: any) => w.status === 'GRADED'),
    );
    ok(
      'after retry both Writing tasks are GRADED with rubric criteria',
      done.writingFeedback.every(
        (w: any) =>
          w.status === 'GRADED' &&
          w.criteria &&
          w.rubricVersion === 'WRT_RUBRIC_V3' &&
          typeof w.score === 'number',
      ),
    );
    ok(
      'word counts were computed server-side',
      done.writingFeedback.map((w: any) => w.wordCount).join(',') === '70,100',
    );
    ok(
      'nothing is pending once every task is graded',
      done.productivePending === false,
    );
    const regrade = await http()
      .post(`/diagnostic/${SID}/attempts/${AID}/writing/${wrt1.id}/retry`)
      .set('x-c2-test-user', A);
    ok('a GRADED Writing task cannot be re-queued', regrade.status === 409);

    const writingRows = await prisma.diagnosticWritingResponse.findMany({
      where: { attemptId: AID },
    });
    ok('exactly one Writing row per task', writingRows.length === 2);
    ok(
      'writing runs: task 1 graded on run 2 despite two concurrent retries',
      writingRows.find((r: any) => r.questionId === wrt1.id)
        ?.gradingAttempts === 2,
    );

    const attemptBefore = await prisma.$queryRawUnsafe<any[]>(
      `SELECT xmin::text AS v FROM "DiagnosticAttempt" WHERE id = ${AID}`,
    );
    const replay = await http()
      .post(`/diagnostic/${SID}/attempts`)
      .set('x-c2-test-user', A)
      .send({ answers, attemptId: AID });
    const attemptAfter = await prisma.$queryRawUnsafe<any[]>(
      `SELECT xmin::text AS v FROM "DiagnosticAttempt" WHERE id = ${AID}`,
    );
    ok(
      'a replayed submission returns the recorded result and rewrites nothing',
      replay.status === 201 && attemptBefore[0].v === attemptAfter[0].v,
    );
    ok(
      'no extra Writing rows after the replay',
      (await prisma.diagnosticWritingResponse.count({
        where: { attemptId: AID },
      })) === 2,
    );
    const late = await confirm(A, AID, spk1.id, audio44, 44_500);
    ok('a recording after submission is refused', late.status === 400);

    // ----------------------------------------------- speaking failure + retry
    const startB = await http()
      .post(`/diagnostic/${SID}/attempts/start`)
      .set('x-c2-test-user', B);
    const BID = startB.body.attemptId;
    failRefs.add('speaking:');
    await confirm(B, BID, spk1.id, audio44, 44_500);
    const bList = () =>
      http()
        .get(`/diagnostic/${SID}/attempts/${BID}/speaking`)
        .set('x-c2-test-user', B)
        .then((r) => r.body);
    const bFailed = await waitFor(
      bList,
      (rows: any[]) => rows[0]?.status === 'GRADING_FAILED',
    );
    ok(
      'a Speaking provider outage leaves GRADING_FAILED with no score',
      bFailed[0]?.status === 'GRADING_FAILED' && bFailed[0]?.score === null,
      `(${bFailed[0]?.failureReason})`,
    );
    failRefs.clear();
    ok(
      "another learner cannot retry this learner's speaking",
      (
        await http()
          .post(`/diagnostic/${SID}/attempts/${BID}/speaking/${spk1.id}/retry`)
          .set('x-c2-test-user', A)
      ).status === 403,
    );
    const bRetry = await http()
      .post(`/diagnostic/${SID}/attempts/${BID}/speaking/${spk1.id}/retry`)
      .set('x-c2-test-user', B);
    ok('speaking retry is accepted', bRetry.status === 202);
    const bDone = await waitFor(
      bList,
      (rows: any[]) => rows[0]?.status === 'GRADED',
    );
    ok('the retried recording is GRADED', bDone[0]?.status === 'GRADED');

    // ------------------------------------------------------------ DRAFT
    ok(
      'DRAFT start refused over HTTP',
      (
        await http()
          .post('/diagnostic/5/attempts/start')
          .set('x-c2-test-user', A)
      ).status === 404,
    );
    ok(
      'DRAFT submission refused over HTTP',
      (
        await http()
          .post('/diagnostic/5/attempts')
          .set('x-c2-test-user', A)
          .send({ answers: {}, attemptId: AID })
      ).status === 404,
    );
    ok(
      'no attempt exists on the DRAFT',
      (await prisma.diagnosticAttempt.count({ where: { assessmentId: 5 } })) ===
        0,
    );

    console.log(
      `grader calls: ${JSON.stringify(graderCalls.reduce((m: any, c) => ((m[c.skill] = (m[c.skill] ?? 0) + 1), m), {}))}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await app.close();
    await prisma.$disconnect();
  }
  console.log(`\nC2_ISOLATED_E2E_FAILURES=${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(
    'C2 E2E ERROR:',
    e?.stack?.split('\n').slice(0, 4).join(' | ') ?? e,
  );
  process.exit(2);
});
