import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { createHash } from 'crypto';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import Redis from 'ioredis';
import {
  AiTaskType,
  GeminiModelPolicy,
  GeminiModelRouter,
} from './gemini-model-router';

export type GeminiErrorClass =
  | 'RATE_LIMIT'
  | 'AUTH'
  | 'PROVIDER_TRANSIENT'
  | 'TIMEOUT'
  | 'INVALID_REQUEST'
  | 'MODEL_NOT_FOUND'
  | 'SAFETY'
  | 'MALFORMED_OUTPUT'
  | 'UNKNOWN';

type Credential = { value: string; fingerprint: string };
type ExecuteOptions<T> = {
  taskType: AiTaskType;
  /** `signal` aborts the HTTP request client-side when the deadline passes. */
  operation: (model: GenerativeModel, signal: AbortSignal) => Promise<T>;
  /** Response deadline for each request; default PROVIDER_TIMEOUT_MS. */
  timeoutMs?: number;
  /**
   * Whether a TIMEOUT moves on to the next key (default true). A timed-out
   * request may still be processed and billed by the provider, so callers
   * that must not pay twice for one answer pass false: the timeout then ends
   * the call. Definitive rejections (429, 401/403, 5xx) still fail over.
   */
  failoverOnTimeout?: boolean;
  onSuccess?: (
    result: T,
  ) => { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;
};

const MAX_ATTEMPTS = 3;
const PROVIDER_TIMEOUT_MS = 30_000;

export function parseGeminiApiKeys(
  primary?: string,
  fallback?: string,
): string[] {
  const raw = primary?.trim() ? primary : fallback || '';
  return Array.from(
    new Set(
      raw
        .split(/[,\r\n]+/)
        .map((key) => key.trim())
        .filter(Boolean),
    ),
  );
}

export function redactGeminiError(value: unknown): string {
  return String(value ?? 'unknown Gemini provider error')
    .replace(
      /([?&](?:key|api[_-]?key|authorization)=)[^&\s]+/gi,
      '$1[REDACTED]',
    )
    .replace(/(AIza)[A-Za-z0-9_-]+/g, '$1[REDACTED]')
    .replace(/(Bearer\s+)[^\s]+/gi, '$1[REDACTED]');
}

export function classifyGeminiError(error: any): GeminiErrorClass {
  const status = Number(
    error?.status ?? error?.statusCode ?? error?.response?.status,
  );
  const text = String(error?.message ?? error ?? '').toLowerCase();
  if (status === 429 || /resource_exhausted|quota|too many requests/.test(text))
    return 'RATE_LIMIT';
  if (
    status === 401 ||
    status === 403 ||
    /unauthenticated|permission denied|api key/.test(text)
  )
    return 'AUTH';
  if (status === 404 || /model.*not found|unsupported model/.test(text))
    return 'MODEL_NOT_FOUND';
  if (
    status >= 500 ||
    /unavailable|internal error|service unavailable/.test(text)
  )
    return 'PROVIDER_TRANSIENT';
  if (error?.name === 'AbortError' || /timeout|timed out|abort/.test(text))
    return 'TIMEOUT';
  if (status === 400 || /invalid argument|invalid request/.test(text))
    return 'INVALID_REQUEST';
  if (/safety|blocked/.test(text)) return 'SAFETY';
  return 'UNKNOWN';
}

@Injectable()
export class GeminiCredentialManager {
  private readonly logger = new Logger(GeminiCredentialManager.name);
  private readonly credentials: Credential[];

  constructor(
    private readonly router: GeminiModelRouter,
    @Optional() @InjectRedis() private readonly redis?: Redis,
  ) {
    this.credentials = parseGeminiApiKeys(
      process.env.GEMINI_API_KEYS,
      process.env.GEMINI_API_KEY,
    ).map((value) => ({
      value,
      fingerprint: createHash('sha256')
        .update(value)
        .digest('hex')
        .slice(0, 12),
    }));
  }

  hasCredentials(): boolean {
    return this.credentials.length > 0;
  }

  private cooldownKey(fingerprint: string) {
    return `gemini:credential:${fingerprint}:cooldown`;
  }
  private async isCoolingDown(credential: Credential): Promise<boolean> {
    return Boolean(
      await this.redis?.get(this.cooldownKey(credential.fingerprint)),
    );
  }
  private async setCooldown(
    credential: Credential,
    errorClass: GeminiErrorClass,
    seconds: number,
  ) {
    if (this.redis)
      await this.redis.set(
        this.cooldownKey(credential.fingerprint),
        errorClass,
        'EX',
        seconds,
      );
  }
  private cooldownSeconds(errorClass: GeminiErrorClass): number {
    switch (errorClass) {
      case 'AUTH':
        return 60 * 60;
      case 'RATE_LIMIT':
        return 60;
      case 'PROVIDER_TRANSIENT':
        return 15;
      case 'TIMEOUT':
        return 10;
      default:
        return 0;
    }
  }
  private async nextCredentials(): Promise<Credential[]> {
    if (!this.credentials.length) return [];
    const slot = this.redis
      ? await this.redis.incr('gemini:credential:round-robin')
      : Date.now();
    const start = Math.abs(slot) % this.credentials.length;
    const ordered = this.credentials.map(
      (_, index) => this.credentials[(start + index) % this.credentials.length],
    );
    const healthy: Credential[] = [];
    for (const credential of ordered)
      if (!(await this.isCoolingDown(credential))) healthy.push(credential);
    return healthy;
  }
  private async telemetry(input: {
    taskType: AiTaskType;
    policy: GeminiModelPolicy;
    fingerprint?: string;
    outcome: 'success' | 'failure';
    errorClass?: GeminiErrorClass;
    latencyMs: number;
    retryCount: number;
    usage?: { promptTokenCount?: number; candidatesTokenCount?: number };
  }) {
    if (!this.redis) return;
    const base = `gemini:telemetry:${input.taskType}:${input.policy.model}`;
    const pipeline = this.redis.pipeline();
    pipeline.incr('gemini:telemetry:total_requests');
    pipeline.incr(`${base}:${input.outcome}`);
    pipeline.incrby(
      `${base}:latency_ms`,
      Math.max(0, Math.round(input.latencyMs)),
    );
    pipeline.incrby(`${base}:retries`, input.retryCount);
    if (input.errorClass) pipeline.incr(`${base}:error:${input.errorClass}`);
    if (input.fingerprint)
      pipeline.incr(`${base}:key:${input.fingerprint}:${input.outcome}`);
    if (input.usage?.promptTokenCount)
      pipeline.incrby(
        'gemini:telemetry:input_tokens',
        input.usage.promptTokenCount,
      );
    if (input.usage?.candidatesTokenCount)
      pipeline.incrby(
        'gemini:telemetry:output_tokens',
        input.usage.candidatesTokenCount,
      );
    await pipeline.exec();
  }

  private async withinTimeout<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    timeoutMs = PROVIDER_TIMEOUT_MS,
  ): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    // Aborting stops waiting and closes the HTTP request on our side only;
    // the provider may still finish (and bill) it. Its late result is never
    // read: this race has already settled.
    const controller = new AbortController();
    try {
      return await Promise.race([
        operation(controller.signal),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            const error = new Error('Gemini provider request timed out');
            error.name = 'AbortError';
            reject(error);
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async execute<T>(options: ExecuteOptions<T>): Promise<T> {
    if (!this.hasCredentials()) throw new Error('Thiếu GEMINI_API_KEYS');
    const policy = this.router.selectModel(options.taskType);
    const candidates = await this.nextCredentials();
    if (!candidates.length)
      throw new Error('Gemini credentials are temporarily unavailable');
    const startedAt = Date.now();
    let lastError: unknown;
    let retries = 0;
    for (const credential of candidates.slice(0, MAX_ATTEMPTS)) {
      try {
        const model = new GoogleGenerativeAI(
          credential.value,
        ).getGenerativeModel({ model: policy.model });
        const result = await this.withinTimeout(
          (signal) => options.operation(model, signal),
          options.timeoutMs,
        );
        const responseUsage = (result as any)?.response?.usageMetadata;
        await this.telemetry({
          taskType: options.taskType,
          policy,
          fingerprint: credential.fingerprint,
          outcome: 'success',
          latencyMs: Date.now() - startedAt,
          retryCount: retries,
          usage: options.onSuccess?.(result) || responseUsage,
        });
        return result;
      } catch (error) {
        lastError = error;
        const errorClass = classifyGeminiError(error);
        const cooldown = this.cooldownSeconds(errorClass);
        if (cooldown) await this.setCooldown(credential, errorClass, cooldown);
        await this.telemetry({
          taskType: options.taskType,
          policy,
          fingerprint: credential.fingerprint,
          outcome: 'failure',
          errorClass,
          latencyMs: Date.now() - startedAt,
          retryCount: retries,
        });
        this.logger.warn(
          `Gemini request failed task=${options.taskType} model=${policy.model} key=${credential.fingerprint} class=${errorClass}: ${redactGeminiError(error?.message)}`,
        );
        if (
          !['RATE_LIMIT', 'AUTH', 'PROVIDER_TRANSIENT', 'TIMEOUT'].includes(
            errorClass,
          ) ||
          (errorClass === 'TIMEOUT' && options.failoverOnTimeout === false)
        )
          break;
        retries += 1;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(redactGeminiError(lastError));
  }
}
