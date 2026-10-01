import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import IORedis from 'ioredis';
import {
  SPEAKING_EVENTS_CHANNEL,
  SpeakingEventPayload,
} from './speaking.constants';

@Injectable()
export class SpeakingEventPublisherService implements OnModuleDestroy {
  private readonly logger = new Logger(SpeakingEventPublisherService.name);
  public readonly pubRedis: IORedis;

  constructor() {
    this.pubRedis = new IORedis(
      process.env.REDIS_URL || 'redis://localhost:6379',
      {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      },
    );
  }

  /**
   * Publishes lightweight event to Redis Pub/Sub for API Socket.IO gateway forwarding.
   * Strictly emits only type, userId, submissionId, and traceId.
   * Publication failures are logged safely so they never roll back or invalidate committed scores.
   */
  async publishEvent(payload: SpeakingEventPayload): Promise<void> {
    try {
      const message = JSON.stringify({
        type: payload.type,
        userId: payload.userId,
        submissionId: payload.submissionId,
        traceId: payload.traceId,
      });
      await this.pubRedis.publish(SPEAKING_EVENTS_CHANNEL, message);
      this.logger.log(
        `[SpeakingEventPublisher] Published ${payload.type} event to Redis channel "${SPEAKING_EVENTS_CHANNEL}" (submissionId=${payload.submissionId}, userId=${payload.userId}, traceId=${payload.traceId})`,
      );
    } catch (err: any) {
      this.logger.error(
        `[SpeakingEventPublisher] Failed to publish ${payload.type} event to Redis for submission #${payload.submissionId} (traceId=${payload.traceId}): ${err.message}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pubRedis.status !== 'end') {
      await this.pubRedis.quit();
    }
  }
}
