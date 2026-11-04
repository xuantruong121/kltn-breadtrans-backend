import { Injectable, Optional } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import {
  CLOUDFLARE_FREE_NEURONS_PER_DAY,
  CLOUDFLARE_USD_PER_K_NEURONS,
  costRow,
  sumTelemetry,
  telemetryDays,
} from '../ai/review/provider-pricing';
import { exhaustedUntil } from '../ai/review/provider-exhaustion';

const PROVIDERS = ['cloudflare', 'openai-compatible', 'gemini'] as const;

/**
 * Token use and estimated cost of the AI answer review (the solve and
 * explanation checks on generated TOEIC items), per provider and model, from
 * the daily Redis counters. Exam writing itself is not counted here.
 */
@Injectable()
export class AiReviewCostsService {
  constructor(@Optional() @InjectRedis() private readonly redis?: Redis) {}

  async getCosts(requestedDays?: number, now = new Date()) {
    const days = Math.min(Math.max(Math.trunc(requestedDays || 7), 1), 60);
    const keys = telemetryDays(now, days);
    const hashes = this.redis
      ? await Promise.all(
          keys.map((day) =>
            this.redis!.hgetall(`ai:answer-review:telemetry:${day}`),
          ),
        )
      : keys.map(() => ({}));

    const perDay = keys.map((day, i) => {
      const rows = sumTelemetry([hashes[i]]).map(costRow);
      const neurons = rows.reduce((sum, r) => sum + (r.neurons ?? 0), 0);
      return {
        day,
        requests: rows.reduce((sum, r) => sum + r.requests, 0),
        cloudflareNeurons: neurons,
        cloudflareOverFreeUsd:
          (Math.max(0, neurons - CLOUDFLARE_FREE_NEURONS_PER_DAY) / 1000) *
          CLOUDFLARE_USD_PER_K_NEURONS,
      };
    });

    const spent = await Promise.all(
      PROVIDERS.map(async (provider) => ({
        provider,
        until: this.redis
          ? ((await exhaustedUntil(this.redis, provider))?.toISOString() ??
            null)
          : null,
      })),
    );

    return {
      generatedAt: now.toISOString(),
      days,
      telemetryAvailable: Boolean(this.redis),
      cloudflareFreeNeuronsPerDay: CLOUDFLARE_FREE_NEURONS_PER_DAY,
      models: sumTelemetry(hashes).map(costRow),
      perDay,
      spent,
    };
  }
}
