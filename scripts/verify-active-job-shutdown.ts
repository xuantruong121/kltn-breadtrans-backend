/**
 * AUTOMATED ACTIVE-JOB GRACEFUL SHUTDOWN INTEGRATION TEST
 *
 * Verifies that when a worker process receives SIGTERM while an evaluation
 * job is actively running (simulated with MockSpeakingEvaluator delay >= 10s):
 * 1. The worker does NOT abort the active job.
 * 2. The worker stops accepting new jobs from Redis.
 * 3. The active job completes evaluation, commits COMPLETED to PostgreSQL, and grants gamification reward.
 * 4. The worker exits cleanly with exit code 0.
 * 5. Timestamp evidence proves SIGTERM was sent BEFORE evaluation completed.
 */
import { spawn } from 'child_process';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import {
  SPEAKING_QUEUE_NAME,
  SPEAKING_JOB_NAME,
  getSpeakingJobId,
} from '../src/modules/speaking/speaking.constants';

async function main() {
  console.log(
    '========================================================================',
  );
  console.log(
    '  TEST 1: ACTIVE-JOB GRACEFUL SHUTDOWN (DRAIN) INTEGRATION TEST',
  );
  console.log(
    '========================================================================\n',
  );

  const prisma = new PrismaClient();
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const redis = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue(SPEAKING_QUEUE_NAME, { connection: redis });

  let workerProcess: ReturnType<typeof spawn> | null = null;
  let testUserId = 0;
  let testExerciseId = 0;
  let sub1Id = 0;
  let sub2Id = 0;

  try {
    // 1. Find existing User & Exercise
    const user = await prisma.user.findFirst();
    if (!user) throw new Error('No user found in database');
    testUserId = user.id;

    const exercise = await prisma.speakingExercise.findFirst();
    if (!exercise) throw new Error('No exercise found in database');
    testExerciseId = exercise.id;

    // 2. Create Submission #1
    const sub1 = await prisma.speakingSubmission.create({
      data: {
        userId: testUserId,
        exerciseId: testExerciseId,
        status: 'PENDING',
        audioKey: 'mock-sample-shutdown-1',
        audioUrl: 'https://cdn.breadtrans.com/shutdown-sample-1.wav',
        durationMs: 3000,
        audioMimeType: 'audio/wav',
        submittedAt: new Date(),
      },
    });
    sub1Id = sub1.id;
    console.log(`[Setup] Created disposable Submission #1 (ID: ${sub1Id})`);

    // 3. Spawn Standalone Worker with MOCK_AZURE_DELAY_MS = 10000 (10 seconds)
    const workerMainPath = path.resolve(
      __dirname,
      '../dist/src/worker/speaking-worker.main.js',
    );
    console.log(
      `[Worker] Spawning worker with 10s evaluation delay: node ${workerMainPath}`,
    );

    workerProcess = spawn('node', [workerMainPath], {
      env: {
        ...process.env,
        MOCK_AZURE_SPEECH: 'true',
        SPEAKING_PIPELINE_MODE: 'bullmq',
        MOCK_AZURE_DELAY_MS: '10000',
        SPEAKING_WORKER_CONCURRENCY: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });

    let isWorkerReady = false;
    let workerLogs = '';

    workerProcess.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      workerLogs += text;
      process.stdout.write(`  [Worker stdout] ${text}`);
      if (text.includes('Standalone BreadTrans Speaking Worker is running')) {
        isWorkerReady = true;
      }
    });

    workerProcess.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      workerLogs += text;
      process.stderr.write(`  [Worker stderr] ${text}`);
    });

    // Wait up to 15s for worker ready
    const tStart = Date.now();
    while (!isWorkerReady && Date.now() - tStart < 15000) {
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!isWorkerReady) {
      throw new Error(
        `Worker failed to become ready within 15 seconds.\nCaptured output:\n${workerLogs}`,
      );
    }
    console.log('[Worker] Worker ready and awaiting jobs.\n');

    // 4. Enqueue Job #1
    const jobId1 = getSpeakingJobId(sub1Id);
    console.log(`[Queue] Enqueuing Job #1 (${jobId1})...`);
    const job1 = await queue.add(
      SPEAKING_JOB_NAME,
      { submissionId: sub1Id, traceId: `trace-shutdown-${Date.now()}` },
      { jobId: jobId1, removeOnComplete: false, removeOnFail: false },
    );

    // 5. Poll until Job #1 is ACTIVE and DB status is PROCESSING with workerId non-null
    console.log(
      '[Monitor] Waiting for Job #1 to enter PROCESSING state in DB with active workerId...',
    );
    let activeSub1: Awaited<
      ReturnType<typeof prisma.speakingSubmission.findUnique>
    > = null;
    let tActive = 0;
    const tWaitStart = Date.now();

    while (Date.now() - tWaitStart < 10000) {
      activeSub1 = await prisma.speakingSubmission.findUnique({
        where: { id: sub1Id },
      });
      const jobState = await job1.getState();

      if (
        activeSub1?.status === 'PROCESSING' &&
        activeSub1?.workerId &&
        jobState === 'active'
      ) {
        tActive = Date.now();
        console.log(
          `[Monitor] Job #1 is ACTIVE at ${new Date(tActive).toISOString()}`,
        );
        console.log(`  - DB Status: ${activeSub1.status}`);
        console.log(`  - Worker Token: ${activeSub1.workerId}`);
        console.log(
          `  - Processing Started At: ${activeSub1.processingStartedAt?.toISOString()}`,
        );
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    if (!tActive || activeSub1?.status !== 'PROCESSING') {
      throw new Error(
        `Submission #${sub1Id} never entered active PROCESSING state`,
      );
    }

    // 6. Wait 2 seconds into the 10-second evaluation, then send SIGTERM
    console.log(
      '\n[Action] Waiting 2000ms while evaluation is actively running...',
    );
    await new Promise((r) => setTimeout(r, 2000));

    const tSigterm = Date.now();
    console.log(
      `[Action] >>> SENDING SIGTERM TO WORKER AT ${new Date(tSigterm).toISOString()} (elapsed=${tSigterm - tActive}ms / delay=10000ms) <<<`,
    );

    // Concurrently create and enqueue Submission #2 to verify dying worker refuses new jobs
    const sub2 = await prisma.speakingSubmission.create({
      data: {
        userId: testUserId,
        exerciseId: testExerciseId,
        status: 'PENDING',
        audioKey: 'mock-sample-shutdown-2',
        audioUrl: 'https://cdn.breadtrans.com/shutdown-sample-2.wav',
        durationMs: 3000,
        audioMimeType: 'audio/wav',
        submittedAt: new Date(),
      },
    });
    sub2Id = sub2.id;
    const jobId2 = getSpeakingJobId(sub2Id);
    console.log(
      `[Queue] Enqueuing Job #2 (${jobId2}) immediately after SIGTERM to verify drain barrier...`,
    );
    const job2 = await queue.add(
      SPEAKING_JOB_NAME,
      { submissionId: sub2Id, traceId: `trace-shutdown-barrier-${Date.now()}` },
      { jobId: jobId2, removeOnComplete: false, removeOnFail: false },
    );

    // Send SIGTERM: on Windows use IPC message so Node runs graceful shutdown; on POSIX send signal
    if (process.platform === 'win32') {
      workerProcess.send('SIGTERM');
    } else {
      workerProcess.kill('SIGTERM');
    }

    // 7. Wait for worker process termination
    console.log(
      '[Monitor] Awaiting worker exit (must finish active job and exit with 0)...',
    );
    const exitResult = await new Promise<{
      code: number | null;
      signal: string | null;
    }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        workerProcess?.kill('SIGKILL');
        reject(
          new Error(
            'Worker process timed out during graceful shutdown (> 20s)',
          ),
        );
      }, 20000);

      workerProcess?.on('exit', (code, signal) => {
        clearTimeout(timeout);
        resolve({ code, signal });
      });
    });

    const tExit = Date.now();
    console.log(
      `[Monitor] Worker exited at ${new Date(tExit).toISOString()} with exit code ${exitResult.code} (signal=${exitResult.signal})`,
    );

    if (exitResult.code !== 0) {
      throw new Error(
        `Worker exited with unexpected non-zero code: ${exitResult.code}`,
      );
    }

    // 8. Verify Submission #1 terminal state in PostgreSQL
    const finalSub1 = await prisma.speakingSubmission.findUnique({
      where: { id: sub1Id },
    });
    if (!finalSub1) {
      throw new Error(`Submission #${sub1Id} not found in DB`);
    }

    console.log('\n[Verification] Checking Submission #1 DB State:');
    console.log(`  - Final Status: ${finalSub1.status} (Expected: COMPLETED)`);
    console.log(`  - Overall Score: ${finalSub1.overallScore} (Expected: 8.8)`);
    console.log(
      `  - Reward Granted At: ${finalSub1.rewardGrantedAt?.toISOString()} (Expected: non-null)`,
    );
    console.log(
      `  - Processed At: ${finalSub1.processedAt?.toISOString()} (Expected: non-null)`,
    );
    console.log(`  - Worker ID: ${finalSub1.workerId}`);

    if (finalSub1.status !== 'COMPLETED') {
      throw new Error(`Expected COMPLETED, got ${finalSub1.status}`);
    }
    if (finalSub1.overallScore === null || finalSub1.overallScore <= 0) {
      throw new Error(`Expected positive score, got ${finalSub1.overallScore}`);
    }
    if (!finalSub1.rewardGrantedAt) {
      throw new Error('Expected rewardGrantedAt to be non-null');
    }

    const tProcessed = finalSub1.processedAt
      ? finalSub1.processedAt.getTime()
      : 0;
    console.log(`\n[Timeline Proof]:`);
    console.log(
      `  1. Job entered PROCESSING at: ${new Date(tActive).toISOString()}`,
    );
    console.log(
      `  2. SIGTERM sent at:            ${new Date(tSigterm).toISOString()} (+${tSigterm - tActive}ms)`,
    );
    console.log(
      `  3. Evaluation committed at:    ${new Date(tProcessed).toISOString()} (+${tProcessed - tSigterm}ms after SIGTERM)`,
    );
    console.log(
      `  4. Worker process exited at:   ${new Date(tExit).toISOString()} (+${tExit - tProcessed}ms after commit)`,
    );

    if (tSigterm >= tProcessed) {
      throw new Error(
        `Invariant violated: SIGTERM (${tSigterm}) must precede evaluation completion (${tProcessed})`,
      );
    }

    // 9. Verify Submission #2 was NOT picked up by the shutting down worker
    const finalSub2 = await prisma.speakingSubmission.findUnique({
      where: { id: sub2Id },
    });
    const job2State = await job2.getState();

    console.log('\n[Verification] Checking Submission #2 Drain Barrier:');
    console.log(`  - Status in DB: ${finalSub2?.status} (Expected: PENDING)`);
    console.log(`  - Worker ID: ${finalSub2?.workerId} (Expected: null)`);
    console.log(`  - BullMQ Job State: ${job2State} (Expected: waiting)`);

    if (finalSub2?.status !== 'PENDING' || finalSub2?.workerId !== null) {
      throw new Error(
        `Drain barrier breached: dying worker picked up Submission #${sub2Id}`,
      );
    }
    if (job2State !== 'waiting') {
      throw new Error(
        `Expected Job #2 to remain in waiting state, but was ${job2State}`,
      );
    }

    // Clean up Job #2 from BullMQ
    await job2.remove();
    await job1.remove();

    console.log(
      '\n========================================================================',
    );
    console.log('  TEST 1 PASSED: ACTIVE-JOB GRACEFUL SHUTDOWN FULLY VERIFIED');
    console.log(
      '========================================================================',
    );
  } finally {
    if (workerProcess && workerProcess.exitCode === null) {
      workerProcess.kill('SIGKILL');
    }
    if (sub1Id) {
      await prisma.speakingSubmission
        .deleteMany({ where: { id: { in: [sub1Id, sub2Id].filter(Boolean) } } })
        .catch(() => {});
    }
    await queue.close();
    await redis.quit();
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('\n[FATAL] Test failed:', err);
  process.exit(1);
});
