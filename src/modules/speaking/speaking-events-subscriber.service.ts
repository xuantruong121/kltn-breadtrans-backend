import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import IORedis from 'ioredis';
import { EventsGateway } from '../events/events.gateway';
import {
  SPEAKING_EVENTS_CHANNEL,
  SpeakingEventPayload,
} from './speaking.constants';

@Injectable()
export class SpeakingEventsSubscriberService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SpeakingEventsSubscriberService.name);
  private subRedis: IORedis;

  constructor(@Optional() private readonly eventsGateway?: EventsGateway) {}

  async onModuleInit(): Promise<void> {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    this.subRedis = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    try {
      await this.subRedis.subscribe(SPEAKING_EVENTS_CHANNEL);
      this.logger.log(
        `Subscribed to Redis Pub/Sub channel "${SPEAKING_EVENTS_CHANNEL}"`,
      );

      this.subRedis.on('message', (channel, message) => {
        if (channel !== SPEAKING_EVENTS_CHANNEL) return;
        this.handleMessage(message);
      });
    } catch (err: any) {
      this.logger.error(
        `Failed to subscribe to speaking events channel: ${err.message}`,
      );
    }
  }

  private handleMessage(message: string): void {
    try {
      const payload: SpeakingEventPayload = JSON.parse(message);
      this.logger.log(
        `[SpeakingEventsSubscriber] Received ${payload.type} for user #${payload.userId}, submission #${payload.submissionId} (traceId=${payload.traceId})`,
      );

      if (this.eventsGateway?.server) {
        const userRoom = `user_${payload.userId}`;
        this.eventsGateway.server.to(userRoom).emit(payload.type, {
          submissionId: payload.submissionId,
          traceId: payload.traceId,
          status: payload.type.includes('.failed')
            ? 'FAILED'
            : payload.type.includes('feedback')
              ? 'FEEDBACK_COMPLETED'
              : 'COMPLETED',
        });

        this.logger.log(
          `[SpeakingEventsSubscriber] Emitted Socket.IO event "${payload.type}" to room "${userRoom}"`,
        );
      } else {
        this.logger.warn(
          `[SpeakingEventsSubscriber] EventsGateway or server is not available to forward event`,
        );
      }
    } catch (err: any) {
      this.logger.error(
        `[SpeakingEventsSubscriber] Failed to parse message: ${err.message}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subRedis) {
      await this.subRedis.unsubscribe(SPEAKING_EVENTS_CHANNEL);
      await this.subRedis.quit();
    }
  }
}
