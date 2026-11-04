import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { CloudflareWorkersAiClient } from '../cloudflare-workers-ai.client';
import { GeminiCredentialManager } from '../gemini/gemini-credential-manager.service';
import { GeminiModelRouter } from '../gemini/gemini-model-router';
import { redactGeminiError } from '../gemini/gemini-credential-manager.service';
import {
  ANSWER_REVIEW_PROMPT_VERSION,
  type ReviewPrompt,
} from '../toeic-answer-review-prompt';
import {
  reviewKindFor,
  vendorOfModel,
  type ValidationResult,
} from '../../toeic/toeic-answer-review.logic';
import type {
  ReviewStep,
  ReviewStepName,
} from '../../toeic/toeic-answer-review.types';
import {
  AnswerReviewer,
  ReviewerImage,
  ReviewUsage,
  isProviderOutage,
} from './answer-reviewer';
import {
  CloudflareReviewer,
  GeminiReviewer,
  OpenAiCompatibleReviewer,
} from './reviewers';
import { exhaustedUntil, markExhausted } from './provider-exhaustion';

export type ReviewRun<T> = {
  step: ReviewStep;
  answers?: Map<string, T>;
  /** Raw reply of the vision step, validated by the caller. */
  value?: unknown;
};

const NAMES = ['cloudflare', 'gemini', 'openai-compatible'] as const;

/**
 * Runs one review step through a chain of providers. Outage: next provider.
 * Invalid reply: next provider. A valid reply, agreeing or not, ends the chain:
 * no further provider is asked.
 */
@Injectable()
export class AnswerReviewService {
  private readonly logger = new Logger(AnswerReviewService.name);
  private readonly reviewers: Record<(typeof NAMES)[number], AnswerReviewer>;

  constructor(
    private readonly cloudflare: CloudflareWorkersAiClient,
    credentials: GeminiCredentialManager,
    router: GeminiModelRouter,
    @Optional() @InjectRedis() private readonly redis?: Redis,
  ) {
    this.reviewers = {
      cloudflare: new CloudflareReviewer(cloudflare),
      gemini: new GeminiReviewer(credentials, router),
      'openai-compatible': new OpenAiCompatibleReviewer(),
    };
  }

  /** Swaps in fake providers (tests and the deterministic QA server). */
  useReviewers(reviewers: AnswerReviewer[]) {
    for (const reviewer of reviewers) this.reviewers[reviewer.name] = reviewer;
  }

  private chain(envName: string, fallback: string) {
    const names = (process.env[envName]?.trim() || fallback)
      .split(',')
      .map((name) => name.trim().toLowerCase())
      .filter((name): name is (typeof NAMES)[number] =>
        (NAMES as readonly string[]).includes(name),
      );
    return names.map((name) => this.reviewers[name]);
  }

  solveChain() {
    return this.chain('TOEIC_SOLVE_REVIEWERS', 'cloudflare,gemini');
  }
  explanationChain() {
    return this.chain('TOEIC_EXPLANATION_REVIEWERS', 'gemini');
  }
  visionChain() {
    return this.chain('TOEIC_VISION_REVIEWERS', 'gemini').filter(
      (reviewer) => reviewer.supportsImages,
    );
  }

  /** Vendor of the model that wrote the content. */
  generatorVendor(provider?: string | null) {
    return provider === 'CLOUDFLARE'
      ? vendorOfModel('cloudflare', this.cloudflare.textModel())
      : 'google';
  }

  async run<T>(input: {
    stepName: ReviewStepName;
    chain: AnswerReviewer[];
    prompt: ReviewPrompt;
    generatorVendor: string | null;
    validate?: (data: unknown) => ValidationResult<T>;
    image?: ReviewerImage;
  }): Promise<ReviewRun<T>> {
    const tried: ReviewStep['tried'] = [];
    let sawInvalid = false;
    for (const reviewer of input.chain) {
      const model = reviewer.model();
      if (!reviewer.configured()) {
        tried.push({
          provider: reviewer.name,
          model,
          reason: 'not configured',
        });
        continue;
      }
      // A provider whose quota is spent is skipped until it resets.
      const spentUntil = await exhaustedUntil(this.redis, reviewer.name);
      if (spentUntil) {
        tried.push({
          provider: reviewer.name,
          model,
          reason: `unavailable: quota spent until ${spentUntil.toISOString()}`,
        });
        continue;
      }
      const startedAt = Date.now();
      try {
        const reply = await reviewer.reviewJson(input.prompt, input.image);
        const checked = input.validate?.(reply.data);
        if (checked && !checked.ok) {
          sawInvalid = true;
          tried.push({
            provider: reviewer.name,
            model: reply.model,
            reason: `invalid: ${checked.reason}`.slice(0, 300),
          });
          await this.count(
            reviewer.name,
            reply.model,
            'invalid',
            reply.usage,
            startedAt,
          );
          continue;
        }
        await this.count(
          reviewer.name,
          reply.model,
          'ok',
          reply.usage,
          startedAt,
        );
        const vendor = reviewer.vendor();
        return {
          step: {
            provider: reviewer.name,
            model: reply.model,
            modelVendor: vendor,
            reviewKind: reviewKindFor(vendor, input.generatorVendor),
            status: 'OK',
            promptVersion: ANSWER_REVIEW_PROMPT_VERSION,
            at: new Date().toISOString(),
            tried,
            usage: reply.usage,
          },
          answers: checked?.ok ? checked.answers : undefined,
          value: reply.data,
        };
      } catch (error) {
        const outage = isProviderOutage(error);
        if (!outage) sawInvalid = true;
        else await markExhausted(this.redis, reviewer.name, error);
        const reason = redactGeminiError((error as Error)?.message ?? error);
        tried.push({
          provider: reviewer.name,
          model,
          reason: `${outage ? 'unavailable' : 'invalid'}: ${reason}`.slice(
            0,
            300,
          ),
        });
        this.logger.warn(
          `answer_review_provider_failed step=${input.stepName} provider=${reviewer.name} outage=${outage}: ${reason.slice(0, 200)}`,
        );
        await this.count(
          reviewer.name,
          model,
          outage ? 'unavailable' : 'invalid',
          undefined,
          startedAt,
        );
      }
    }
    return {
      step: {
        provider: null,
        model: null,
        modelVendor: null,
        reviewKind: 'SAME_PROVIDER',
        status: sawInvalid ? 'INVALID' : 'UNAVAILABLE',
        promptVersion: ANSWER_REVIEW_PROMPT_VERSION,
        at: new Date().toISOString(),
        tried,
      },
    };
  }

  /** Daily per-provider counters, read back by the live QA report. */
  private async count(
    provider: string,
    model: string,
    outcome: 'ok' | 'invalid' | 'unavailable',
    usage: ReviewUsage | undefined,
    startedAt: number,
  ) {
    if (!this.redis) return;
    const key = `ai:answer-review:telemetry:${new Date().toISOString().slice(0, 10)}`;
    const field = `${provider}|${model}`;
    try {
      const pipeline = this.redis.pipeline();
      pipeline.hincrby(key, `${field}|requests`, 1);
      pipeline.hincrby(key, `${field}|${outcome}`, 1);
      pipeline.hincrby(key, `${field}|latency_ms`, Date.now() - startedAt);
      if (usage?.inputTokens)
        pipeline.hincrby(key, `${field}|input_tokens`, usage.inputTokens);
      if (usage?.outputTokens)
        pipeline.hincrby(key, `${field}|output_tokens`, usage.outputTokens);
      if (usage?.neurons)
        pipeline.hincrbyfloat(key, `${field}|neurons`, usage.neurons);
      pipeline.expire(key, 60 * 86400);
      await pipeline.exec();
    } catch (error) {
      this.logger.warn(`answer_review_telemetry_failed: ${String(error)}`);
    }
  }
}
