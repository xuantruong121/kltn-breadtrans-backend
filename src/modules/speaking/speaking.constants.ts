export const SPEAKING_QUEUE_NAME = 'breadtrans-speaking-assessment';
export const SPEAKING_JOB_NAME = 'speaking-assessment-job';

export const SPEAKING_EVENTS_CHANNEL = 'breadtrans:speaking:events';
export const SPEAKING_COMPLETED_EVENT = 'speaking.completed';
export const SPEAKING_FAILED_EVENT = 'speaking.failed';

export interface SpeakingJobPayload {
  submissionId: number;
  traceId: string;
}

export interface SpeakingEventPayload {
  type: typeof SPEAKING_COMPLETED_EVENT | typeof SPEAKING_FAILED_EVENT;
  userId: number;
  submissionId: number;
  traceId: string;
}

export const getSpeakingJobId = (submissionId: number): string =>
  `speaking-assessment-${submissionId}`;

export const LEASE_SAFETY_MARGIN_MS = 15000;
export const getLeaseTimeoutMs = (jobTimeoutMs: number = 20000): number =>
  jobTimeoutMs + LEASE_SAFETY_MARGIN_MS;

export interface SpeakingWorkerConfig {
  concurrency: number;
  rateLimitMax: number;
  rateLimitDurationMs: number;
  jobTimeoutMs: number;
}

export function getSpeakingWorkerConfig(): SpeakingWorkerConfig {
  const concurrencyRaw = parseInt(
    process.env.SPEAKING_WORKER_CONCURRENCY || '1',
    10,
  );
  const concurrency =
    Number.isInteger(concurrencyRaw) &&
    concurrencyRaw >= 1 &&
    concurrencyRaw <= 20
      ? concurrencyRaw
      : 1;

  const rateLimitMaxRaw = parseInt(
    process.env.SPEAKING_WORKER_RATE_LIMIT_MAX || '1',
    10,
  );
  const rateLimitMax =
    Number.isInteger(rateLimitMaxRaw) &&
    rateLimitMaxRaw >= 1 &&
    rateLimitMaxRaw <= 50
      ? rateLimitMaxRaw
      : 1;

  const rateLimitDurationMsRaw = parseInt(
    process.env.SPEAKING_WORKER_RATE_LIMIT_DURATION_MS || '1000',
    10,
  );
  const rateLimitDurationMs =
    Number.isInteger(rateLimitDurationMsRaw) && rateLimitDurationMsRaw >= 100
      ? rateLimitDurationMsRaw
      : 1000;

  const jobTimeoutMsRaw = parseInt(
    process.env.SPEAKING_JOB_TIMEOUT_MS || '20000',
    10,
  );
  const jobTimeoutMs =
    Number.isInteger(jobTimeoutMsRaw) && jobTimeoutMsRaw >= 5000
      ? jobTimeoutMsRaw
      : 20000;

  return { concurrency, rateLimitMax, rateLimitDurationMs, jobTimeoutMs };
}
