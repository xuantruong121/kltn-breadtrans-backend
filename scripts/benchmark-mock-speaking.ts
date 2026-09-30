/**
 * MOCK BULLMQ INTEGRATION BENCHMARK FOR BREADTRANS SPEAKING ASSESSMENT (PHASE 1)
 *
 * Measures queue waiting time, execution time, and end-to-end sojourn time
 * under bounded concurrency with real BullMQ and Redis connections.
 * Strictly uses MockSpeakingEvaluator to protect paid Azure Speech quotas.
 */
import { Worker, Queue, Job } from 'bullmq';
import IORedis from 'ioredis';
import { MockSpeakingEvaluator } from '../src/modules/speaking/mock-speaking-evaluator';
import {
  SPEAKING_QUEUE_NAME,
  SPEAKING_JOB_NAME,
  SpeakingJobPayload,
  getSpeakingJobId,
  getSpeakingWorkerConfig,
  getLeaseTimeoutMs,
} from '../src/modules/speaking/speaking.constants';

interface JobTimingRecord {
  submissionId: number;
  enqueueTime: number;
  workerStartTime: number;
  completionTime: number;
  queueWaitMs: number;
  executionMs: number;
  sojournMs: number;
}

interface BenchmarkMetrics {
  scenarioName: string;
  totalSubmissions: number;
  concurrency: number;
  wallClockMs: number;
  throughputPerSec: number;
  maxObservedConcurrency: number;
  queueWaitP50: number;
  queueWaitP95: number;
  queueWaitP99: number;
  executionP50: number;
  executionP95: number;
  executionP99: number;
  sojournP50: number;
  sojournP95: number;
  sojournP99: number;
  successCount: number;
  failureCount: number;
}

function calculatePercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

async function runScenario(
  scenarioName: string,
  totalSubmissions: number,
  concurrency: number,
  simulatedDelayMs: number,
): Promise<BenchmarkMetrics> {
  process.env.MOCK_AZURE_SPEECH = 'true';
  process.env.MOCK_AZURE_DELAY_MS = String(simulatedDelayMs);

  const testQueueName = `${SPEAKING_QUEUE_NAME}-bench-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  const workerConfig = getSpeakingWorkerConfig();
  const leaseTimeoutMs = getLeaseTimeoutMs(workerConfig.jobTimeoutMs);

  // Production Queue options
  const queue = new Queue<SpeakingJobPayload>(testQueueName, {
    connection,
    defaultJobOptions: {
      removeOnComplete: { age: 86400, count: 500 },
      removeOnFail: { age: 7 * 86400, count: 500 },
    },
  });

  let activeWorkers = 0;
  let maxObservedConcurrency = 0;
  let successCount = 0;
  let failureCount = 0;
  const jobRecords: JobTimingRecord[] = [];
  const enqueueTimestamps = new Map<number, number>();

  const completionPromise = new Promise<void>((resolve) => {
    let completedCount = 0;

    // Production Worker options
    const worker = new Worker<SpeakingJobPayload>(
      testQueueName,
      async (job: Job<SpeakingJobPayload>) => {
        activeWorkers++;
        if (activeWorkers > maxObservedConcurrency) {
          maxObservedConcurrency = activeWorkers;
        }

        const tWorkerStart = Date.now();
        const tEnqueue = enqueueTimestamps.get(job.data.submissionId) || tWorkerStart;

        try {
          const dummyBuffer = Buffer.alloc(100);
          await MockSpeakingEvaluator.evaluate('Sample target sentence', dummyBuffer);
          const tCompletion = Date.now();

          jobRecords.push({
            submissionId: job.data.submissionId,
            enqueueTime: tEnqueue,
            workerStartTime: tWorkerStart,
            completionTime: tCompletion,
            queueWaitMs: tWorkerStart - tEnqueue,
            executionMs: tCompletion - tWorkerStart,
            sojournMs: tCompletion - tEnqueue,
          });

          successCount++;
        } catch {
          failureCount++;
        } finally {
          activeWorkers--;
          completedCount++;
          if (completedCount >= totalSubmissions) {
            resolve();
          }
        }
      },
      {
        connection,
        concurrency,
        limiter: {
          max: 50,
          duration: 1000,
        },
        lockDuration: leaseTimeoutMs,
        stalledInterval: leaseTimeoutMs,
      },
    );

    (queue as any).__worker = worker;
  });

  const tStartAll = Date.now();

  // Enqueue all jobs using production job ID builder and record exact enqueue timestamps
  for (let i = 1; i <= totalSubmissions; i++) {
    const tNow = Date.now();
    enqueueTimestamps.set(i, tNow);
    const customJobId = getSpeakingJobId(i);

    // Assert that custom job ID does NOT contain colons
    if (customJobId.includes(':')) {
      throw new Error(`Production custom job ID "${customJobId}" contains forbidden colon separator.`);
    }

    const job = await queue.add(
      SPEAKING_JOB_NAME,
      {
        submissionId: i,
        traceId: `bench-trace-${i}`,
      },
      {
        jobId: customJobId,
      },
    );

    // Verify BullMQ accepted the custom deterministic job ID verbatim
    if (job.id !== customJobId) {
      throw new Error(`BullMQ rejected custom job ID. Expected "${customJobId}", got "${job.id}"`);
    }
  }

  // Await completion of all jobs in queue
  await completionPromise;
  const wallClockMs = Date.now() - tStartAll;

  // Cleanup worker and queue
  const worker = (queue as any).__worker;
  await worker.close();
  await queue.obliterate({ force: true });
  await queue.close();
  await connection.quit();

  const sortedQueueWait = jobRecords.map((r) => r.queueWaitMs).sort((a, b) => a - b);
  const sortedExecution = jobRecords.map((r) => r.executionMs).sort((a, b) => a - b);
  const sortedSojourn = jobRecords.map((r) => r.sojournMs).sort((a, b) => a - b);

  return {
    scenarioName,
    totalSubmissions,
    concurrency,
    wallClockMs,
    throughputPerSec: totalSubmissions / (wallClockMs / 1000),
    maxObservedConcurrency,
    queueWaitP50: calculatePercentile(sortedQueueWait, 50),
    queueWaitP95: calculatePercentile(sortedQueueWait, 95),
    queueWaitP99: calculatePercentile(sortedQueueWait, 99),
    executionP50: calculatePercentile(sortedExecution, 50),
    executionP95: calculatePercentile(sortedExecution, 95),
    executionP99: calculatePercentile(sortedExecution, 99),
    sojournP50: calculatePercentile(sortedSojourn, 50),
    sojournP95: calculatePercentile(sortedSojourn, 95),
    sojournP99: calculatePercentile(sortedSojourn, 99),
    successCount,
    failureCount,
  };
}

async function main() {
  console.log('========================================================================');
  console.log('  BREADTRANS SPEAKING ASSESSMENT: MOCK BULLMQ INTEGRATION BENCHMARK');
  console.log('  Classification: MOCK BULLMQ INTEGRATION BENCHMARK (Simulated Evaluator, 120ms/req)');
  console.log('  Latency dimensions: Queue Wait, Execution, End-to-End Sojourn');
  console.log('========================================================================\n');

  // Verify production Job ID format
  const sampleJobId = getSpeakingJobId(999);
  console.log(`[Job ID Verification] Sample Job ID: ${sampleJobId}`);
  if (sampleJobId.includes(':')) {
    throw new Error('FAILED: Job ID contains colon!');
  }
  console.log('[Job ID Verification] PASSED: No colon separator present.\n');

  const results: BenchmarkMetrics[] = [];

  // Scenario 1: 1 submission, Concurrency=1
  console.log('Running Scenario 1: 1 submission (Concurrency = 1)...');
  results.push(await runScenario('1 sub (C=1)', 1, 1, 120));

  // Scenario 2: 10 submissions, Concurrency=1
  console.log('Running Scenario 2: 10 submissions (Concurrency = 1)...');
  results.push(await runScenario('10 sub (C=1)', 10, 1, 120));

  // Scenario 3: 10 submissions, Concurrency=2
  console.log('Running Scenario 3: 10 submissions (Concurrency = 2)...');
  results.push(await runScenario('10 sub (C=2)', 10, 2, 120));

  // Scenario 4: 50 submissions, Concurrency=5
  console.log('Running Scenario 4: 50 submissions (Concurrency = 5)...');
  results.push(await runScenario('50 sub (C=5)', 50, 5, 120));

  console.log('\n========================================================================');
  console.log('  MOCK BULLMQ INTEGRATION BENCHMARK RESULTS');
  console.log('========================================================================');
  console.table(
    results.map((r) => ({
      Scenario: r.scenarioName,
      Jobs: r.totalSubmissions,
      'Cfg C': r.concurrency,
      'Obs Peak C': r.maxObservedConcurrency,
      'Total Wall': `${r.wallClockMs} ms`,
      Throughput: `${r.throughputPerSec.toFixed(2)}/s`,
      'Q Wait P50': `${r.queueWaitP50} ms`,
      'Q Wait P95': `${r.queueWaitP95} ms`,
      'Exec P50': `${r.executionP50} ms`,
      'Exec P95': `${r.executionP95} ms`,
      'Sojourn P50': `${r.sojournP50} ms`,
      'Sojourn P95': `${r.sojournP95} ms`,
      'Sojourn P99': `${r.sojournP99} ms`,
    })),
  );

  console.log('\nBounded Concurrency Verification:');
  for (const r of results) {
    const passed = r.maxObservedConcurrency <= r.concurrency;
    console.log(
      `  [${passed ? 'PASS' : 'FAIL'}] ${r.scenarioName}: Max observed (${r.maxObservedConcurrency}) <= configured limit (${r.concurrency})`,
    );
  }
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
